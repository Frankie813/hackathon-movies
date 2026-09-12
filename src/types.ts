// types.ts — shared shape for seed.json, TMDB fetch layer, and the UI.

export type VideoSource = 'tmdb-clip' | 'movieclips' | 'trailer';

export interface MovieVideo {
  key: string;          // YouTube video id (from TMDB /videos or the curation script)
  start: number;        // seconds — skip studio logos / Movieclips bumper
  end: number;          // seconds — cap the segment at ~15–20s
  source: VideoSource;
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
