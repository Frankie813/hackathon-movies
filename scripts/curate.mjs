#!/usr/bin/env node
/**
 * scripts/curate.mjs — builds the offline seed catalog (issue #4).
 *
 * Runs once, locally, by a human. The OUTPUT (lib/seed.json) is committed;
 * the app never calls this at runtime. seed.json is the offline safety net the
 * whole demo rests on (PLAN.md §L rates venue Wi-Fi as the top risk), and it
 * gates #12 (taste vector), #15 (fetch layer fallback) and #38 (pre-generated
 * narration).
 *
 * Pipeline, per AGENTS.md §4 and PLAN.md §D:
 *
 *   TITLES (hand-picked, below)
 *     -> TMDB /search/movie            resolve title+year to a TMDB id
 *     -> TMDB /movie/{id}?append_to_response=videos,watch/providers,keywords
 *     -> rank YouTube videos           Clip > Teaser > Trailer, official first
 *     -> YouTube search (optional)     restricted to the Movieclips channel
 *     -> YouTube videos.list           VALIDATE: embeddable, public, not
 *                                      age-restricted, not US-region-blocked
 *     -> lib/seed.json                 Movie[] exactly per examples/types.ts
 *
 * We store YouTube *keys* only. Never download, rehost, clip or proxy a video
 * file — that is the legal decision the whole project rests on (AGENTS.md §3).
 *
 * Usage:
 *   node scripts/curate.mjs                    # full run
 *   node scripts/curate.mjs --limit 5          # smoke test on 5 titles
 *   node scripts/curate.mjs --dry-run          # print the report, write nothing
 *   node scripts/curate.mjs --no-yt-search     # skip the Movieclips fallback
 *   node scripts/curate.mjs --force-fallback   # ignore TMDB videos, exercise
 *                                              # the Movieclips path end to end
 *   node scripts/curate.mjs --max-yt-search 10 # cap search.list quota spend
 *
 * Env (from .env, never committed):
 *   TMDB_READ_ACCESS_TOKEN  v4 bearer (preferred) — https://www.themoviedb.org/settings/api
 *   TMDB_API_KEY            v3 key (fallback)
 *   YOUTUBE_API_KEY         YouTube Data API v3 key, for the validation step
 *   MOVIECLIPS_CHANNEL_ID   optional override if handle resolution fails
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = resolve(ROOT, 'lib/seed.json');

// ─────────────────────────────────────────────────────────────────────────────
// The catalog. Hand-picked for on-sight recognisability and visual variety —
// judges have two minutes and should know every poster. Deliberately spread
// across decades, genres and tones so the taste vector (#12) has something to
// separate and the onboarding deck (#9) has polarizing titles to draw from.
//
// Resolved to TMDB ids by /search/movie rather than hardcoded, so a typo
// surfaces as a loud "no match" instead of a silently wrong film.
// ─────────────────────────────────────────────────────────────────────────────
const TITLES = [
  // Sci-fi / spectacle
  { title: 'Inception', year: 2010 },
  { title: 'The Matrix', year: 1999 },
  { title: 'Interstellar', year: 2014 },
  { title: 'Dune', year: 2021 },
  { title: 'Blade Runner 2049', year: 2017 },
  { title: 'Arrival', year: 2016 },
  { title: 'The Martian', year: 2015 },
  { title: 'Gravity', year: 2013 },
  { title: 'Jurassic Park', year: 1993 },
  { title: 'Mad Max: Fury Road', year: 2015 },
  { title: 'Everything Everywhere All at Once', year: 2022 },
  { title: 'Back to the Future', year: 1985 },

  // Superhero / franchise action
  { title: 'The Dark Knight', year: 2008 },
  { title: 'Spider-Man: Into the Spider-Verse', year: 2018 },
  { title: 'Spider-Man: No Way Home', year: 2021 },
  { title: 'Black Panther', year: 2018 },
  { title: 'Guardians of the Galaxy', year: 2014 },
  { title: 'Avengers: Infinity War', year: 2018 },
  { title: 'Deadpool', year: 2016 },
  { title: 'John Wick', year: 2014 },
  { title: 'Mission: Impossible - Fallout', year: 2018 },
  { title: 'Casino Royale', year: 2006 },
  { title: 'The Bourne Identity', year: 2002 },
  { title: 'Top Gun: Maverick', year: 2022 },

  // Thriller / crime / prestige
  { title: 'Parasite', year: 2019 },
  { title: 'Pulp Fiction', year: 1994 },
  { title: 'The Godfather', year: 1972 },
  { title: 'Goodfellas', year: 1990 },
  { title: 'Fight Club', year: 1999 },
  { title: 'The Silence of the Lambs', year: 1991 },
  { title: 'Se7en', year: 1995 },
  { title: 'Knives Out', year: 2019 },
  { title: 'Whiplash', year: 2014 },
  { title: 'Oppenheimer', year: 2023 },
  { title: 'Forrest Gump', year: 1994 },
  { title: 'Titanic', year: 1997 },

  // Horror
  { title: 'The Shining', year: 1980 },
  { title: 'Alien', year: 1979 },
  { title: 'Jaws', year: 1975 },
  { title: 'Get Out', year: 2017 },
  { title: 'Hereditary', year: 2018 },
  { title: 'A Quiet Place', year: 2018 },
  { title: 'It', year: 2017 },
  { title: 'The Conjuring', year: 2013 },

  // Animation / family
  { title: 'The Lion King', year: 1994 },
  { title: 'Toy Story', year: 1995 },
  { title: 'Spirited Away', year: 2001 },
  { title: 'Coco', year: 2017 },
  { title: 'Shrek', year: 2001 },
  { title: 'Finding Nemo', year: 2003 },
  { title: 'The Incredibles', year: 2004 },
  { title: 'WALL-E', year: 2008 },
  { title: 'Up', year: 2009 },
  { title: 'Inside Out', year: 2015 },

  // Comedy
  { title: 'The Grand Budapest Hotel', year: 2014 },
  { title: 'Superbad', year: 2007 },
  { title: 'Bridesmaids', year: 2011 },
  { title: 'The Hangover', year: 2009 },
  { title: 'Mean Girls', year: 2004 },
  { title: 'Barbie', year: 2023 },
  { title: 'Crazy Rich Asians', year: 2018 },
  { title: 'The Devil Wears Prada', year: 2006 },

  // Romance / drama
  { title: 'La La Land', year: 2016 },
  { title: 'Eternal Sunshine of the Spotless Mind', year: 2004 },
  { title: '10 Things I Hate About You', year: 1999 },
  { title: 'Call Me by Your Name', year: 2017 },
  { title: 'Little Women', year: 2019 },
  { title: 'The Notebook', year: 2004 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

/** Clip > Teaser > Trailer (AGENTS.md §4). Lower rank wins. */
const TYPE_RANK = { Clip: 0, Teaser: 1, Trailer: 2 };

/** Maps a TMDB video type onto the VideoSource union in examples/types.ts. */
const SOURCE_BY_TYPE = { Clip: 'tmdb-clip', Teaser: 'trailer', Trailer: 'trailer' };

/**
 * Seconds to skip at the head of each source, to get past studio logos and
 * bumpers. Trailers front-load distributor idents; Movieclips prepends a short
 * channel sting; TMDB "Clip" entries usually open on the scene itself.
 */
const START_BY_SOURCE = { 'tmdb-clip': 5, movieclips: 3, trailer: 8 };

/** Target segment length. `end` is advisory — see the note on MovieVideo below. */
const SEGMENT_SECONDS = 18;

/**
 * A video too short to carry a segment runs out mid-swipe and YouTube rolls its
 * end screen — related-video thumbnails and a replay button, over our card, in
 * front of judges. #7 loops on `ended`, but the end card still flashes. Cheaper
 * to reject the video here and take the next-ranked one; a movie usually has
 * a dozen candidates.
 */
const MIN_SEGMENT_SECONDS = 12;

/** TMDB's IP limit is ~40-50 req/s; 6 in flight is polite and still fast. */
const TMDB_CONCURRENCY = 6;

/** search.list costs 100 quota units against a 10,000/day budget. Spend it carefully. */
const DEFAULT_MAX_YT_SEARCH = 30;

/** TMDB returns full names; these read better on a card. Display only. */
const GENRE_DISPLAY = {
  'Science Fiction': 'Sci-Fi',
  'TV Movie': 'TV',
};

const TMDB_BASE = 'https://api.themoviedb.org/3';
const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w780';

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    limit: Infinity,
    out: DEFAULT_OUT,
    dryRun: false,
    ytSearch: true,
    forceFallback: false,
    maxYtSearch: DEFAULT_MAX_YT_SEARCH,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) die(`${flag} needs a value`);
      i += 1;
      return value;
    };
    if (flag === '--limit') args.limit = Number(next());
    else if (flag === '--out') args.out = resolve(process.cwd(), next());
    else if (flag === '--max-yt-search') args.maxYtSearch = Number(next());
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--no-yt-search') args.ytSearch = false;
    else if (flag === '--force-fallback') args.forceFallback = true;
    else if (flag === '--help' || flag === '-h') {
      console.log('See the header comment in scripts/curate.mjs for usage.');
      process.exit(0);
    } else die(`Unknown flag: ${flag}`);
  }
  return args;
}

function die(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** Loads .env without adding a dependency. Node >= 20.12 ships loadEnvFile. */
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
    return;
  }
  die('Node >= 20.12 is required (process.loadEnvFile). You are on ' + process.version);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with retries. 429 and 5xx are transient for both APIs; anything else
 * is a real error (a bad key, a deleted id) and should surface immediately.
 */
async function fetchJson(url, init = {}, { attempts = 4, label = 'request' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      lastError = error;
      await sleep(250 * 2 ** attempt);
      continue;
    }

    if (response.ok) return response.json();

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 250 * 2 ** attempt;
      lastError = new Error(`${label}: HTTP ${response.status}`);
      await sleep(waitMs);
      continue;
    }

    const body = await response.text().catch(() => '');
    throw new Error(`${label}: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  throw lastError ?? new Error(`${label}: exhausted retries`);
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// TMDB
// ─────────────────────────────────────────────────────────────────────────────

function tmdbClient() {
  const bearer = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!bearer && !apiKey) {
    die(
      'No TMDB credential. Add TMDB_READ_ACCESS_TOKEN (v4 bearer, preferred) or\n' +
        '  TMDB_API_KEY (v3) to .env — get either from https://www.themoviedb.org/settings/api',
    );
  }

  return async function tmdb(path, params = {}) {
    const url = new URL(TMDB_BASE + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const init = {};
    if (bearer) init.headers = { Authorization: `Bearer ${bearer}`, accept: 'application/json' };
    else url.searchParams.set('api_key', apiKey);
    return fetchJson(url, init, { label: `TMDB ${path}` });
  };
}

const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Resolves { title, year } to a TMDB id. Only an exact (normalized) title match
 * within a year of the one we asked for is accepted — a fuzzy match means the
 * list above has a typo, and a silently wrong film is worse than a gap.
 */
async function resolveId(tmdb, entry) {
  const search = (params) =>
    tmdb('/search/movie', { query: entry.title, include_adult: false, language: 'en-US', ...params });

  const wanted = normalize(entry.title);
  const pickExact = (results) =>
    results.find((r) => normalize(r.title) === wanted)
      ?? results.find((r) => normalize(r.original_title ?? '') === wanted);

  // TMDB's primary release year occasionally differs from the year everyone
  // knows a film by (festival vs wide release), so fall back to an unfiltered
  // search and check the year ourselves.
  let { results = [] } = await search({ primary_release_year: entry.year });
  let exact = pickExact(results);

  if (!exact) {
    ({ results = [] } = await search({}));
    exact = pickExact(results.filter((r) => {
      const year = Number((r.release_date ?? '').slice(0, 4));
      return Number.isFinite(year) && Math.abs(year - entry.year) <= 1;
    }));
  }

  if (exact) return { entry, id: exact.id };
  const closest = results[0];
  return {
    entry,
    error: closest
      ? `no exact title match (closest: "${closest.title}" ${(closest.release_date ?? '').slice(0, 4)} #${closest.id})`
      : 'no TMDB search result',
  };
}

async function fetchDetail(tmdb, id) {
  return tmdb(`/movie/${id}`, {
    language: 'en-US',
    append_to_response: 'videos,watch/providers,keywords',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Video candidate ranking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ranks a movie's TMDB videos into a preference-ordered candidate list.
 * Lower score wins. Every candidate still has to survive YouTube validation —
 * TMDB happily lists keys for videos that were deleted years ago.
 */
function rankTmdbVideos(detail) {
  return (detail.videos?.results ?? [])
    .filter((v) => v.site === 'YouTube' && typeof v.key === 'string' && v.key.length > 0)
    .filter((v) => v.type in TYPE_RANK)
    .map((v) => ({
      key: v.key,
      source: SOURCE_BY_TYPE[v.type],
      label: `${v.type}${v.official ? ' (official)' : ''}`,
      score:
        TYPE_RANK[v.type] * 1000 +
        (v.official ? 0 : 100) +
        (v.iso_639_1 === 'en' ? 0 : 40) +
        (v.iso_3166_1 === 'US' ? 0 : 20) +
        (v.size >= 1080 ? 0 : 10),
    }))
    .sort((a, b) => a.score - b.score);
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube Data API v3
// ─────────────────────────────────────────────────────────────────────────────

function youtubeClient() {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return null;

  return async function yt(path, params) {
    const url = new URL(YT_BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set('key', key);
    return fetchJson(url, {}, { label: `YouTube ${path}` });
  };
}

/** ISO 8601 duration (PT1M30S) -> seconds. */
function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => (x === undefined ? 0 : Number(x)));
  return d * 86400 + h * 3600 + min * 60 + s;
}

/**
 * The check that keeps a black rectangle off the screen in front of judges.
 * Returns null if the video is safe to embed, or a human-readable reason.
 */
function videoProblem(item) {
  if (!item) return 'not found (deleted or private)';
  const status = item.status ?? {};
  if (status.privacyStatus !== 'public') return `privacyStatus=${status.privacyStatus}`;
  if (status.uploadStatus !== 'processed') return `uploadStatus=${status.uploadStatus}`;
  if (status.embeddable !== true) return 'embedding disabled';

  const details = item.contentDetails ?? {};
  if (details.contentRating?.ytRating === 'ytAgeRestricted') return 'age-restricted';

  const region = details.regionRestriction;
  if (region?.blocked?.includes('US')) return 'blocked in US';
  if (region?.allowed && !region.allowed.includes('US')) return 'not allowed in US';

  return null;
}

/** True if the video is long enough to fill a segment from its start offset. */
function longEnough(candidate, statusItem) {
  const duration = parseDuration(statusItem?.contentDetails?.duration);
  if (!duration) return true; // unknown length — don't reject on a guess
  return duration >= START_BY_SOURCE[candidate.source] + MIN_SEGMENT_SECONDS;
}

/**
 * Best playable candidate: prefer one that is both valid and long enough, but
 * take a valid-but-short video over no video at all — a 10-second clip still
 * beats a static poster on the demo path.
 */
function pickBest(list, statuses) {
  const playable = list.filter((c) => videoProblem(statuses.get(c.key)) === null);
  return playable.find((c) => longEnough(c, statuses.get(c.key))) ?? playable[0] ?? null;
}

/** videos.list accepts 50 ids per call and costs 1 quota unit regardless. */
async function fetchVideoStatuses(yt, keys) {
  const byKey = new Map();
  const unique = [...new Set(keys)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const { items = [] } = await yt('/videos', {
      part: 'status,contentDetails',
      id: batch.join(','),
      maxResults: 50,
    });
    for (const item of items) byKey.set(item.id, item);
  }
  return byKey;
}

/**
 * Resolves the Movieclips channel id from its handle. We refuse to hardcode a
 * channel id we cannot verify at runtime — a wrong id would silently return
 * zero results and look like "no clip available" for every movie.
 */
async function resolveMovieclipsChannel(yt) {
  const override = process.env.MOVIECLIPS_CHANNEL_ID?.trim();
  if (override) return override;
  try {
    const { items = [] } = await yt('/channels', { part: 'id', forHandle: '@MOVIECLIPS' });
    return items[0]?.id ?? null;
  } catch (error) {
    console.warn(`  ! Movieclips handle lookup failed: ${error.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape
// ─────────────────────────────────────────────────────────────────────────────

/** Clamps the segment to the real video length so `start` never lands past the end. */
function buildVideo(candidate, statusItem) {
  const duration = parseDuration(statusItem?.contentDetails?.duration);
  let start = START_BY_SOURCE[candidate.source];
  let end = start + SEGMENT_SECONDS;

  if (duration && duration > 0) {
    if (end > duration) {
      end = duration;
      start = Math.max(0, Math.min(start, duration - 5));
    }
    if (start >= end) start = 0;
  }

  return { key: candidate.key, start, end, source: candidate.source };
}

function buildMovie(detail, video) {
  const year = Number((detail.release_date ?? '').slice(0, 4));
  const providers = (detail['watch/providers']?.results?.US?.flatrate ?? [])
    .map((p) => p.provider_name)
    .filter(Boolean);

  return {
    id: detail.id,
    title: detail.title,
    year: Number.isFinite(year) ? year : 0,
    genreIds: (detail.genres ?? []).map((g) => g.id),
    genreNames: (detail.genres ?? []).map((g) => GENRE_DISPLAY[g.name] ?? g.name),
    keywords: [
      ...new Set((detail.keywords?.keywords ?? []).map((k) => k.name.toLowerCase())),
    ],
    poster: POSTER_BASE + detail.poster_path,
    providers: [...new Set(providers)],
    video,
  };
}

/**
 * Guards the contract in examples/types.ts. #12 reads genreIds and keywords,
 * #15 returns this shape and #38 iterates it — a drift here breaks them
 * silently, hours later, on someone else's branch.
 */
function assertMovieShape(movie) {
  const problems = [];
  const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

  if (!Number.isInteger(movie.id)) problems.push('id must be an integer');
  if (typeof movie.title !== 'string' || !movie.title) problems.push('title must be a non-empty string');
  if (!Number.isInteger(movie.year) || movie.year < 1900) problems.push('year looks wrong');
  if (!Array.isArray(movie.genreIds) || !movie.genreIds.every(Number.isInteger)) {
    problems.push('genreIds must be an array of integers');
  }
  if (!isStringArray(movie.genreNames)) problems.push('genreNames must be an array of strings');
  if (!isStringArray(movie.keywords)) problems.push('keywords must be an array of strings');
  if (!movie.poster?.startsWith(POSTER_BASE + '/')) problems.push('poster must be a full w780 URL');
  if (!isStringArray(movie.providers)) problems.push('providers must be an array of strings');

  if (movie.video !== null) {
    const v = movie.video;
    if (typeof v?.key !== 'string' || !v.key) problems.push('video.key must be a non-empty string');
    if (!Number.isFinite(v?.start) || v.start < 0) problems.push('video.start must be >= 0');
    if (!Number.isFinite(v?.end) || v.end <= v?.start) problems.push('video.end must be > start');
    if (!['tmdb-clip', 'movieclips', 'trailer'].includes(v?.source)) problems.push('video.source not in the union');
  }

  return problems;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const tmdb = tmdbClient();
  const yt = youtubeClient();

  if (!yt) {
    die(
      'No YOUTUBE_API_KEY in .env. Every key MUST be validated before it ships —\n' +
        '  an unvalidated key is a black rectangle in front of judges (issue #4 AC).\n' +
        '  Enable YouTube Data API v3 and mint a key:\n' +
        '    https://console.cloud.google.com/apis/library/youtube.googleapis.com\n' +
        '    https://console.cloud.google.com/apis/credentials',
    );
  }

  const wanted = TITLES.slice(0, args.limit);
  console.log(`\nCurating ${wanted.length} titles -> ${args.out}\n`);

  // 1. Resolve TMDB ids.
  console.log('1/4  Resolving TMDB ids...');
  const resolved = await mapPool(wanted, TMDB_CONCURRENCY, (entry) => resolveId(tmdb, entry));
  const unresolved = resolved.filter((r) => r.error);
  for (const r of unresolved) console.warn(`  ! ${r.entry.title} (${r.entry.year}): ${r.error}`);
  const ids = resolved.filter((r) => r.id);
  console.log(`     ${ids.length} resolved, ${unresolved.length} skipped\n`);

  // 2. Pull details.
  console.log('2/4  Fetching TMDB details...');
  const details = await mapPool(ids, TMDB_CONCURRENCY, async (r) => {
    try {
      return { entry: r.entry, detail: await fetchDetail(tmdb, r.id) };
    } catch (error) {
      console.warn(`  ! ${r.entry.title}: ${error.message}`);
      return null;
    }
  });
  const movies = details.filter((d) => d && d.detail.poster_path);
  for (const d of details) {
    if (d && !d.detail.poster_path) console.warn(`  ! ${d.detail.title}: no poster — dropped`);
  }
  console.log(`     ${movies.length} with posters\n`);

  // 3. Validate TMDB video candidates in one batched videos.list sweep.
  console.log('3/4  Validating YouTube keys...');
  // --force-fallback drops every TMDB candidate so the Movieclips path runs for
  // real. Without it that path stays dead code whenever TMDB covers the catalog,
  // which is exactly when nobody notices it has rotted.
  const candidates = movies.map(({ detail }) => ({
    detail,
    list: args.forceFallback ? [] : rankTmdbVideos(detail),
  }));
  const statuses = await fetchVideoStatuses(yt, candidates.flatMap((c) => c.list.map((v) => v.key)));

  const picked = new Map(); // detail.id -> { candidate, statusItem }
  const needsFallback = [];
  for (const { detail, list } of candidates) {
    const ok = pickBest(list, statuses);
    if (ok) picked.set(detail.id, { candidate: ok, statusItem: statuses.get(ok.key) });
    else needsFallback.push(detail);
  }
  console.log(`     ${picked.size} from TMDB, ${needsFallback.length} need a fallback\n`);

  // 4. Movieclips fallback for whatever TMDB could not cover. search.list costs
  //    100 quota units a call against a 10,000/day budget, so it is capped.
  if (args.ytSearch && needsFallback.length > 0) {
    console.log('4/4  Movieclips fallback search...');
    const channelId = await resolveMovieclipsChannel(yt);
    if (!channelId) {
      console.warn('     ! Could not resolve the Movieclips channel — skipping fallback.');
      console.warn('       Set MOVIECLIPS_CHANNEL_ID in .env to force it.\n');
    } else {
      const budget = needsFallback.slice(0, args.maxYtSearch);
      if (budget.length < needsFallback.length) {
        console.warn(`     (capped at ${args.maxYtSearch} searches; ${needsFallback.length - budget.length} left without video)`);
      }
      for (const detail of budget) {
        const year = (detail.release_date ?? '').slice(0, 4);
        let found;
        try {
          const { items = [] } = await yt('/search', {
            part: 'snippet',
            type: 'video',
            channelId,
            videoEmbeddable: 'true',
            maxResults: 5,
            q: `${detail.title} ${year}`,
          });
          found = items.map((i) => i.id.videoId).filter(Boolean);
        } catch (error) {
          console.warn(`     ! ${detail.title}: ${error.message}`);
          continue;
        }
        if (found.length === 0) continue;

        const fallbackStatuses = await fetchVideoStatuses(yt, found);
        const best = pickBest(
          found.map((key) => ({ key, source: 'movieclips', label: 'Movieclips' })),
          fallbackStatuses,
        );
        if (best) picked.set(detail.id, { candidate: best, statusItem: fallbackStatuses.get(best.key) });
      }
      console.log('');
    }
  } else {
    console.log('4/4  Movieclips fallback skipped.\n');
  }

  // Assemble.
  const seed = [];
  const report = [];
  for (const { entry, detail } of movies) {
    const hit = picked.get(detail.id);
    const video = hit ? buildVideo(hit.candidate, hit.statusItem) : null;
    const movie = buildMovie(detail, video);

    const problems = assertMovieShape(movie);
    if (problems.length > 0) {
      die(`${detail.title} violates the Movie contract: ${problems.join('; ')}`);
    }

    seed.push(movie);
    report.push({
      title: `${movie.title} (${movie.year})`,
      video: hit ? `${hit.candidate.label} ${video.key} ${video.start}-${video.end}s` : 'NONE (poster only)',
      providers: movie.providers.length,
      keywords: movie.keywords.length,
      requested: entry.title,
    });
  }

  // Report.
  const withVideo = seed.filter((m) => m.video).length;
  const bySource = seed.reduce((acc, m) => {
    const k = m.video?.source ?? 'null';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  console.log('─'.repeat(72));
  for (const r of report) {
    console.log(`  ${r.title.padEnd(44)} ${r.video}`);
  }
  console.log('─'.repeat(72));
  console.log(`  ${seed.length} movies · ${withVideo} with a validated video · ${seed.length - withVideo} poster-only`);
  console.log(`  by source: ${JSON.stringify(bySource)}`);
  const noProviders = seed.filter((m) => m.providers.length === 0).length;
  if (noProviders) console.log(`  ${noProviders} with no US flatrate provider (card shows no badge)`);
  console.log('─'.repeat(72) + '\n');

  if (args.dryRun) {
    console.log('--dry-run: nothing written.\n');
    return;
  }

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(seed, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${seed.length} movies to ${args.out}\n`);
}

main().catch((error) => die(error.stack ?? String(error)));
