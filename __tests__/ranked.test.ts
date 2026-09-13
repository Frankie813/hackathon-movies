// Issue #23: Gemini's ranked fallback. Gemini and TMDB are injected, so no
// network is used — the AC is that every title that comes back resolved to a
// real TMDB id, and invented ones never do.

import {
  buildRankedPrompt,
  createRankedCandidates,
  MAX_SUGGESTIONS,
  parseSuggestions,
  RANKED_SCHEMA,
} from '../src/lib/ranked';
import type { Movie } from '../src/types';

function movie(id: number, title: string, year = 2010, extra: Partial<Movie> = {}): Movie {
  return {
    id, title, year, genreIds: [878], genreNames: ['Sci-Fi'], keywords: [], poster: 'https://x/p.jpg',
    providers: [], video: { key: `k${id}`, start: 0, end: 18, source: 'trailer' }, ...extra,
  };
}

/** A tiny stand-in for TMDB: only these films exist. */
const CATALOG: Record<string, Movie> = {
  arrival: movie(329865, 'Arrival', 2016),
  'ex machina': movie(264660, 'Ex Machina', 2014),
  'edge of tomorrow': movie(137113, 'Edge of Tomorrow', 2014),
  'no trailer': movie(1, 'No Trailer', 2014, { video: null }),
};
const resolve = jest.fn(async (title: string) => CATALOG[title.toLowerCase()] ?? null);
const json = (value: unknown) => JSON.stringify(value);
const liked = [movie(27205, 'Inception'), movie(157336, 'Interstellar', 2014)];
const taste = { 'genre:878': 3, 'keyword:time travel': 2, 'genre:27': -2, 'cast:6193': 4 };

beforeEach(() => resolve.mockClear());

describe('rankedCandidates (#23)', () => {
  it('returns only titles that resolved to a real TMDB id, in Gemini\'s order', async () => {
    const generate = jest.fn(async () => json({
      candidates: [
        { title: 'Ex Machina', year: 2014 },
        { title: 'The Quantum Heist of Neptune', year: 2019 }, // invented
        { title: 'Arrival', year: 2016 },
        { title: 'No Trailer', year: 2014 }, // real but unplayable
      ],
    }));
    const result = await createRankedCandidates({ generate, resolve })(taste, liked);

    expect(result.map((m) => m.id)).toEqual([264660, 329865]);
    expect(result.every((m) => Number.isInteger(m.id) && Object.values(CATALOG).includes(m))).toBe(true);
    expect(resolve).toHaveBeenCalledWith('The Quantum Heist of Neptune', 2019);
  });

  it('shows TMDB\'s movie, never Gemini\'s text for it', async () => {
    const generate = jest.fn(async () => json({ candidates: [{ title: 'ARRIVAL', year: 2016 }] }));
    const [first] = await createRankedCandidates({ generate, resolve })(taste, liked);
    expect(first).toBe(CATALOG.arrival);
  });

  it('drops liked, excluded and duplicate ids', async () => {
    const generate = jest.fn(async () => json({
      candidates: [{ title: 'Arrival' }, { title: 'arrival' }, { title: 'Ex Machina' }, { title: 'Edge of Tomorrow' }],
    }));
    const rankedCandidates = createRankedCandidates({ generate, resolve });
    const withLike = [...liked, CATALOG['edge of tomorrow']];
    const result = await rankedCandidates(taste, withLike, { exclude: [264660] });
    expect(result.map((m) => m.id)).toEqual([329865]);
  });

  it('resolves [] rather than rejecting when Gemini fails, returns junk, or nothing is liked', async () => {
    const failing = createRankedCandidates({ generate: async () => { throw new Error('offline'); }, resolve });
    const junk = createRankedCandidates({ generate: async () => 'not json', resolve });
    const generate = jest.fn(async () => json({ candidates: [{ title: 'Arrival' }] }));

    await expect(failing(taste, liked)).resolves.toEqual([]);
    await expect(junk(taste, liked)).resolves.toEqual([]);
    await expect(createRankedCandidates({ generate, resolve })(taste, [])).resolves.toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('treats a resolver that throws as an unresolved title', async () => {
    const generate = async () => json({ candidates: [{ title: 'Arrival' }, { title: 'Ex Machina' }] });
    const flaky = jest.fn(async (title: string) => {
      if (title === 'Arrival') throw new Error('timeout');
      return CATALOG[title.toLowerCase()] ?? null;
    });
    const result = await createRankedCandidates({ generate, resolve: flaky })(taste, liked);
    expect(result.map((m) => m.id)).toEqual([264660]);
  });

  it('caches a resolved list per prompt, but still applies a fresh exclude', async () => {
    const generate = jest.fn(async () => json({ candidates: [{ title: 'Arrival' }, { title: 'Ex Machina' }] }));
    const rankedCandidates = createRankedCandidates({ generate, resolve });
    await rankedCandidates(taste, liked);
    const second = await rankedCandidates(taste, liked, { exclude: [329865] });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(second.map((m) => m.id)).toEqual([264660]);
  });
});

describe('parsing and prompt', () => {
  it('caps, dedupes and sanitises suggestions', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `Film ${i}`, year: 2000 + i }));
    expect(parseSuggestions(json({ candidates: many }))).toHaveLength(MAX_SUGGESTIONS);
    expect(parseSuggestions(json({
      candidates: [{ title: ' Arrival ', year: 2016 }, { title: 'arrival', year: 2016 }, { title: '' }, { year: 1999 },
        { title: 'Old', year: 12 }],
    }))).toEqual([{ title: 'Arrival', year: 2016 }, { title: 'Old', year: undefined }]);
    expect(parseSuggestions(json({ nope: [] }))).toEqual([]);
  });

  it('sends likes and named tastes, but no cast ids', () => {
    const prompt = buildRankedPrompt(taste, liked);
    expect(prompt).toContain('Inception');
    expect(prompt).toContain('Science Fiction');
    expect(prompt).toContain('time travel');
    expect(prompt).toContain('"avoids":["Horror"]');
    expect(prompt).not.toContain('6193');
  });

  it('schema requires a candidates array of titles', () => {
    expect(RANKED_SCHEMA.required).toEqual(['candidates']);
    expect(RANKED_SCHEMA.properties.candidates.items.required).toEqual(['title']);
  });
});
