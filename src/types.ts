// types.ts — shared shape for seed.json, TMDB fetch layer, and the UI.

export type VideoSource = 'tmdb-clip' | 'movieclips' | 'trailer';

/**
 * A vertical (9:16) YouTube Short for the same film, found by
 * scripts/find-shorts.mjs. Played full-screen instead of the landscape clip
 * when present; the landscape clip is the fallback if it fails to embed.
 */
export interface MovieShort {
  key: string;          // YouTube video id
  /** True when the uploader matched one of the film's production companies. */
  official: boolean;
  seconds: number;      // duration; Shorts loop whole, no start/end
}

export interface MovieVideo {
  key: string;          // YouTube video id (from TMDB /videos or the curation script)
  start: number;        // seconds — skip studio logos / Movieclips bumper
  end: number;          // seconds — cap the segment at ~15–20s
  source: VideoSource;
  short?: MovieShort;
}

export interface Movie {
  id: number;           // TMDB id
  title: string;
  year: number;
  genreIds: number[];   // TMDB genre ids, used by the taste vector
  genreNames: string[]; // display only
  keywords: string[];   // TMDB keywords, used by the taste vector
  /** TMDB person IDs in billing order; scoring uses the first three. */
  castIds?: number[];
  poster: string;       // https://image.tmdb.org/t/p/w780/...
  providers: string[];  // from /watch/providers (JustWatch data), region US
  video: MovieVideo | null; // null → card shows poster only
  /** Optional poster colors used by the swipe UI. */
  themeColor?: string;
  negativeColor?: string;
}

/** Sparse weights keyed as genre:28, keyword:heist, or cast:3223. */
export type TasteVector = Record<string, number>;

export type FeatureKey = `genre:${number}` | `keyword:${string}` | `cast:${number}`;

export const FEATURE_PREFIX = {
  genre: 'genre',
  keyword: 'keyword',
  cast: 'cast',
} as const;

export type SwipeDirection = 'left' | 'right';

/** Timestamps in shared contracts are epoch milliseconds. */
export interface Session {
  code: string;
  createdAt: number;
  hostUid: string;
}

export interface Member {
  uid: string;
  name?: string;
  likes: number[];
  dislikes: number[];
  /** Optional metadata retained for existing consumers. */
  joinedAt?: number;
  taste?: TasteVector;
}

export interface Match {
  tmdbId: number;
  sessionCode: string;
  matchedAt: number;
  why?: string;
}

// ─── TMDB query surface (#15) ────────────────────────────────────────────────
// Deliberately TMDB-shaped rather than prose-shaped: #22 turns a Gemini mood
// string into these fields and lib/tmdb.ts maps them 1:1 onto /discover/movie
// query parameters. Adding a field here means adding the parameter there.
//
// Offline these are ignored — seed.json is a fixed catalog, not a query engine.
// A caller must not assume a filtered deck came back filtered; check isOffline()
// if it matters.

export interface DiscoverFilters {
  /** TMDB genre ids, OR-ed together (`with_genres`). */
  withGenres?: number[];
  /** TMDB genre ids to exclude (`without_genres`). */
  withoutGenres?: number[];
  /**
   * TMDB keyword *ids*, not names — /discover only takes ids, so #22 has to
   * resolve Gemini's words through /search/keyword first. OR-ed together:
   * Gemini hands back several near-synonyms for one mood, and requiring a title
   * to carry all of them returns nothing.
   */
  withKeywords?: number[];
  /** TMDB watch-provider ids. Implies `watch_region=US`. */
  withWatchProviders?: number[];
  /** `vote_average.gte`, 0–10. */
  minRating?: number;
  /** `vote_count.gte`. Defaults to 300 so obscure titles with no trailer stay out. */
  minVotes?: number;
  /** Inclusive release-year bounds. */
  releasedAfter?: number;
  releasedBefore?: number;
  /** Defaults to `popularity.desc`, which is what reliably has trailers. */
  sortBy?:
    | 'popularity.desc'
    | 'vote_average.desc'
    | 'revenue.desc'
    | 'primary_release_date.desc';
}
