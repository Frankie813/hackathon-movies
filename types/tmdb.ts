// types/tmdb.ts — the query surface of the catalog layer (#15).
//
// Deliberately TMDB-shaped rather than prose-shaped: #22 turns a Gemini mood
// string into these fields and lib/tmdb.ts maps them 1:1 onto /discover/movie
// query parameters. Adding a field here means adding the parameter there.
//
// Offline these are ignored — seed.json is 68 fixed movies, not a query engine.
// A caller must not assume a filtered deck actually came back filtered; check
// isOffline() if it matters.

export interface DiscoverFilters {
  /** TMDB genre ids, OR-ed together (`with_genres`). */
  withGenres?: number[];
  /** TMDB genre ids to exclude (`without_genres`). */
  withoutGenres?: number[];
  /**
   * TMDB keyword *ids*, not names — /discover only takes ids, so #22 has to
   * resolve Gemini's words through /search/keyword first.
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
