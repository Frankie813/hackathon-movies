// src/lib/persist.ts — the taste vector and the like list, on disk (issue #18).
//
// #12 built the taste vector but kept it in a ref inside the deck, so every
// reload started the ranking from zero. That makes a rehearsal unrepeatable —
// the deck you tuned in run three is gone by run four — and leaves #41's Saved
// tab with nothing to read.
//
// Data model (rules live in firestore.rules)
//   users/{uid}/taste/current    { vector: { 'genre:28': 3, ... }, updatedAt }
//   users/{uid}/likes/{movieId}  { movieId, likedAt }
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

/** A liked title as #41's Saved tab reads it back. */
export interface LikedMovie {
  movieId: number;
  /** Epoch ms. */
  likedAt: number;
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
 * a title liked in one run and rejected in the next stays in #41's Saved tab
 * forever, and the user is looking at a film they explicitly passed on.
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
 * #41's Saved tab mounts this instead of loadLikes(): Firestore applies
 * saveLike()/removeLike()'s write to the local cache before the server
 * acknowledges it, so a swipe (or a long-press removal on the tab itself)
 * shows up here in the same tick — well inside the "within a second" AC.
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
      cb(
        snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const movieId = typeof data.movieId === 'number' ? data.movieId : Number(docSnap.id);
            if (!Number.isFinite(movieId)) return null;
            return { movieId, likedAt: typeof data.likedAt === 'number' ? data.likedAt : 0 };
          })
          .filter((like): like is LikedMovie => like !== null),
      );
    },
    (error) => {
      console.warn('[persist] likes listener failed:', error.message);
    },
  );
}

/**
 * Every title the user has liked, newest first. This is what #41's Saved tab
 * reads; it is here so that "the likes survived the reload" is something the
 * app can show rather than something you take on faith.
 */
export async function loadLikes(uid: string): Promise<LikedMovie[]> {
  if (!uid) return [];

  const read = getDocs(query(likesRef(uid), orderBy('likedAt', 'desc'))).then((snapshot) =>
    snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data();
        const movieId = typeof data.movieId === 'number' ? data.movieId : Number(docSnap.id);
        if (!Number.isFinite(movieId)) return null;
        return { movieId, likedAt: typeof data.likedAt === 'number' ? data.likedAt : 0 };
      })
      .filter((like): like is LikedMovie => like !== null),
  );

  return orFallback(read, [], 'load likes');
}
