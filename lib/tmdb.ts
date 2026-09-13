// lib/tmdb.ts — the one catalog API for the whole app (issue #15).
//
// Online it is TMDB, offline it is lib/seed.json, and callers cannot tell the
// difference. Nothing here throws: PLAN.md §L rates venue Wi-Fi as the highest
// likelihood/highest impact risk, so every export returns data or falls back,
// and the user never sees an error state. That is the acceptance criterion.
//
// Consumers: #13 (candidate seeding), #22 (mood → filters), #24 (end-to-end
// loop). The exported signatures are a contract — changing them breaks those
// silently, hours later, on someone else's branch.
//
// The mapping rules here mirror scripts/curate.mjs deliberately, so a movie
// looks identical whether it arrived from the network or from the seed.

import type { DiscoverFilters, Movie, MovieVideo, VideoSource } from '@/types';
import { seedMovies, seedMoviesWithVideo } from './seed';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const TMDB_BASE = 'https://api.themoviedb.org/3';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w780';

/**
 * TMDB's v4 read-access token. Read-only, non-commercial, free-tier, and
 * rate-limited by IP. It ships in the bundle on purpose — this project has no
 * server-side component to hide it behind (Spark plan, no Cloud Functions, no
 * proxy; AGENTS.md §3), and the check-secrets hook allows this one name.
 *
 * Expo's babel plugin inlines `process.env.EXPO_PUBLIC_*` only when it is
 * written out literally; a dynamic `process.env[name]` lookup is undefined on
 * device. Keep it spelled out, and restart the bundler with --clear after
 * editing .env. Unset simply means every call below falls back to seed.
 */
const READ_TOKEN = process.env.EXPO_PUBLIC_TMDB_READ_TOKEN?.trim();

/**
 * Per-request budget. A call that hangs on venue Wi-Fi is indistinguishable
 * from an outage and has to fall back just as fast (issue #15).
 */
const REQUEST_TIMEOUT_MS = 3_000;

/**
 * Whole-operation budget. getDeck() hydrates ~40 movies; at 3s each a degraded
 * network would outlast the demo, so the pool stops taking new work past this
 * and we ship whatever landed.
 */
const OPERATION_TIMEOUT_MS = 8_000;

/** TMDB's IP limit is ~40–50 req/s. 6 in flight is polite and still fast. */
const CONCURRENCY = 6;

/** /discover pages to pull. 20 results a page; we need ≥ 20 *with* a video. */
const DISCOVER_PAGES = 2;

/** Below this the deck is padded from seed rather than handed over short. */
const MIN_DECK = 20;

/** Related titles to hydrate per similar() call — #13 only needs a handful. */
const SIMILAR_LIMIT = 12;

/** Clip > Teaser > Trailer (AGENTS.md §4). Lower rank wins. */
const TYPE_RANK: Record<string, number> = { Clip: 0, Teaser: 1, Trailer: 2 };

const SOURCE_BY_TYPE: Record<string, VideoSource> = {
  Clip: 'tmdb-clip',
  Teaser: 'trailer',
  Trailer: 'trailer',
};

/** Seconds to skip past studio idents and bumpers, per source. */
const START_BY_SOURCE: Record<VideoSource, number> = {
  'tmdb-clip': 5,
  movieclips: 3,
  trailer: 8,
};

/** Target segment length. `end` is advisory — see MovieVideo in types/movie.ts. */
const SEGMENT_SECONDS = 18;

/**
 * Billed cast to keep per movie. taste.ts scores the first three; the extra two
 * cost nothing (credits rides along on append_to_response) and mean a change to
 * that number does not need every movie refetched. Matches scripts/curate.mjs.
 */
const CAST_LIMIT = 5;

/** TMDB returns full names; these read better on a card. Display only. */
const GENRE_DISPLAY: Record<string, string> = {
  'Science Fiction': 'Sci-Fi',
  'TV Movie': 'TV',
};

// ─────────────────────────────────────────────────────────────────────────────
// Raw TMDB payloads. Everything is optional because the only thing worse than a
// missing field is a crash on the demo path — the mapper below decides what is
// actually required.
// ─────────────────────────────────────────────────────────────────────────────

interface TmdbVideo {
  key?: string;
  site?: string;
  type?: string;
  official?: boolean;
  iso_639_1?: string;
  iso_3166_1?: string;
  size?: number;
}

interface TmdbMovieDetail {
  id?: number;
  title?: string;
  release_date?: string;
  overview?: string | null;
  poster_path?: string | null;
  genres?: { id?: number; name?: string }[];
  videos?: { results?: TmdbVideo[] };
  keywords?: { keywords?: { name?: string }[] };
  credits?: { cast?: { id?: number; order?: number }[] };
  'watch/providers'?: {
    results?: Record<string, { flatrate?: { provider_name?: string }[] } | undefined>;
  };
}

interface TmdbListResponse {
  results?: { id?: number }[];
}

type QueryParams = Record<string, string | number | undefined>;

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hydrated movies by TMDB id. #12 re-ranks the deck after every swipe and #13
 * seeds from top likes — neither may trigger a refetch, so this lives for the
 * whole session. Seed fallbacks are deliberately NOT cached, so a movie fetched
 * while the Wi-Fi was down upgrades to the real thing once it comes back.
 */
const movieCache = new Map<number, Movie>();

const seedById = new Map<number, Movie>(seedMovies.map((movie) => [movie.id, movie]));

/**
 * When the network last answered, and when it last failed to. Recorded as each
 * call settles, so isOffline() below means "was the most recent thing we
 * learned a failure". Both start at 0, so it is false before the first call.
 *
 * This is two stamps rather than one boolean for legibility, not for
 * correctness: the newest stamp wins, which is the same last-writer rule a flag
 * had. It buys an explicit markOnline()/markOffline() at each of the six call
 * sites, and ties (same millisecond) resolve to online rather than to whichever
 * assignment ran second. See isOffline() for what it does NOT fix.
 */
let lastNetworkOkAt = 0;
let lastNetworkFailedAt = 0;

/** TMDB answered. An empty but valid response counts — see EmptyResultError. */
function markOnline(): void {
  lastNetworkOkAt = Date.now();
}

/** The network did not answer: timeout, abort, no token, or a non-2xx. */
function markOffline(): void {
  lastNetworkFailedAt = Date.now();
}

/**
 * True when the network did not answer the most recent catalog call, so seed
 * data was served instead. False before the first call, and false when TMDB
 * answered but had nothing usable — an empty /discover page is not an outage,
 * and #26 and the About screen would be lying if it read as one.
 *
 * Self-healing: any later call that succeeds moves lastNetworkOkAt past the
 * failure, so this goes false again once the Wi-Fi comes back.
 *
 * KNOWN GAP, for #26. Since #13 this module has parallel callers — seeding
 * fires similar() three times at once — and one global "how did the last call
 * go" cannot describe three calls with different outcomes. Two succeed and one
 * times out, and the answer is whichever settled last: offline if the timeout
 * was slowest, online if it failed fast and the successes landed after it.
 * Both orderings are plausible on venue Wi-Fi. Fixing it means deciding what
 * the flag is *for* — is a degraded connection "offline"? — which needs the
 * banner #26 builds, not a guess here.
 *
 * Nothing on the demo path should branch on this: the whole point is that the
 * deck looks the same either way. It is a status indicator, not control flow.
 */
export function isOffline(): boolean {
  return lastNetworkFailedAt > lastNetworkOkAt;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * React Native's URL polyfill has no working `searchParams`, so the query is
 * built by hand here rather than with `new URL()` the way scripts/curate.mjs
 * (plain Node) can.
 */
function buildUrl(path: string, params: QueryParams): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${TMDB_BASE}${path}${query ? `?${query}` : ''}`;
}

/**
 * One TMDB call, capped by both the per-request timeout and the caller's
 * overall deadline, whichever is sooner. Throws on anything that is not a 2xx
 * with JSON — callers turn that into a seed fallback, never into an error the
 * user sees. There is no retry: a retry is one more 3s hang on the swipe loop,
 * and the fallback is already good.
 */
async function tmdb<T>(path: string, params: QueryParams, deadline: number): Promise<T> {
  if (!READ_TOKEN) {
    throw new Error('EXPO_PUBLIC_TMDB_READ_TOKEN is not set — offline catalog only');
  }

  const budget = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
  if (budget <= 0) throw new Error(`TMDB ${path}: deadline already passed`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const response = await fetch(buildUrl(path, { language: 'en-US', ...params }), {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${READ_TOKEN}`, accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`TMDB ${path}: HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping TMDB → Movie
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Best YouTube video on a movie, by the same ranking scripts/curate.mjs uses.
 *
 * Unlike curate.mjs this CANNOT validate the key — the YouTube Data API needs a
 * key we deliberately do not ship, and a videos.list per card would burn quota
 * on the swipe loop. So a live TMDB key may still be deleted, region-blocked,
 * age-restricted or embedding-disabled. #7's poster fallback is the net, and
 * toMovie() below prefers seed's pre-validated key wherever one exists.
 */
function pickVideo(detail: TmdbMovieDetail): MovieVideo | null {
  const best = (detail.videos?.results ?? [])
    .filter(
      (video): video is TmdbVideo & { key: string; type: string } =>
        video.site === 'YouTube' &&
        typeof video.key === 'string' &&
        video.key.length > 0 &&
        typeof video.type === 'string' &&
        video.type in TYPE_RANK,
    )
    .map((video) => ({
      key: video.key,
      source: SOURCE_BY_TYPE[video.type],
      score:
        TYPE_RANK[video.type] * 1000 +
        (video.official ? 0 : 100) +
        (video.iso_639_1 === 'en' ? 0 : 40) +
        (video.iso_3166_1 === 'US' ? 0 : 20) +
        ((video.size ?? 0) >= 1080 ? 0 : 10),
    }))
    .sort((a, b) => a.score - b.score)[0];

  if (!best) return null;

  const start = START_BY_SOURCE[best.source];
  return { key: best.key, start, end: start + SEGMENT_SECONDS, source: best.source };
}

/** null means the payload can't be shown — no id, no title, or no poster. */
function toMovie(detail: TmdbMovieDetail): Movie | null {
  if (typeof detail.id !== 'number' || !detail.title || !detail.poster_path) return null;

  const year = Number((detail.release_date ?? '').slice(0, 4));
  const genres = (detail.genres ?? []).filter(
    (genre): genre is { id: number; name: string } =>
      typeof genre.id === 'number' && typeof genre.name === 'string',
  );

  // Every seed video survived a YouTube videos.list check in scripts/curate.mjs
  // (public, embeddable, not age-restricted, not US-blocked). We can't run that
  // check on device, so where seed already knows this movie, trust its key over
  // whatever TMDB happens to rank first today.
  const seeded = seedById.get(detail.id);

  return {
    id: detail.id,
    title: detail.title,
    year: Number.isFinite(year) ? year : 0,
    genreIds: genres.map((genre) => genre.id),
    genreNames: genres.map((genre) => GENRE_DISPLAY[genre.name] ?? genre.name),
    keywords: [
      ...new Set(
        (detail.keywords?.keywords ?? [])
          .map((keyword) => keyword.name?.toLowerCase())
          .filter((name): name is string => typeof name === 'string' && name.length > 0),
      ),
    ],
    // Billing order, which is what `cast:` weights in the taste vector assume —
    // TMDB returns `order` explicitly rather than relying on array position.
    castIds: (detail.credits?.cast ?? [])
      .filter(
        (member): member is { id: number; order: number } =>
          typeof member.id === 'number' && typeof member.order === 'number',
      )
      .sort((a, b) => a.order - b.order)
      .slice(0, CAST_LIMIT)
      .map((member) => member.id),
    poster: POSTER_BASE + detail.poster_path,
    overview: typeof detail.overview === 'string' ? detail.overview : '',
    providers: [
      ...new Set(
        (detail['watch/providers']?.results?.US?.flatrate ?? [])
          .map((provider) => provider.provider_name)
          .filter((name): name is string => typeof name === 'string' && name.length > 0),
      ),
    ],
    video: seeded?.video ?? pickVideo(detail),
  };
}

/**
 * One movie, fully hydrated. Throws if the network did not answer; returns null
 * when TMDB answered but the payload is not showable (no poster, no title, or a
 * 404 for an id nobody has). getDeck() and similar() don't care about the
 * difference and flatten both to null, but getMovie() does — it is what tells
 * "this movie doesn't exist" apart from "the Wi-Fi is down".
 */
async function hydrate(id: number, deadline: number): Promise<Movie | null> {
  const cached = movieCache.get(id);
  if (cached) return cached;

  let detail: TmdbMovieDetail;
  try {
    detail = await tmdb<TmdbMovieDetail>(
      `/movie/${id}`,
      { append_to_response: 'videos,watch/providers,keywords,credits' },
      deadline,
    );
  } catch (error) {
    // A 404 is TMDB answering, not the network failing.
    if (error instanceof Error && error.message.endsWith('HTTP 404')) return null;
    throw error;
  }

  const movie = toMovie(detail);
  if (movie) movieCache.set(id, movie);
  return movie;
}

/** hydrate(), flattened for the bulk paths where an unreachable id is just a gap. */
function tryHydrate(id: number, deadline: number): Promise<Movie | null> {
  return hydrate(id, deadline).catch(() => null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TMDB answered, it just had nothing usable — an empty /discover page, or a
 * page whose every title turned out to be poster-only. We still fall back to
 * seed, but this is emphatically NOT the network being down, so isOffline()
 * must stay false or #26 and the About screen lie about it.
 */
class EmptyResultError extends Error {}

function logFallback(what: string, error: unknown): void {
  if (__DEV__) console.warn(`[tmdb] ${what} fell back to seed:`, error);
}

/**
 * Partial network: some hydrations timed out. Rather than hand #6 a short stack
 * (or throw away the movies that did land), pad from seed. Not "offline" — TMDB
 * did answer — so isOffline() stays false.
 */
function topUpFromSeed(deck: Movie[]): Movie[] {
  if (deck.length >= MIN_DECK) return deck;
  const have = new Set(deck.map((movie) => movie.id));
  return [...deck, ...seedMoviesWithVideo.filter((movie) => !have.has(movie.id))];
}

/**
 * Offline stand-in for /similar: seed titles that share genres and keywords.
 * Crude on purpose — #12 owns real scoring — but it keeps #13's candidate pool
 * growing with the Wi-Fi off instead of returning nothing.
 */
function similarFromSeed(id: number): Movie[] {
  const source = seedById.get(id);
  if (!source) return [];

  const genreIds = new Set(source.genreIds);
  const keywords = new Set(source.keywords);

  return seedMoviesWithVideo
    .filter((movie) => movie.id !== id)
    .map((movie) => ({
      movie,
      overlap:
        movie.genreIds.filter((genreId) => genreIds.has(genreId)).length * 2 +
        movie.keywords.filter((keyword) => keywords.has(keyword)).length,
    }))
    .filter((scored) => scored.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, SIMILAR_LIMIT)
    .map((scored) => scored.movie);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — the contract in issue #15
// ─────────────────────────────────────────────────────────────────────────────

function discoverParams(filters: DiscoverFilters | undefined, page: number): QueryParams {
  const providers = filters?.withWatchProviders;
  return {
    page,
    include_adult: 'false',
    include_video: 'false',
    sort_by: filters?.sortBy ?? 'popularity.desc',
    // `,` means AND to /discover and `|` means OR. Both of these are OR by
    // design (see DiscoverFilters): #22 turns one mood into several genres and
    // several near-synonym keywords, and AND-ing them returns an empty page,
    // which this layer would silently serve as a seed fallback.
    with_genres: filters?.withGenres?.join('|'),
    // Exclusion is the one place `,` is right — without_genres drops a title
    // that carries any of the listed ids.
    without_genres: filters?.withoutGenres?.join(','),
    with_keywords: filters?.withKeywords?.join('|'),
    // Same rule as without_genres: drop a title carrying any of these (#22).
    without_keywords: filters?.withoutKeywords?.join(','),
    with_watch_providers: providers?.join('|'),
    watch_region: providers && providers.length > 0 ? 'US' : undefined,
    'vote_average.gte': filters?.minRating,
    // Obscure titles rarely have a trailer on TMDB, and a poster-only card is
    // off-message for a clip-first app. A floor here is cheaper than filtering
    // 40 hydrated movies down to 12 afterwards.
    'vote_count.gte': filters?.minVotes ?? 300,
    'primary_release_date.gte': filters?.releasedAfter ? `${filters.releasedAfter}-01-01` : undefined,
    'primary_release_date.lte': filters?.releasedBefore
      ? `${filters.releasedBefore}-12-31`
      : undefined,
  };
}

/**
 * The swipe deck. Online: /discover/movie, then each result hydrated with
 * videos, watch providers and keywords. Offline, on any error, or with no
 * token: the seed catalog. Movies without a playable video are dropped — this
 * is a clip-first app and #7 would show a static poster.
 */
export async function getDeck(filters?: DiscoverFilters): Promise<Movie[]> {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;

  try {
    // allSettled, not all: the pages go out in parallel, so a single 429 on
    // page 2 would otherwise throw away page 1 and drop the whole live deck.
    const pages = await Promise.allSettled(
      Array.from({ length: DISCOVER_PAGES }, (_, index) =>
        tmdb<TmdbListResponse>('/discover/movie', discoverParams(filters, index + 1), deadline),
      ),
    );
    const landed = pages.filter(
      (page): page is PromiseFulfilledResult<TmdbListResponse> => page.status === 'fulfilled',
    );
    if (landed.length === 0) {
      throw pages.find((page): page is PromiseRejectedResult => page.status === 'rejected')?.reason;
    }

    const ids = [
      ...new Set(
        landed
          .flatMap((page) => page.value.results ?? [])
          .map((result) => result.id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    if (ids.length === 0) throw new EmptyResultError('/discover/movie returned no results');

    const deck = (await mapPool(ids, CONCURRENCY, (id) => tryHydrate(id, deadline))).filter(
      (movie): movie is Movie => movie != null && movie.video !== null,
    );
    if (deck.length === 0) throw new EmptyResultError('no playable movies in the discover page');

    markOnline();
    return topUpFromSeed(deck);
  } catch (error) {
    logFallback('getDeck()', error);
    if (error instanceof EmptyResultError) markOnline();
    else markOffline();
    // A copy: callers own their deck and #6 mutates it as cards are consumed.
    return [...seedMoviesWithVideo];
  }
}

/**
 * One movie by TMDB id. Falls back to seed, then to null if the id is in
 * neither — a null here means "unknown movie", not "network down", so check
 * isOffline() before treating it as a hard miss.
 */
export async function getMovie(id: number): Promise<Movie | null> {
  const cached = movieCache.get(id);
  if (cached) return cached;

  try {
    const movie = await hydrate(id, Date.now() + REQUEST_TIMEOUT_MS);
    // TMDB answered either way, so this is not an outage even when it answered
    // "no such movie" and we end up on seed or on null.
    markOnline();
    return movie ?? seedById.get(id) ?? null;
  } catch (error) {
    logFallback(`getMovie(${id})`, error);
    markOffline();
    return seedById.get(id) ?? null;
  }
}

/**
 * Related titles, for #13's candidate seeding. Merges /recommendations (the
 * better list) with /similar (the broader one), deduped, recommendations first
 * — #13's brief calls for both to come through this layer. Offline it falls
 * back to genre/keyword overlap within the seed, and to [] for an id the seed
 * has never heard of.
 */
export async function similar(id: number): Promise<Movie[]> {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;

  try {
    // allSettled, not all: the two endpoints fail independently (/similar 404s
    // on ids /recommendations is perfectly happy with), and losing the list
    // that did land would drop #13 straight to the seed heuristic.
    const lists = await Promise.allSettled([
      tmdb<TmdbListResponse>(`/movie/${id}/recommendations`, { page: 1 }, deadline),
      tmdb<TmdbListResponse>(`/movie/${id}/similar`, { page: 1 }, deadline),
    ]);
    const landed = lists.filter(
      (list): list is PromiseFulfilledResult<TmdbListResponse> => list.status === 'fulfilled',
    );
    if (landed.length === 0) {
      throw lists.find((list): list is PromiseRejectedResult => list.status === 'rejected')?.reason;
    }

    // Recommendations first — it is the better list, and dedupe keeps that order.
    const ids = [
      ...new Set(
        landed
          .flatMap((list) => list.value.results ?? [])
          .map((result) => result.id)
          .filter((related): related is number => typeof related === 'number' && related !== id),
      ),
    ].slice(0, SIMILAR_LIMIT);
    if (ids.length === 0) throw new EmptyResultError('no related titles');

    const related = (await mapPool(ids, CONCURRENCY, (relatedId) => tryHydrate(relatedId, deadline))).filter(
      (movie): movie is Movie => movie != null && movie.video !== null,
    );
    if (related.length === 0) throw new EmptyResultError('no playable related titles');

    markOnline();
    return related;
  } catch (error) {
    logFallback('similar()', error);
    if (error instanceof EmptyResultError) markOnline();
    else markOffline();
    return similarFromSeed(id);
  }
}

/**
 * Every movie this device can put on screen: the seed catalog plus whatever
 * TMDB has hydrated this session. #17's match watcher ranks the group against
 * this — a title has to be in here to be detectable as a match, which is why
 * the watcher reads it fresh on every member snapshot rather than once.
 * Synchronous and cheap: a Map copy, no network.
 */
export function knownMovies(): Movie[] {
  const known = new Map<number, Movie>(seedById);
  for (const [id, movie] of movieCache) known.set(id, movie);
  return [...known.values()];
}

/** Case, accents, punctuation and a leading article don't make two titles different films. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

/** Gemini misremembers a release year by one often enough; two is a different film. */
const YEAR_TOLERANCE = 1;

function yearFits(year: number, wanted?: number): boolean {
  return !wanted || !year || Math.abs(year - wanted) <= YEAR_TOLERANCE;
}

/**
 * A title Gemini named, resolved to a real, playable TMDB movie — #23's guard
 * against invented films (AGENTS.md §3). Only an exact title match counts
 * (after normalizeTitle), never TMDB's fuzzy first hit, and when a year is
 * given it must agree within a year so a remake can't stand in for the
 * original. Returns null when nothing matches or the match has no trailer.
 *
 * Offline it matches against the seed catalog, whose ids are all real. Never
 * throws, and leaves the offline flag alone: a lookup is not a deck fetch.
 */
export async function searchMovie(title: string, year?: number): Promise<Movie | null> {
  const wanted = normalizeTitle(title);
  if (!wanted) return null;
  const matches = (movie: { title: string; year: number }) =>
    normalizeTitle(movie.title) === wanted && yearFits(movie.year, year);

  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  let ids: number[];
  try {
    const found = await tmdb<{
      results?: { id?: number; title?: string; original_title?: string; release_date?: string }[];
    }>('/search/movie', { query: title.trim(), page: 1, include_adult: 'false' }, deadline);
    ids = (found.results ?? [])
      .filter((result): result is typeof result & { id: number } => typeof result.id === 'number')
      .filter((result) => {
        const resultYear = Number((result.release_date ?? '').slice(0, 4)) || 0;
        return [result.title, result.original_title].some(
          (name) => typeof name === 'string' && matches({ title: name, year: resultYear }),
        );
      })
      .map((result) => result.id);
  } catch (error) {
    if (__DEV__) console.warn(`[tmdb] searchMovie(${title}) fell back to seed:`, error);
    return seedMoviesWithVideo.find(matches) ?? null;
  }

  // TMDB orders by relevance, so the first playable exact match is the film meant.
  for (const id of ids) {
    const movie = await tryHydrate(id, deadline);
    if (movie?.video) return movie;
  }
  return null;
}

/**
 * TMDB keyword id for a word, for #22's mood filters: /discover takes keyword
 * ids, not names. Prefers an exact name match over TMDB's fuzzy first hit.
 * Null when TMDB has no match or can't be reached. Never throws, and leaves
 * the offline flag alone, since a keyword lookup is not a deck fetch.
 */
export async function searchKeywordId(name: string): Promise<number | null> {
  const query = name.trim().toLowerCase();
  if (!query) return null;
  try {
    const found = await tmdb<{ results?: { id?: number; name?: string }[] }>(
      '/search/keyword',
      { query, page: 1 },
      Date.now() + REQUEST_TIMEOUT_MS,
    );
    const results = (found.results ?? []).filter(
      (result): result is { id: number; name: string } =>
        typeof result.id === 'number' && typeof result.name === 'string',
    );
    return (results.find((result) => result.name.toLowerCase() === query) ?? results[0])?.id ?? null;
  } catch (error) {
    if (__DEV__) console.warn(`[tmdb] searchKeywordId(${query}) failed:`, error);
    return null;
  }
}
