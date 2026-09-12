import { algorithmicWinner, createGroupCompromise, COMPROMISE_SCHEMA } from '../src/lib/gemini';
import type { Member, Movie } from '../src/types';

const movies: Movie[] = [
  { id: 1, title: 'Action Comedy', year: 2020, genreIds: [28, 35], genreNames: ['Action', 'Comedy'],
    keywords: ['heist'], poster: '', providers: ['Netflix'], video: null },
  { id: 2, title: 'Quiet Drama', year: 2021, genreIds: [18], genreNames: ['Drama'],
    keywords: [], poster: '', providers: [], video: null },
  { id: 3, title: 'Vetoed Horror', year: 2022, genreIds: [27], genreNames: ['Horror'],
    keywords: [], poster: '', providers: ['Max'], video: null },
];
const members: Member[] = [
  { uid: 'a', name: 'Alex', likes: [1], dislikes: [3] },
  { uid: 'b', name: 'Sam', likes: [2], dislikes: [] },
];
const valid = { pick: movies[0].title, tmdb_id: 1,
  why: 'Sam, trade quiet drama for Alex’s action; the comedy gives you a lighter evening together. Watch on Netflix.',
  runner_up: movies[1].title };
const json = (value: unknown) => JSON.stringify(value);

describe('group compromise', () => {
  it('uses the specified pitch schema', () => {
    expect(COMPROMISE_SCHEMA.required).toEqual(['pick', 'why']);
    expect(Object.keys(COMPROMISE_SCHEMA.properties)).toEqual(['pick', 'tmdb_id', 'why', 'runner_up']);
  });

  it('returns a validated pick and sends actual titles, names, and candidates', async () => {
    const generate = jest.fn(async () => json(valid));
    expect(await createGroupCompromise({ generate })(members, movies)).toEqual(valid);
    const prompt = generate.mock.calls[0] as unknown as [string];
    expect(prompt[0]).toContain('Alex');
    expect(prompt[0]).toContain('Quiet Drama');
    expect(prompt[0]).toContain('name who compromises');
    const data = JSON.parse(prompt[0].split('\n').at(-1)!);
    expect(data.candidates.map((movie: { tmdb_id: number }) => movie.tmdb_id)).toEqual([1, 2]);
    expect(data.members[0].disliked).toEqual([{ tmdb_id: 3, title: 'Vetoed Horror' }]);
    expect(prompt[0]).not.toContain('"uid"');
  });

  it.each([
    ['unknown ID', { ...valid, tmdb_id: 999 }],
    ['missing ID', { pick: valid.pick, why: valid.why }],
    ['mismatched title', { ...valid, pick: 'Invented title' }],
    ['vetoed movie', { pick: 'Vetoed Horror', tmdb_id: 3, why: 'Watch on Max.' }],
    ['empty why', { ...valid, why: '' }],
    ['overlong why', { ...valid, why: 'x'.repeat(321) + ' Watch on Netflix.' }],
    ['invented provider', { ...valid, why: 'A compromise for Alex and Sam. Watch on Disney+.' }],
  ])('rejects %s without a connected algorithmic winner', async (_label, value) => {
    expect(await createGroupCompromise({ generate: async () => json(value) })(members, movies)).toBeNull();
  });

  it('rejects malformed JSON and API failures without leaking errors', async () => {
    expect(await createGroupCompromise({ generate: async () => 'not JSON' })(members, movies)).toBeNull();
    expect(await createGroupCompromise({ generate: async () => { throw new Error('secret diagnostic'); } })(members, movies)).toBeNull();
  });

  it('explains only the injected algorithmic winner after a hallucinated ID', async () => {
    const generate = jest.fn<Promise<string>, [string]>()
      .mockResolvedValueOnce(json({ ...valid, tmdb_id: 999 }))
      .mockResolvedValueOnce(json(valid));
    const fallback = jest.fn(() => movies[0]);
    expect(await createGroupCompromise({ generate, fallback })(members, movies)).toEqual(valid);
    expect(fallback).toHaveBeenCalledWith(members, movies);
    expect(generate.mock.calls[1][0]).toContain('Explain ONLY the fixed algorithmic winner');
  });

  it('rejects a different film on the explanation retry', async () => {
    const generate = jest.fn<Promise<string>, [string]>()
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce(json({ pick: movies[1].title, tmdb_id: 2, why: 'Check local streaming availability.' }));
    expect(await createGroupCompromise({ generate, fallback: () => movies[0] })(members, movies)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('never retries a vetoed algorithmic winner', async () => {
    const generate = jest.fn(async () => '{}');
    expect(await createGroupCompromise({ generate, fallback: () => movies[2] })(members, movies)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('drops an unvalidated runner-up', async () => {
    const result = await createGroupCompromise({ generate: async () => json({ ...valid, runner_up: 'Invented' }) })(members, movies);
    expect(result).toEqual({ pick: valid.pick, tmdb_id: 1, why: valid.why });
  });

  it('avoids API calls for empty groups, empty catalogs, or all-vetoed catalogs', async () => {
    const generate = jest.fn(async () => json(valid));
    const service = createGroupCompromise({ generate });
    expect(await service([], movies)).toBeNull();
    expect(await service(members, [])).toBeNull();
    expect(await service(members, [movies[2]])).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('coalesces requests, caches only validated results, and isolates changed tastes', async () => {
    const generate = jest.fn(async () => json(valid));
    const service = createGroupCompromise({ generate });
    const [first, second] = await Promise.all([service(members, movies), service(members, movies)]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(first).not.toBe(second);
    first!.why = 'modified';
    expect((await service(members, movies))?.why).toBe(valid.why);
    await service([{ ...members[0], likes: [2] }, members[1]], movies);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('retries later after a failure rather than caching null', async () => {
    const generate = jest.fn<Promise<string>, [string]>().mockResolvedValueOnce('{}').mockResolvedValueOnce(json(valid));
    const service = createGroupCompromise({ generate });
    expect(await service(members, movies)).toBeNull();
    expect(await service(members, movies)).toEqual(valid);
  });

  it('caps the watch line so a many-provider film still has room to explain', async () => {
    const crowd: Movie = { id: 4, title: 'Crowd Pleaser', year: 2019, genreIds: [35], genreNames: ['Comedy'],
      keywords: [], poster: '', providers: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], video: null };
    const why = 'Alex trades horror for comedy; Sam gets the lighter night out. Watch on A or B or C or D.';
    const generate = jest.fn(async () => json({ pick: 'Crowd Pleaser', tmdb_id: 4, why }));
    expect(await createGroupCompromise({ generate })(members, [...movies, crowd]))
      .toEqual({ pick: 'Crowd Pleaser', tmdb_id: 4, why });
    const prompt = generate.mock.calls[0] as unknown as [string];
    expect(prompt[0]).toContain('Watch on A or B or C or D.');
  });

  it('still budgets the explanation itself, excluding the watch line', async () => {
    const crowd: Movie = { id: 4, title: 'Crowd Pleaser', year: 2019, genreIds: [35], genreNames: ['Comedy'],
      keywords: [], poster: '', providers: ['A', 'B', 'C', 'D'], video: null };
    const why = `${'x'.repeat(321)} Watch on A or B or C or D.`;
    expect(await createGroupCompromise({ generate: async () => json({ pick: 'Crowd Pleaser', tmdb_id: 4, why }) })(
      members, [...movies, crowd])).toBeNull();
  });

  it('resolves instead of rejecting when a catalog entry has no providers', async () => {
    const sparse = { ...movies[1], providers: undefined } as unknown as Movie;
    await expect(createGroupCompromise({ generate: async () => '{}' })(members, [sparse])).resolves.toBeNull();
  });

  it('resolves null when the injected algorithmic selector throws', async () => {
    const fallback = () => { throw new Error('selector boom'); };
    await expect(createGroupCompromise({ generate: async () => '{}', fallback })(members, movies)).resolves.toBeNull();
  });

  it('picks the most-liked un-vetoed candidate as the algorithmic winner', () => {
    const fans: Member[] = [{ uid: 'a', name: 'Alex', likes: [2], dislikes: [3] },
      { uid: 'b', name: 'Sam', likes: [2], dislikes: [] }];
    expect(algorithmicWinner(fans, movies)).toEqual(movies[1]);
    expect(algorithmicWinner(members, [movies[2]])).toBeNull();
  });
});
