// Issue #22: "funny but not dumb" → comedy with a rating floor and no
// slapstick keywords. Gemini and TMDB are injected, so no network is used.

import { createMoodToFilters, genreId, MOOD_SCHEMA, parseMood, TMDB_GENRES } from '../src/lib/mood';

const KEYWORD_IDS: Record<string, number> = {
  slapstick: 9253, spoof: 10375, parody: 9716, 'gross-out': 1000, satire: 8201, witty: 2000,
};
const resolveKeyword = jest.fn(async (name: string) => KEYWORD_IDS[name] ?? null);
const json = (value: unknown) => JSON.stringify(value);

/** What Gemini is prompted to return for the AC's mood. */
const funnyNotDumb = {
  genres: ['Comedy'],
  exclude_genres: [],
  keywords: ['satire', 'witty'],
  exclude_keywords: ['slapstick', 'spoof', 'parody', 'gross-out'],
  min_rating: 7,
  tone: 'clever and funny',
};

beforeEach(() => resolveKeyword.mockClear());

describe('mood → TMDB filters', () => {
  it('keeps the PLAN.md §F schema, with genres required and constrained to TMDB names', () => {
    expect(MOOD_SCHEMA.required).toEqual(['genres']);
    expect(MOOD_SCHEMA.properties.genres.items.enum).toEqual(Object.keys(TMDB_GENRES));
    expect(Object.keys(MOOD_SCHEMA.properties)).toEqual(
      expect.arrayContaining(['genres', 'exclude_genres', 'keywords', 'min_rating', 'tone']));
  });

  it('"funny but not dumb" yields comedy with a rating floor and no slapstick keywords', async () => {
    const generate = jest.fn(async () => json(funnyNotDumb));
    const filters = await createMoodToFilters({ generate, resolveKeyword })('funny but not dumb');

    expect(generate).toHaveBeenCalledWith('funny but not dumb');
    expect(filters).toEqual({
      withGenres: [35],
      withKeywords: [8201, 2000],
      withoutKeywords: [9253, 10375, 9716, 1000],
      minRating: 7,
      tone: 'clever and funny',
    });
    expect(filters!.withKeywords).not.toContain(KEYWORD_IDS.slapstick);
  });

  it('maps genre names and aliases to TMDB ids and drops unknown ones', () => {
    expect(genreId('Science Fiction')).toBe(878);
    expect(genreId('sci-fi')).toBe(878);
    expect(genreId('comedy')).toBe(35);
    expect(genreId('Mumblecore')).toBeNull();
  });

  it('never keeps a keyword or genre it was also told to exclude', async () => {
    const filters = await parseMood(json({
      genres: ['Comedy', 'Horror'], exclude_genres: ['Horror'],
      keywords: ['slapstick', 'satire'], exclude_keywords: ['Slapstick'],
    }), resolveKeyword);
    expect(filters).toEqual({ withGenres: [35], withoutGenres: [27], withKeywords: [8201], withoutKeywords: [9253] });
  });

  it('drops keywords TMDB cannot resolve and clamps the rating to 0–10', async () => {
    const failing = jest.fn(async (name: string) => {
      if (name === 'boom') throw new Error('offline');
      return KEYWORD_IDS[name] ?? null;
    });
    expect(await parseMood(json({ genres: ['Comedy'], keywords: ['madeupword', 'boom'], min_rating: 42 }), failing))
      .toEqual({ withGenres: [35], minRating: 10 });
  });

  it('returns null — keep the current deck — when nothing usable comes back', async () => {
    const run = (response: string) => createMoodToFilters({ generate: async () => response, resolveKeyword })('x');
    expect(await run(json({ genres: [], tone: 'vibes' }))).toBeNull();
    expect(await run(json({ genres: ['Mumblecore'], min_rating: 0 }))).toBeNull();
    expect(await run('not json')).toBeNull();
    expect(await createMoodToFilters({ generate: async () => { throw new Error('429'); }, resolveKeyword })('x'))
      .toBeNull();
    expect(await createMoodToFilters({ generate: jest.fn(), resolveKeyword })('   ')).toBeNull();
  });

  it('caches by normalized mood text and hands out copies', async () => {
    const generate = jest.fn(async () => json(funnyNotDumb));
    const moodToFilters = createMoodToFilters({ generate, resolveKeyword });
    const first = await moodToFilters('Funny but not dumb');
    first!.withGenres!.length = 0;
    first!.minRating = 1;
    const second = await moodToFilters('  funny   BUT not dumb ');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(second!.minRating).toBe(7);
    expect(second!.withGenres).toEqual([35]);
  });
});
