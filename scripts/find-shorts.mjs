#!/usr/bin/env node
/**
 * scripts/find-shorts.mjs — finds a vertical (9:16) YouTube Short per movie so
 * the swipe card can fill the whole phone screen instead of zooming a 16:9
 * trailer. Companion to scripts/curate.mjs (#4); runs once, locally, by a
 * human. The OUTPUT is committed; the app never calls this at runtime.
 *
 * YouTube's Data API has no Shorts type and no orientation filter, and TMDB
 * has no vertical video data at all, so this is a two-step hunt:
 *
 *   seed file (lib/seed.json or data/seedMovies.ts)
 *     -> TMDB /movie/{id}              production companies (to tell official
 *                                      uploads from fan edits)
 *     -> YouTube search.list           "<title> <year> trailer", short videos,
 *                                      embeddable only          (100 units each)
 *     -> YouTube videos.list           dimensions (maxHeight -> embedWidth/
 *                                      embedHeight: taller than wide = Short),
 *                                      status, duration, views   (1 unit each)
 *     -> rank                          official channel first, then the most
 *                                      trailer-like fan Short
 *     -> write `video.short`           back into the seed file
 *
 * "Official" means the uploader's channel name matches one of the film's TMDB
 * production companies (Warner Bros., Sony Pictures, Studio Ghibli…) or a
 * licensed distributor channel (Universal, Netflix, Prime Video, GKIDS…).
 * Only official uploads are taken by default — a fan recap or meme standing
 * in for a trailer is worse than the zoomed landscape clip the card falls
 * back to. Pass --allow-fan to accept fan uploads as a last resort. Studios
 * only post vertical trailers for recent releases, so most back-catalog
 * titles end up without one. Everything is validated the same way
 * curate.mjs validates the landscape clip (public, embeddable, not
 * age-restricted, not US-blocked), and the player falls back to the
 * landscape clip if a Short still fails to embed.
 *
 * We store YouTube *keys* only. Never download, rehost, clip or proxy a video
 * file — that is the legal decision the whole project rests on (AGENTS.md §3).
 *
 * Usage:
 *   node scripts/find-shorts.mjs lib/seed.json          # annotate in place
 *   node scripts/find-shorts.mjs data/seedMovies.ts     # annotate in place
 *   node scripts/find-shorts.mjs lib/seed.json --dry-run
 *   node scripts/find-shorts.mjs lib/seed.json --limit 5 --allow-fan
 *   node scripts/find-shorts.mjs lib/seed.json --refresh   # re-search titles
 *                                                          # that already have one
 *
 * Quota: one search per title (two if the first finds nothing vertical), so
 * ~100–200 of the 10,000 daily units per movie.
 *
 * Env (from .env, never committed):
 *   TMDB_READ_ACCESS_TOKEN  v4 bearer (preferred) / TMDB_API_KEY (v3)
 *   YOUTUBE_API_KEY         YouTube Data API v3 key
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMDB_BASE = 'https://api.themoviedb.org/3';
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

/** Shorts are ≤ 3 minutes; below ~5s it's a logo sting, not a clip. */
const MIN_SECONDS = 5;
const MAX_SECONDS = 180;

// ─────────────────────────────────────────────────────────────────────────────
// CLI / env
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { file: null, limit: Infinity, dryRun: false, officialOnly: true, refresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--allow-fan') args.officialOnly = false;
    else if (a === '--official-only') args.officialOnly = true; // the default; kept for clarity
    else if (a === '--refresh') args.refresh = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a.startsWith('--')) die(`Unknown flag ${a}`);
    else args.file = a;
  }
  if (!args.file) die('Usage: node scripts/find-shorts.mjs <lib/seed.json | data/seedMovies.ts> [--dry-run] [--limit N] [--allow-fan] [--refresh]');
  return args;
}

function die(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

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
 * YouTube rate-limits bursts with HTTP 429 (distinct from the daily quota,
 * which is a 403 quotaExceeded and is not retried). Back off generously:
 * 2s, 4s, 8s, 16s, 32s, 64s before giving up on a request.
 */
async function fetchJson(url, init = {}, { attempts = 7, label = 'request' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`${label}: HTTP ${res.status}`);
      }
      const body = await res.json();
      if (!res.ok) {
        const reason = body?.error?.message ?? body?.status_message ?? `HTTP ${res.status}`;
        throw Object.assign(new Error(`${label}: ${reason}`), { fatal: true });
      }
      return body;
    } catch (error) {
      if (error.fatal) throw error;
      lastError = error;
      if (attempt < attempts) await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}

function tmdbClient() {
  const bearer = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!bearer && !apiKey) {
    die('No TMDB credential. Add TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY to .env');
  }
  return async function tmdb(path, params = {}) {
    const url = new URL(TMDB_BASE + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const init = {};
    if (bearer) init.headers = { Authorization: `Bearer ${bearer}`, accept: 'application/json' };
    else url.searchParams.set('api_key', apiKey);
    return fetchJson(url, init, { label: `TMDB ${path}` });
  };
}

function youtubeClient() {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) die('YOUTUBE_API_KEY is missing from .env');
  return async function yt(path, params) {
    const url = new URL(YT_BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set('key', key);
    return fetchJson(url, {}, { label: `YouTube ${path}` });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed files: JSON (lib/seed.json) or the hand-written TS (data/seedMovies.ts)
// ─────────────────────────────────────────────────────────────────────────────

function loadSeed(file) {
  const path = resolve(ROOT, file);
  const text = readFileSync(path, 'utf8');
  if (file.endsWith('.json')) {
    return { path, kind: 'json', text, movies: JSON.parse(text) };
  }
  // data/seedMovies.ts keeps each movie's video on one line:
  //   video: { key: 'YoHD9XEInc0', start: 5, end: 25, source: 'trailer' },
  const movies = [];
  for (const block of text.split(/\n  \{\n/).slice(1)) {
    const id = Number(block.match(/^\s*id: (\d+)/m)?.[1]);
    const title = block.match(/title: '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\'/g, "'");
    const year = Number(block.match(/year: (\d+)/)?.[1]);
    const key = block.match(/video: \{ key: '([^']+)'/)?.[1];
    const short = block.match(/short: \{ key: '([^']+)'/)?.[1];
    if (id && title) movies.push({ id, title, year, video: key ? { key, short: short ? { key: short } : undefined } : null });
  }
  return { path, kind: 'ts', text, movies };
}

function shortLiteral(short) {
  return `short: { key: '${short.key}', official: ${short.official}, seconds: ${short.seconds} }`;
}

function writeSeed(seed, results) {
  if (seed.kind === 'json') {
    for (const movie of seed.movies) {
      const found = results.get(movie.id);
      if (found && movie.video) movie.video.short = found;
    }
    writeFileSync(seed.path, JSON.stringify(seed.movies, null, 2) + '\n', 'utf8');
    return;
  }
  let text = seed.text;
  for (const movie of seed.movies) {
    const found = results.get(movie.id);
    if (!found || !movie.video) continue;
    const line = new RegExp(`(video: \\{ key: '${movie.video.key}'[^\\n]*?)(?:, short: \\{[^}]*\\})? \\},`);
    if (!line.test(text)) die(`Could not find the video line for "${movie.title}" in ${seed.path}`);
    text = text.replace(line, `$1, ${shortLiteral(found)} },`);
  }
  writeFileSync(seed.path, text, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching and ranking
// ─────────────────────────────────────────────────────────────────────────────

const normalize = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'into', 'at', 'for', 'part']);
const COMPANY_NOISE = new Set([
  'pictures', 'picture', 'entertainment', 'films', 'film', 'studios', 'studio', 'inc', 'llc',
  'ltd', 'co', 'company', 'productions', 'production', 'the', 'and', 'group', 'media',
  'international', 'distribution', 'home', 'video', 'animation', 'corporation', 'plc',
]);

function titleTokens(title) {
  return normalize(title).split(' ').filter((t) => t && !STOPWORDS.has(t));
}

/** Enough of the film's title must appear in the video title (not "Mickey 17" on Warner's channel). */
function titleMatches(movieTitle, videoTitle) {
  const want = titleTokens(movieTitle);
  if (want.length === 0) return true;
  const have = ` ${normalize(videoTitle)} `;
  const hits = want.filter((t) => have.includes(` ${t} `)).length;
  return hits / want.length >= 0.7;
}

/**
 * A title match alone is not enough for one-word titles ("Parasite" also
 * names a House M.D. episode). Require a second signal somewhere in the
 * title + description: the year, the director's or a lead actor's surname,
 * or the video calling itself a trailer/teaser.
 */
function relatedToFilm(movie, people, v) {
  const text = ` ${normalize(`${v.title} ${v.description}`)} `;
  if (text.includes(` ${movie.year} `)) return true;
  if (/\b(trailer|teaser)\b/i.test(v.title)) return true;
  return people.some((name) => {
    const surname = normalize(name).split(' ').pop();
    return surname && surname.length >= 4 && text.includes(` ${surname} `);
  });
}

/** Licensed trailer/streaming channels count as official even though they aren't a production company. */
const DISTRIBUTOR_CHANNELS = [
  'prime video', 'netflix', 'hbo', 'max', 'paramount', 'peacock', 'hulu', 'disney', 'apple tv',
  'rotten tomatoes', 'movieclips', 'fandango', 'imdb', 'crunchyroll', 'gkids', 'a24', 'neon',
];

/** Channel name carries a distinctive token of one of the film's production companies, or is a known distributor. */
function isOfficialChannel(channelTitle, companies) {
  const channel = ` ${normalize(channelTitle)} `;
  if (DISTRIBUTOR_CHANNELS.some((d) => channel.includes(` ${d} `))) return true;
  return companies.some((company) => {
    const tokens = normalize(company).split(' ').filter((t) => t.length >= 4 && !COMPANY_NOISE.has(t));
    return tokens.length > 0 && channel.includes(` ${tokens[0]} `);
  });
}

const GOOD_WORDS = /\b(trailer|teaser|clip|scene|official)\b/i;
const BAD_WORDS =
  /\b(recap|explained|explain|theory|theories|ending|reaction|review|ranking|ranked|facts?|breakdown|edit|edits|analysis|hidden|secret|did you know|tiktok|meme|piano|guitar|cover|song|music|soundtrack|ost|theme|remix|tutorial|lego|minecraft|roblox|fortnite|game|gameplay|cosplay|drawing|parody|animation meme)\b/i;

/** Hard rejects: not footage of the film at all, whatever the score says. */
const NOT_FOOTAGE = /\b(piano|guitar|cover|tutorial|lego|minecraft|roblox|fortnite|gameplay|cosplay|drawing|parody)\b/i;

function scoreCandidate(v, official) {
  let score = official ? 100 : 0;
  if (GOOD_WORDS.test(v.title)) score += 6;
  if (BAD_WORDS.test(v.title)) score -= 6;
  if (v.seconds >= 12 && v.seconds <= 75) score += 3;
  if (v.seconds > 120) score -= 3;
  score += Math.log10((v.views ?? 0) + 1);
  return score;
}

function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => (x === undefined ? 0 : Number(x)));
  return d * 86400 + h * 3600 + min * 60 + s;
}

/** Same gate as curate.mjs: null if safe to embed, else a human-readable reason. */
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

// ─────────────────────────────────────────────────────────────────────────────
// YouTube
// ─────────────────────────────────────────────────────────────────────────────

/** videos.list with maxHeight makes YouTube report the embed's true dimensions. */
async function describeVideos(yt, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    if (batch.length === 0) continue;
    const { items = [] } = await yt('/videos', {
      part: 'snippet,player,contentDetails,status,statistics',
      id: batch.join(','),
      maxHeight: 720,
      maxResults: 50,
    });
    for (const item of items) {
      out.push({
        key: item.id,
        title: item.snippet?.title ?? '',
        description: item.snippet?.description ?? '',
        channel: item.snippet?.channelTitle ?? '',
        width: Number(item.player?.embedWidth),
        height: Number(item.player?.embedHeight),
        seconds: parseDuration(item.contentDetails?.duration),
        views: Number(item.statistics?.viewCount ?? 0),
        problem: videoProblem(item),
      });
    }
  }
  return out;
}

async function searchShort(yt, query) {
  const { items = [] } = await yt('/search', {
    part: 'snippet',
    q: query,
    type: 'video',
    videoDuration: 'short',
    videoEmbeddable: 'true',
    safeSearch: 'moderate',
    maxResults: 25,
  });
  return items.map((i) => i.id?.videoId).filter(Boolean);
}

async function findShort(yt, movie, companies, people, { officialOnly }) {
  const queries = [`${movie.title} ${movie.year} trailer`, `${movie.title} #shorts`];
  const seen = new Set();
  let best = null;
  const rejected = [];

  for (const query of queries) {
    const ids = (await searchShort(yt, query)).filter((id) => !seen.has(id));
    ids.forEach((id) => seen.add(id));
    const described = await describeVideos(yt, ids);

    for (const v of described) {
      const why =
        v.problem ??
        (!(v.height > v.width) ? 'landscape' : null) ??
        (v.seconds !== null && (v.seconds < MIN_SECONDS || v.seconds > MAX_SECONDS) ? `${v.seconds}s` : null) ??
        (!titleMatches(movie.title, v.title) ? 'title mismatch' : null) ??
        (NOT_FOOTAGE.test(v.title) ? 'not film footage' : null) ??
        (!relatedToFilm(movie, people, v) ? 'no year/cast/trailer signal' : null);
      if (why) {
        rejected.push(`${v.key} (${why})`);
        continue;
      }
      const official = isOfficialChannel(v.channel, companies);
      if (officialOnly && !official) continue;
      const score = scoreCandidate(v, official);
      if (!best || score > best.score) best = { ...v, official, score };
    }
    // An official hit is as good as it gets; otherwise try the second query too.
    if (best?.official) break;
  }
  return { best, rejected };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();
  const tmdb = tmdbClient();
  const yt = youtubeClient();
  const seed = loadSeed(args.file);

  const todo = seed.movies
    .filter((m) => m.video?.key)
    .filter((m) => args.refresh || !m.video.short)
    .slice(0, args.limit);
  console.log(`\n${seed.movies.length} movies in ${args.file}; searching ${todo.length}${args.dryRun ? ' (dry run)' : ''}\n`);

  const results = new Map();
  let official = 0;
  let fan = 0;
  for (const movie of todo) {
    const label = `${movie.title} (${movie.year})`;
    try {
      const detail = await tmdb(`/movie/${movie.id}`, { append_to_response: 'credits' });
      const companies = (detail.production_companies ?? []).map((c) => c.name);
      const people = [
        ...(detail.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name),
        ...(detail.credits?.cast ?? []).slice(0, 3).map((c) => c.name),
      ];
      const { best, rejected } = await findShort(yt, movie, companies, people, args);
      if (!best) {
        console.log(`  – ${label}: no vertical video found (${rejected.length} rejected)`);
        continue;
      }
      results.set(movie.id, { key: best.key, official: best.official, seconds: best.seconds ?? 0 });
      if (best.official) official += 1;
      else fan += 1;
      console.log(
        `  ${best.official ? '★' : '·'} ${label}: ${best.key} ${best.width}x${best.height} ${best.seconds}s ` +
          `[${best.channel}] "${best.title}"${best.official ? '' : ' (fan)'}`
      );
    } catch (error) {
      console.log(`  ✗ ${label}: ${error.message}`);
      // The daily quota is gone: nothing else will succeed today. Keep what we have.
      if (/quotaExceeded|quota/i.test(error.message)) {
        console.log('\n  YouTube daily quota exhausted — re-run tomorrow; titles already annotated are skipped.');
        break;
      }
    }
    // Pace the titles so a burst of searches doesn't trip the per-minute limit.
    await sleep(1500);
  }

  console.log(`\n${results.size} found: ${official} official, ${fan} fan; ${todo.length - results.size} without.`);
  if (args.dryRun) {
    console.log('Dry run — nothing written.\n');
    return;
  }
  writeSeed(seed, results);
  console.log(`Wrote ${args.file}\n`);
}

main().catch((error) => die(error.stack ?? String(error)));
