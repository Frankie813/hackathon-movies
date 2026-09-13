// src/lib/persist.ts — the taste vector and the like list, on disk (issue #18).
//
// #12 built the taste vector but kept it in a ref inside the deck, so every
// reload started the ranking from zero. That makes a rehearsal unrepeatable —
// the deck you tuned in run three is gone by run four — and leaves #41's Saved
// tab with nothing to read.
//
// Data model (rules live in firestore.rules)
//   users/{uid}/taste/current         { vector: { 'genre:28': 3, ... }, updatedAt }
//   users/{uid}/likes/{movieId}       { movieId, likedAt }
//   users/{uid}/watchlist/{movieId}   { movieId, addedAt }
//
// Likes and the watchlist are deliberately separate collections (#87). A like
// is a cheap, high-volume taste signal; a Watch Later is a deliberate save, and
// only the latter is what the Saved tab shows. They share a row shape, so
// toSavedRows() below reads both.
//
// `users/{uid}/taste` is a collection — Firestore path segments alternate
// collection/document — so the vector lives in a fixed document inside it, the
// same shape #17 uses for sessions/{code}/match/current.
//
// Timestamps are client epoch-ms, not serverTimestamp(), for the reason #17
// documents: serverTimestamp() reads back null in the writer's own snapshot
// until the server acknowledges it, and this data is read straight back on the
// next launch.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';

import { db } from '../../lib/firebase';
import type { TasteVector } from '../types';

const USERS = 'users';
const TASTE = 'taste';
/** Fixed id, so loading the vector is a single-document read. */
const TASTE_DOC = 'current';
const LIKES = 'likes';
const WATCHLIST = 'watchlist';

/**
 * Coalescing window. Long enough to swallow a burst of fast swipes, short
 * enough that a reload a few seconds later still sees them.
 */
export const TASTE_DEBOUNCE_MS = 2000;

/**
 * Swipes that force a write regardless of the timer, so a sustained fast
 * swiper still checkpoints instead of riding one perpetually-reset timer.
 */
export const TASTE_FLUSH_EVERY = 5;

/**
 * How long boot waits for Firestore before giving up and starting cold.
 *
 * Offline there is no cached copy to fall back to — React Native gets the
 * in-memory cache, not IndexedDB — so getDoc() can sit waiting for a
 * connection that isn't coming. A cold deck beats a deck that never renders
 * (PLAN.md §L).
 */
export const LOAD_TIMEOUT_MS = 1500;

/**
 * How long a write waits for the server before its promise resolves anyway.
 *
 * setDoc() resolves on server acknowledgement, so offline it stays pending for
 * the length of the outage — the write itself is safe, queued by the SDK and
 * replayed when the network returns, but a caller awaiting it would hang at
 * exactly the venue-Wi-Fi moment this file is built around.
 */
export const WRITE_ACK_MS = 3000;

/** Resolves to `fallback` rather than rejecting or hanging. */
function orFallback<T>(work: Promise<T>, fallback: T, what: string): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[persist] ${what} timed out after ${LOAD_TIMEOUT_MS}ms — starting cold`);
      resolve(fallback);
    }, LOAD_TIMEOUT_MS);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        console.warn(`[persist] could not ${what}:`, error);
        resolve(fallback);
      },
    );
  });
}

/**
 * Resolves when `work` settles or after `ms`, whichever comes first — the
 * write is not abandoned, only stopped from holding the caller.
 *
 * The deadline path is silent on purpose: a merely slow network is not a
 * failure, and a warning per swipe would bury the ones that matter.
 */
function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

function tasteRef(uid: string) {
  return doc(db, USERS, uid, TASTE, TASTE_DOC);
}

function likesRef(uid: string) {
  return collection(db, USERS, uid, LIKES);
}

/** One row per title: re-liking is idempotent and #41 can order by likedAt. */
function likeRef(uid: string, movieId: number) {
  return doc(db, USERS, uid, LIKES, String(movieId));
}

function watchlistRef(uid: string) {
  return collection(db, USERS, uid, WATCHLIST);
}

/** Same one-row-per-title shape as likeRef: saving the same title twice is a no-op. */
function watchLaterRef(uid: string, movieId: number) {
  return doc(db, USERS, uid, WATCHLIST, String(movieId));
}

/**
 * A liked title. Taste history: since #87 the Saved tab no longer reads these —
 * a right swipe is a signal, not a save.
 */
export interface LikedMovie {
  movieId: number;
  /** Epoch ms. */
  likedAt: number;
}

/** A title the user explicitly saved, as the Saved tab reads it back (#87). */
export interface WatchLaterMovie {
  movieId: number;
  /** Epoch ms. */
  addedAt: number;
}

/**
 * Defensive read — a remote document is untrusted input, not a TasteVector.
 *
 * Drops anything that isn't a finite number so one bad key can't turn every
 * score into NaN and silently flatten the ranking.
 */
function toTasteVector(value: unknown): TasteVector {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const vector: TasteVector = {};
  for (const [key, weight] of Object.entries(value as Record<string, unknown>)) {
    if (typeof weight === 'number' && Number.isFinite(weight)) vector[key] = weight;
  }
  return vector;
}

/**
 * Rows of a saved-title collection, defensively. Likes and the watchlist differ
 * only in the name of their timestamp field, so both read through here.
 *
 * The document id *is* the movie id, so a row whose own `movieId` went missing
 * is still recoverable; one that cannot name a number is dropped rather than
 * rendered as "Movie #NaN".
 */
function toSavedRows<T>(
  docs: { id: string; data(): Record<string, unknown> }[],
  timestampField: string,
  build: (movieId: number, at: number) => T,
): T[] {
  const rows: T[] = [];
  for (const docSnap of docs) {
    const data = docSnap.data();
    const movieId = typeof data.movieId === 'number' ? data.movieId : Number(docSnap.id);
    if (!Number.isFinite(movieId)) continue;
    const at = data[timestampField];
    rows.push(build(movieId, typeof at === 'number' ? at : 0));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Taste vector
// ---------------------------------------------------------------------------

interface Pending {
  vector: TasteVector;
  /** saveTaste() calls since the last write — one per swipe. */
  swipes: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Resolves when the write that covers `vector` has landed. */
  done: Promise<void>;
  settle: () => void;
}

/** Keyed by uid: an account switch mid-session must not inherit a pending write. */
const pending = new Map<string, Pending>();

function schedule(uid: string): Pending {
  const existing = pending.get(uid);
  if (existing) return existing;

  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const entry: Pending = { vector: {}, swipes: 0, timer: null, done, settle };
  pending.set(uid, entry);
  return entry;
}

/**
 * Writes whatever is pending for `uid` right now. Call it when the swipe
 * screen unmounts so the last few swipes aren't stranded in the timer.
 *
 * Never throws, and never hangs: it resolves when the server acknowledges the
 * write or, after `WRITE_ACK_MS`, once the write is safely in Firestore's
 * queue. A failed sync must not take down a deck that is already on screen,
 * and offline is the expected case at the venue (PLAN.md §L), not an error.
 */
export async function flushTaste(uid: string): Promise<void> {
  const entry = pending.get(uid);
  if (!entry) return;

  if (entry.timer) clearTimeout(entry.timer);
  pending.delete(uid);

  // merge:true so a session that had to start cold — the boot read timed out
  // because the venue Wi-Fi was down — rewrites only the features it actually
  // swiped on instead of flattening a vector built over previous runs.
  // Identical to a replace in the normal case: applySwipe() only ever adds
  // keys, so the in-memory vector is a superset of the stored one.
  const write = setDoc(
    tasteRef(uid),
    { vector: entry.vector, updatedAt: Date.now() },
    { merge: true },
  ).catch((error: unknown) => {
    console.warn('[persist] could not save taste:', error);
  });

  await settleWithin(write, WRITE_ACK_MS);
  entry.settle();
}

/**
 * Persists the taste vector, debounced.
 *
 * Call it once per swipe. The write lands `TASTE_DEBOUNCE_MS` after the last
 * call, or immediately once `TASTE_FLUSH_EVERY` swipes have piled up — a
 * Firestore write per swipe would stutter the deck and burn the free tier.
 * Only the newest vector is ever written; the ones in between are dropped,
 * which is safe because each vector already contains every swipe before it.
 *
 * Returns a promise that resolves when the write covering this call has landed
 * or been queued — see flushTaste(). The swipe handler should still `void` it:
 * there is nothing to do with the result, and a swipe must never wait on it.
 */
export async function saveTaste(uid: string, v: TasteVector): Promise<void> {
  if (!uid) return;

  const entry = schedule(uid);
  entry.vector = v;
  entry.swipes += 1;

  if (entry.swipes >= TASTE_FLUSH_EVERY) return flushTaste(uid);

  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    void flushTaste(uid);
  }, TASTE_DEBOUNCE_MS);

  return entry.done;
}

/**
 * The stored vector, or `{}` on a first run — and on any failure, because a
 * cold-start deck is a working deck (ties keep the catalog's own order) and
 * blocking the swipe screen on a Firestore read is not.
 *
 * Call it before the deck mounts. Seeding the deck after it renders means the
 * first cards a judge sees were ranked against an empty vector.
 */
export async function loadTaste(uid: string): Promise<TasteVector> {
  if (!uid) return {};

  return orFallback(
    getDoc(tasteRef(uid)).then((snapshot) =>
      snapshot.exists() ? toTasteVector(snapshot.data().vector) : {},
    ),
    {},
    'load taste',
  );
}

// ---------------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------------

/**
 * Records a liked title. Unbatched on purpose — it is one small write per
 * right swipe, and unlike the vector it is not rewritten on every swipe, so
 * there is nothing to coalesce. Never throws and never hangs, like the rest.
 */
export async function saveLike(uid: string, movieId: number): Promise<void> {
  if (!uid) return;

  const write = setDoc(likeRef(uid, movieId), { movieId, likedAt: Date.now() }).catch(
    (error: unknown) => {
      console.warn('[persist] could not save like:', error);
    },
  );

  await settleWithin(write, WRITE_ACK_MS);
}

/**
 * Drops a title from the like list. Call it on every left swipe.
 *
 * Swiping the other way on a title has to move it out, not leave it in — the
 * same reasoning #16 applies to a member's likes/dislikes arrays. Without this
 * a title liked in one run and rejected in the next stays in the taste history
 * forever, still counting as a positive signal the user has since withdrawn.
 *
 * Deliberately not coalesced, unlike the taste vector. That debounce exists
 * because the vector document is rewritten in full on every swipe; this is one
 * small row operation per swipe, the same cost #16's recordSwipe() already
 * accepts on the demo path. Deleting a row that was never there is a no-op.
 */
export async function removeLike(uid: string, movieId: number): Promise<void> {
  if (!uid) return;

  const write = deleteDoc(likeRef(uid, movieId)).catch((error: unknown) => {
    console.warn('[persist] could not remove like:', error);
  });

  await settleWithin(write, WRITE_ACK_MS);
}

/**
 * Every title the user has liked, newest first, live.
 *
 * Firestore applies saveLike()/removeLike()'s write to the local cache before
 * the server acknowledges it, so a swipe shows up here in the same tick.
 *
 * No screen reads this since #87 split saving from liking — the Saved tab
 * mounts subscribeWatchLater() now. Kept because the like list is still the
 * user's taste history, which #94's profile reset has to clear.
 *
 * Fires with `[]` and returns a no-op unsubscribe when there is no uid yet,
 * the same "cold rather than broken" stance as the rest of this file.
 *
 * @returns the Firestore unsubscribe — call it on unmount or listeners leak.
 */
export function subscribeLikes(uid: string, cb: (likes: LikedMovie[]) => void): Unsubscribe {
  if (!uid) {
    cb([]);
    return () => {};
  }

  return onSnapshot(
    query(likesRef(uid), orderBy('likedAt', 'desc')),
    (snapshot) => {
      cb(toSavedRows(snapshot.docs, 'likedAt', (movieId, likedAt) => ({ movieId, likedAt })));
    },
    (error) => {
      console.warn('[persist] likes listener failed:', error.message);
    },
  );
}

/**
 * Every title the user has liked, newest first — the one-shot read behind
 * subscribeLikes(). It is here so that "the likes survived the reload" is
 * something the app can show rather than something you take on faith.
 */
export async function loadLikes(uid: string): Promise<LikedMovie[]> {
  if (!uid) return [];

  const read = getDocs(query(likesRef(uid), orderBy('likedAt', 'desc'))).then((snapshot) =>
    toSavedRows(snapshot.docs, 'likedAt', (movieId, likedAt) => ({ movieId, likedAt })),
  );

  return orFallback(read, [], 'load likes');
}

// ---------------------------------------------------------------------------
// Watch later (#87)
// ---------------------------------------------------------------------------

/**
 * Saves a title the user explicitly asked to keep. One small write per tap,
 * unbatched for the same reason saveLike() is — there is nothing to coalesce.
 * Never throws and never hangs.
 *
 * Deliberately has no counterpart on the left swipe. removeLike() exists
 * because a like is a running signal that a later pass should retract; a Watch
 * Later is a decision the user made on purpose, and a swipe should not silently
 * revoke it. Removal is the long-press on the Saved tab.
 */
export async function saveWatchLater(uid: string, movieId: number): Promise<void> {
  if (!uid) return;

  const write = setDoc(watchLaterRef(uid, movieId), { movieId, addedAt: Date.now() }).catch(
    (error: unknown) => {
      console.warn('[persist] could not save watch later:', error);
    },
  );

  await settleWithin(write, WRITE_ACK_MS);
}

/** Drops a title from the watchlist — the Saved tab's long-press. */
export async function removeWatchLater(uid: string, movieId: number): Promise<void> {
  if (!uid) return;

  const write = deleteDoc(watchLaterRef(uid, movieId)).catch((error: unknown) => {
    console.warn('[persist] could not remove watch later:', error);
  });

  await settleWithin(write, WRITE_ACK_MS);
}

/**
 * Every title the user saved for later, newest first, live.
 *
 * The Saved tab mounts this: Firestore applies the write to the local cache
 * before the server acknowledges it, so a tap on the deck (or a long-press
 * removal on the tab itself) shows up here in the same tick — which is also
 * what makes the tab work with the Wi-Fi off.
 *
 * Fires with `[]` and returns a no-op unsubscribe when there is no uid yet.
 *
 * @returns the Firestore unsubscribe — call it on unmount or listeners leak.
 */
export function subscribeWatchLater(
  uid: string,
  cb: (saved: WatchLaterMovie[]) => void,
): Unsubscribe {
  if (!uid) {
    cb([]);
    return () => {};
  }

  return onSnapshot(
    query(watchlistRef(uid), orderBy('addedAt', 'desc')),
    (snapshot) => {
      cb(toSavedRows(snapshot.docs, 'addedAt', (movieId, addedAt) => ({ movieId, addedAt })));
    },
    (error) => {
      console.warn('[persist] watchlist listener failed:', error.message);
    },
  );
}
