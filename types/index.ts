// Compatibility entry point for existing @/types imports.
// All shared contracts are defined in src/types.ts (#5).
export type {
  Movie, MovieVideo, VideoSource, FeatureKey, SwipeDirection,
  TasteVector, Match, Member, Session, DiscoverFilters,
} from '../src/types';
export { FEATURE_PREFIX } from '../src/types';
