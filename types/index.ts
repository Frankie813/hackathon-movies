// types/index.ts — one import point for every shared type: `@/types`.
//
// Issue #4 froze Movie/MovieVideo/VideoSource against seed.json; #5 wires these
// through the screens and the fetch layer. Nothing here imports firebase or
// react-native, so the algorithm modules stay pure and testable.

export type { Movie, MovieVideo, VideoSource } from './movie';
export type { FeatureKey, SwipeDirection, TasteVector } from './taste';
export { FEATURE_PREFIX } from './taste';
export type { Match, Member, Session } from './session';
