// types/movie.ts — the shape of the catalog, shared by seed.json, the TMDB
// fetch layer (#15) and the taste vector (#12).
//
// This is the contract issue #4 produces. Changing it after the fact breaks
// those consumers silently, so change scripts/curate.mjs and lib/seed.json in
// the same commit. Issue #5 adds TasteVector, Session and Member alongside it.

export type VideoSource = 'tmdb-clip' | 'movieclips' | 'trailer';

export interface MovieVideo {
  /** YouTube video id. We embed the official IFrame player — never a hosted file. */
  key: string;
  /** Seconds to skip at the head, past studio logos / the Movieclips bumper. */
  start: number;
  /**
   * Advisory end of the segment, ~15-20s after `start`. The IFrame API cannot
   * hard-stop at a timestamp, so #7 loops with seekTo(start) on `ended`.
   */
  end: number;
  source: VideoSource;
}

export interface Movie {
  /** TMDB id. */
  id: number;
  title: string;
  year: number;
  /** TMDB genre ids — features for the taste vector (#12). */
  genreIds: number[];
  /** Display only. */
  genreNames: string[];
  /** TMDB keywords, lowercased — features for the taste vector (#12). */
  keywords: string[];
  /** Full https://image.tmdb.org/t/p/w780/... URL, so the app never concatenates. */
  poster: string;
  /** US flatrate providers from /watch/providers (JustWatch data). */
  providers: string[];
  /** null -> the card falls back to the poster (#7). */
  video: MovieVideo | null;
}
