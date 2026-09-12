import { seedCandidates } from '../src/lib/candidates';
import { applySwipe } from '../src/lib/taste';
import type { Movie, TasteVector } from '../src/types';

// The fetch layer is #15's contract, not this issue's — mocked so these tests
// assert candidate selection rather than TMDB's current recommendations.
jest.mock('../lib/tmdb', () => ({ similar: jest.fn() }));
const { similar } = jest.requireMock<{ similar: jest.Mock<Promise<Movie[]>, [number]> }>(
  '../lib/tmdb',
);

function movie(id: number, genreIds: number[] = [28], video = true): Movie {
  return {
    id,
    title: `Movie ${id}`,
    year: 2026,
    genreIds,
    genreNames: [],
    keywords: [],
    poster: '',
    providers: [],
    video: video ? { key: `yt${id}`, start: 5, end: 23, source: 'tmdb-clip' } : null,
  };
}

/** Five likes, the state the acceptance criterion is written against. */
function fiveLikes(): { vector: TasteVector; liked: Movie[] } {
  const liked = [movie(1), movie(2), movie(3), movie(4, [35]), movie(5, [18])];
  const vector = liked.reduce<TasteVector>((v, m) => applySwipe(v, m, 'right'), {});
  return { vector, liked };
}

beforeEach(() => similar.mockReset());

describe('seedCandidates', () => {
  it('grows the pool with related titles after five likes', async () => {
    const { vector, liked } = fiveLikes();
    similar.mockImplementation(async (id: number) => [movie(id * 100), movie(id * 100 + 1)]);

    const pool = await seedCandidates(vector, liked, { deck: liked.map((m) => m.id) });

    expect(pool.length).toBeGreaterThan(0);
    expect(pool.map((m) => m.id).sort((a, b) => a - b)).toEqual([100, 101, 200, 201, 300, 301]);
  });

  it('expands only the top three liked titles, chosen by the taste vector', async () => {
    // Two action likes and a comedy dislike make action the dominant feature,
    // so the action titles must be the ones expanded — not the first three.
    const liked = [movie(1, [35]), movie(2, [28]), movie(3, [28]), movie(4, [18])];
    let vector: TasteVector = {};
    for (const m of [liked[1], liked[2]]) vector = applySwipe(vector, m, 'right');
    vector = applySwipe(vector, movie(9, [35]), 'left');
    similar.mockResolvedValue([]);

    await seedCandidates(vector, liked);

    expect(similar).toHaveBeenCalledTimes(3);
    expect(similar.mock.calls.map(([id]) => id)).toEqual([2, 3, 4]);
  });

  it('returns no id twice and none the caller already has', async () => {
    const { vector, liked } = fiveLikes();
    // Overlapping lists, plus a title in the deck, one already swiped away, and
    // one of the likes itself — every duplicate source at once.
    similar.mockResolvedValue([
      movie(100),
      movie(100),
      movie(101),
      movie(700),
      movie(800),
      movie(3),
    ]);

    const pool = await seedCandidates(vector, liked, { deck: [700], swiped: [800] });

    const ids = pool.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(700);
    expect(ids).not.toContain(800);
    expect(ids).not.toContain(3);
    expect(ids.sort((a, b) => a - b)).toEqual([100, 101]);
  });

  it('caps deck plus new candidates at maxPool, keeping the most on-taste', async () => {
    const { vector, liked } = fiveLikes();
    // Off-taste comedies first, on-taste action last: a cap that ignored rank
    // would keep the comedies.
    similar.mockResolvedValue([movie(100, [35]), movie(101, [35]), movie(102, [28])]);

    const pool = await seedCandidates(vector, liked, { deck: [900, 901], maxPool: 3 });

    expect(pool.map((m) => m.id)).toEqual([102]);
  });

  it('adds nothing when the pool is already full', async () => {
    const { vector, liked } = fiveLikes();
    similar.mockResolvedValue([movie(100)]);

    expect(await seedCandidates(vector, liked, { deck: [1, 2, 3], maxPool: 3 })).toEqual([]);
    expect(similar).not.toHaveBeenCalled();
  });

  it('drops poster-only candidates so no card lands without a clip', async () => {
    const { vector, liked } = fiveLikes();
    similar.mockResolvedValue([movie(100, [28], false), movie(101)]);

    expect((await seedCandidates(vector, liked)).map((m) => m.id)).toEqual([101]);
  });

  it('no-ops offline, leaving the seed deck intact', async () => {
    const { vector, liked } = fiveLikes();
    // Offline #15 answers from the seed catalog, which offline IS the deck — so
    // every related title dedupes away and the deck is left untouched.
    const deck = [...liked.map((m) => m.id), 600, 601];
    similar.mockResolvedValue([movie(600), movie(601)]);

    await expect(seedCandidates(vector, liked, { deck })).resolves.toEqual([]);
  });

  it('makes no network call before the first like', async () => {
    expect(await seedCandidates({}, [])).toEqual([]);
    expect(similar).not.toHaveBeenCalled();
  });
});
