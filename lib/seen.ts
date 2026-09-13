// lib/seen.ts — every movie this device has already swiped, across launches.
//
// The taste vector remembers *what* the user likes, not *which* titles they
// have been shown, so every launch used to deal the same popular films again.
// This keeps the swiped ids (likes and passes) on the device so getDeck() and
// the top-ups can skip them and go deeper into TMDB for new ones.
//
// On-device (AsyncStorage), not Firestore: it must work with the Wi-Fi off, it
// is read before the first card, and it needs no security-rule change. Like
// lib/active-session.ts, a storage failure is logged and nothing else — the
// worst case is a repeat card, never a broken deck.

import AsyncStorage from '@react-native-async-storage/async-storage';

const SEEN_KEY = 'moviematch.seenMovies.v1';

/**
 * Most recent swipes kept. Beyond this the oldest are forgotten and may come
 * back, which is what a long-time user wants anyway once TMDB runs dry.
 */
export const MAX_SEEN = 600;

/** Writes are batched: a swipe is ~1s, and one write per card is wasted I/O. */
const WRITE_DELAY_MS = 1500;

/** Oldest first, no duplicates. */
let order: number[] = [];
let ids = new Set<number>();
let loading: Promise<ReadonlySet<number>> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function parse(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

/**
 * Restores the seen ids. Later calls resolve immediately. Swipes recorded
 * while the read is in flight are kept, not overwritten by it.
 */
export function loadSeen(): Promise<ReadonlySet<number>> {
  if (!loading) {
    loading = AsyncStorage.getItem(SEEN_KEY)
      .catch((cause: unknown) => {
        console.warn('[seen] could not read seen movies:', cause);
        return null;
      })
      .then((raw) => {
        const recorded = order;
        order = [];
        ids = new Set();
        for (const id of [...parse(raw), ...recorded]) remember(id);
        return ids;
      });
  }
  return loading;
}

/** What is known right now. Synchronous; empty until loadSeen() lands. */
export function getSeen(): ReadonlySet<number> {
  return ids;
}

function remember(id: number): void {
  if (ids.has(id)) order = order.filter((seen) => seen !== id);
  order.push(id);
  ids.add(id);
  while (order.length > MAX_SEEN) ids.delete(order.shift()!);
}

function persist(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    AsyncStorage.setItem(SEEN_KEY, JSON.stringify(order)).catch((cause: unknown) => {
      console.warn('[seen] could not save seen movies:', cause);
    });
  }, WRITE_DELAY_MS);
}

/** Records a swipe, like or pass. */
export function markSeen(movieId: number): void {
  remember(movieId);
  persist();
}

/** Test seam. */
export function __resetSeen(): void {
  order = [];
  ids = new Set();
  loading = null;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
}
