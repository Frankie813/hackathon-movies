// Issue #22 — natural-language mood → TMDB /discover filters.
//
// Gemini turns "funny but not dumb" into genre NAMES, keyword words and a
// rating floor; this module maps those onto the TMDB ids that lib/tmdb.ts's
// getDeck(filters) needs. Nothing Gemini returns is trusted as an id: genres go
// through a fixed name table, keywords through TMDB /search/keyword.

import type { DiscoverFilters } from '../types';

/** A getDeck() filter plus the mood's tone, for UI copy (#11). */
export interface MoodFilters extends DiscoverFilters {
  tone?: string;
}

/**
 * TMDB's movie genre list (/genre/movie/list). The ids have been stable for
 * years, and a fixed table works offline and costs no request per mood.
 */
export const TMDB_GENRES: Readonly<Record<string, number>> = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  'Science Fiction': 878,
  'TV Movie': 10770,
  Thriller: 53,
  War: 10752,
  Western: 37,
};

const GENRE_ALIASES: Record<string, string> = {
  'sci-fi': 'Science Fiction',
  scifi: 'Science Fiction',
  'sci fi': 'Science Fiction',
  romcom: 'Romance',
  animated: 'Animation',
  musical: 'Music',
  documentaries: 'Documentary',
};

/** PLAN.md §F #2's schema, plus exclude_keywords for "not X" moods. */
export const MOOD_SCHEMA = {
  type: 'object',
  properties: {
    genres: { type: 'array', items: { type: 'string', enum: Object.keys(TMDB_GENRES) } },
    exclude_genres: { type: 'array', items: { type: 'string', enum: Object.keys(TMDB_GENRES) } },
    keywords: { type: 'array', items: { type: 'string' } },
    exclude_keywords: { type: 'array', items: { type: 'string' } },
    min_rating: { type: 'number' },
    tone: { type: 'string' },
  },
  // Gemini skipped these when optional; empty / 0 means unused.
  required: ['genres', 'exclude_keywords', 'min_rating'],
} as const;

export const MOOD_SYSTEM_PROMPT = [
  'You turn a moviegoer\'s mood into TMDB /discover filters. Return only the JSON object.',
  'genres: the TMDB genres the mood asks for (usually 1-2). exclude_genres: genres the mood rules out.',
  'keywords: up to 3 short lowercase TMDB-style keyword tags the films should carry (e.g. "satire", "heist").',
  'exclude_keywords: up to 4 lowercase keyword tags the mood rules out ([] if none). For "not dumb", "smart" or "clever", always exclude "slapstick", "spoof", "parody", "gross-out".',
  'min_rating: a TMDB vote average floor from 0 to 10. Use 7 when the mood asks for quality ("good", "smart", "clever", "not dumb"); use 0 when it does not.',
  'tone: 2-4 words describing the vibe.',
  'Never return a keyword in both keywords and exclude_keywords.',
  'Example. Mood: "funny but not dumb" -> {"genres":["Comedy"],"exclude_genres":[],"keywords":["satire","dark comedy"],"exclude_keywords":["slapstick","spoof","parody","gross-out"],"min_rating":7,"tone":"clever and funny"}',
].join('\n');

const MAX_KEYWORDS = 3;
const MAX_EXCLUDED_KEYWORDS = 4;
const MAX_TONE_LENGTH = 40;
const MAX_CACHE_ENTRIES = 30;

interface MoodResponse {
  genres?: unknown;
  exclude_genres?: unknown;
  keywords?: unknown;
  exclude_keywords?: unknown;
  min_rating?: unknown;
  tone?: unknown;
}

export interface MoodDependencies {
  /** Sends the mood text to Gemini and returns the raw JSON text. */
  generate: (text: string) => Promise<string>;
  /** TMDB /search/keyword: keyword name → id, or null when TMDB has no match. */
  resolveKeyword: (name: string) => Promise<number | null>;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim()).filter(Boolean);
}

export function genreId(name: string): number | null {
  const direct = TMDB_GENRES[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  const canonical = GENRE_ALIASES[lower]
    ?? Object.keys(TMDB_GENRES).find((genre) => genre.toLowerCase() === lower);
  return canonical ? TMDB_GENRES[canonical] : null;
}

function genreIds(names: string[]): number[] {
  return [...new Set(names.map(genreId).filter((id): id is number => id !== null))];
}

function keywordNames(value: unknown, limit: number): string[] {
  return [...new Set(strings(value).map((word) => word.toLowerCase()))].slice(0, limit);
}

async function keywordIds(names: string[], resolve: MoodDependencies['resolveKeyword']): Promise<number[]> {
  const ids = await Promise.all(names.map((name) => resolve(name).catch(() => null)));
  return [...new Set(ids.filter((id): id is number => Number.isInteger(id)))];
}

/** Gemini JSON → filters. Returns null when nothing in it can narrow a deck. */
export async function parseMood(raw: string, resolve: MoodDependencies['resolveKeyword']): Promise<MoodFilters | null> {
  let body: MoodResponse;
  try {
    body = JSON.parse(raw) as MoodResponse;
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;

  const withoutGenres = genreIds(strings(body.exclude_genres));
  // A genre in both lists is contradictory; exclusion is the safer reading.
  const withGenres = genreIds(strings(body.genres)).filter((id) => !withoutGenres.includes(id));

  const excludedNames = keywordNames(body.exclude_keywords, MAX_EXCLUDED_KEYWORDS);
  const wantedNames = keywordNames(body.keywords, MAX_KEYWORDS)
    .filter((name) => !excludedNames.includes(name));
  const [withKeywords, withoutKeywords] = await Promise.all([
    keywordIds(wantedNames, resolve),
    keywordIds(excludedNames, resolve),
  ]);

  const rating = typeof body.min_rating === 'number' && Number.isFinite(body.min_rating)
    ? Math.min(10, Math.max(0, body.min_rating))
    : undefined;
  const tone = typeof body.tone === 'string' && body.tone.trim()
    ? body.tone.trim().slice(0, MAX_TONE_LENGTH)
    : undefined;

  const filters: MoodFilters = {};
  if (withGenres.length) filters.withGenres = withGenres;
  if (withoutGenres.length) filters.withoutGenres = withoutGenres;
  const keywordsKept = withKeywords.filter((id) => !withoutKeywords.includes(id));
  if (keywordsKept.length) filters.withKeywords = keywordsKept;
  if (withoutKeywords.length) filters.withoutKeywords = withoutKeywords;
  if (rating !== undefined && rating > 0) filters.minRating = rating;

  // Tone alone can't narrow /discover: treat it as "nothing usable" so the
  // caller keeps the current deck instead of reloading an unfiltered one.
  if (Object.keys(filters).length === 0) return null;
  if (tone) filters.tone = tone;
  return filters;
}

function copy(filters: MoodFilters): MoodFilters {
  return Object.fromEntries(Object.entries(filters)
    .map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])) as MoodFilters;
}

/** Injectable boundary so tests run without Firebase or TMDB. */
export function createMoodToFilters({ generate, resolveKeyword }: MoodDependencies) {
  const cache = new Map<string, MoodFilters>();

  return async function moodToFilters(text: string): Promise<MoodFilters | null> {
    const mood = text.replace(/\s+/g, ' ').trim();
    if (!mood) return null;
    const key = mood.toLowerCase();
    const cached = cache.get(key);
    if (cached) return copy(cached);

    let filters: MoodFilters | null = null;
    try {
      filters = await parseMood(await generate(mood), resolveKeyword);
    } catch {
      // Offline, quota, or a malformed response: keep the current deck.
      return null;
    }
    if (filters) {
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(key, filters);
    }
    return filters ? copy(filters) : null;
  };
}
