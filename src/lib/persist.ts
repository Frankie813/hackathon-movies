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

import { collection, doc, getDoc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';

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
 * Never throws: a failed sync must not take down a deck that is already on
 * screen, and offline is the expected case at the venue (PLAN.md §L) rather
 * than an error.
 */
export async function flushTaste(uid: string): Promise<void> {
  const entry = pending.get(uid);
  if (!entry) return;

  if (entry.timer) clearTimeout(entry.timer);
  pending.delete(uid);

  try {
    // merge:true so a session that had to start cold — the boot read timed out
    // because the venue Wi-Fi was down — rewrites only the features it actually
    // swiped on instead of flattening a vector built over previous runs.
    // Identical to a replace in the normal case: applySwipe() only ever adds
    // keys, so the in-memory vector is a superset of the stored one.
    await setDoc(tasteRef(uid), { vector: entry.vector, updatedAt: Date.now() }, { merge: true });
  } catch (error) {
    console.warn('[persist] could not save taste:', error);
  } finally {
    entry.settle();
  }
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
 * Returns a promise that resolves when the write covering this call lands.
 * The swipe handler should `void` it rather than await it: offline, the
 * Firestore SDK queues the write and the promise stays unresolved until the
 * network comes back.
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
 * there is nothing to coalesce. Never throws, for the same reason as above.
 */
export async function saveLike(uid: string, movieId: number): Promise<void> {
  if (!uid) return;

  try {
    await setDoc(likeRef(uid, movieId), { movieId, likedAt: Date.now() });
  } catch (error) {
    console.warn('[persist] could not save like:', error);
  }
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
