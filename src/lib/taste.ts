import type { Movie, SwipeDirection, TasteVector } from '../types';

/** Binary, namespaced features; cast IDs must be in billing order. */
export function features(m: Movie): string[] {
  return [...new Set([
    ...m.genreIds.map((id) => `genre:${id}`),
    ...m.keywords.map((keyword) => keyword.trim().toLowerCase())
      .filter(Boolean).map((keyword) => `keyword:${keyword}`),
    ...(m.castIds ?? []).slice(0, 3).map((id) => `cast:${id}`),
  ])];
}

/** Return a new vector so callers can retain previous state safely. */
export function applySwipe(v: TasteVector, m: Movie, dir: SwipeDirection): TasteVector {
  const next = { ...v };
  const delta = dir === 'right' ? 1 : -1;
  for (const feature of features(m)) {
    next[feature] = (next[feature] ?? 0) + delta;
  }
  return next;
}

export function score(v: TasteVector, m: Movie): number {
  const keys = features(m);
  if (keys.length === 0) return 0;
  return keys.reduce((total, key) => total + (v[key] ?? 0), 0) / keys.length;
}

/**
 * A per-movie random number in [0, 1), fixed for as long as the caller keeps
 * the function (#96). See makeJitter().
 */
export type RankJitter = (movieId: number) => number;

/**
 * How far jitter may move a movie, as a share of the score range in the list
 * being ranked. Big enough that near-ties land in a different order every
 * session; small enough that a clearly on-taste title still leads.
 */
export const JITTER = 0.25;

/**
 * One random draw per movie id, memoised. Hold one per session: a fresh draw
 * on every re-rank would shuffle the deck under the user after each swipe and
 * break SwipeDeck's next-card prediction.
 */
export function makeJitter(random: () => number = Math.random): RankJitter {
  const draws = new Map<number, number>();
  return (movieId) => {
    let draw = draws.get(movieId);
    if (draw === undefined) {
      draw = random();
      draws.set(movieId, draw);
    }
    return draw;
  };
}

/**
 * Score once per movie; ties retain the input order, including cold start.
 *
 * With `jitter` (#96), each score is nudged by up to JITTER of the list's
 * score range, so the same taste vector no longer deals the same order every
 * run. At cold start every score is 0 and the order is fully random.
 */
export function rank(v: TasteVector, ms: Movie[], jitter?: RankJitter): Movie[] {
  const scored = ms.map((movie, index) => ({ movie, index, value: score(v, movie) }));
  if (jitter && scored.length > 1) {
    const values = scored.map((entry) => entry.value);
    const spread = Math.max(...values) - Math.min(...values) || 1;
    for (const entry of scored) entry.value += jitter(entry.movie.id) * JITTER * spread;
  }
  return scored
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map(({ movie }) => movie);
}
