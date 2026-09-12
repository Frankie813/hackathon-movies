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

/** Score once per movie; ties retain the input order, including cold start. */
export function rank(v: TasteVector, ms: Movie[]): Movie[] {
  return ms.map((movie, index) => ({ movie, index, value: score(v, movie) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map(({ movie }) => movie);
}
