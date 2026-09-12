// types.ts — shared shape for seed.json, TMDB fetch layer, taste vector, sessions, and UI.

export type VideoSource = 'tmdb-clip' | 'movieclips' | 'trailer';

export interface MovieVideo {
  key: string;          // YouTube video id (from TMDB /videos or curation script)
  start: number;        // seconds — skip studio logos / Movieclips bumper
  end: number;          // seconds — cap the segment at ~15–20s
  source: VideoSource;
}

export interface Movie {
  id: number;           // TMDB id
  title: string;
  year: number;
  genreIds: number[];   // TMDB genre ids, used by taste vector
  genreNames: string[]; // display only
  keywords: string[];   // TMDB keywords, used by taste vector
  poster: string;       // https://image.tmdb.org/t/p/w780/...
  providers: string[];  // from /watch/providers (JustWatch data), region US
  video: MovieVideo | null; // null -> card shows poster only
  themeColor?: string;   // dominant background/mood color
  negativeColor?: string; // negative/complementary accent color inverted from the poster
}

export type TasteVector = Record<string, number>;

export interface Member {
  uid: string;
  name?: string;
  likes: number[];
  dislikes: number[];
  joinedAt: number;
}

export interface Session {
  code: string;
  createdAt: number;
  createdBy: string;
  members: Record<string, Member>;
  matchedMovieId?: number;
  matchedAt?: number;
}
