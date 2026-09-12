// types/taste.ts — the recommendation model's data shapes (PLAN.md §H).
//
// #12 freezes the feature-key format here so that #13, #14, #17, #18, #20, #24
// and #9 all agree on it. Changing a prefix after those land silently produces
// a taste vector that scores every movie at zero.

/**
 * A single feature of a movie. Namespaced so genre 28 and cast member 28 can
 * never collide in the same sparse vector.
 *
 *   'genre:28'          TMDB genre id
 *   'keyword:heist'     TMDB keyword, lowercased exactly as seed.json stores it
 *   'cast:3223'         TMDB person id, top 3 billed
 */
export type FeatureKey = `genre:${number}` | `keyword:${string}` | `cast:${number}`;

/** The prefixes, so nothing has to hand-build a key from a string literal. */
export const FEATURE_PREFIX = {
  genre: 'genre',
  keyword: 'keyword',
  cast: 'cast',
} as const;

/**
 * Sparse weights over a user's features. Absent means "no signal", which is
 * different from zero, so lookups are `number | undefined` on purpose — #12's
 * score() must read them as `vector[f] ?? 0`.
 *
 * Stored at users/{uid}/taste by #18.
 */
export type TasteVector = Partial<Record<FeatureKey, number>>;

/** Right is a like, left is a dislike. Matches #12 and #16's signatures. */
export type SwipeDirection = 'left' | 'right';
