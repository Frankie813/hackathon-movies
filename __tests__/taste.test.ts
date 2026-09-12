import { applySwipe, features, rank, score } from '../src/lib/taste';
import type { Movie } from '../src/types';
import rawSeed from '../lib/seed.json';
const { performance } = jest.requireActual<{ performance: { now(): number } }>('node:perf_hooks');

function movie(id: number, genreIds: number[], keywords: string[] = []): Movie {
  return { id, title: `Movie ${id}`, year: 2026, genreIds, genreNames: [],
    keywords, poster: '', providers: [], video: null };
}

describe('taste scoring', () => {
  const action = movie(1, [28]);
  const secondAction = movie(2, [28]);
  const comedy = movie(3, [35]);

  it('moves action titles above unrelated movies after two action likes', () => {
    const vector = applySwipe(applySwipe({}, action, 'right'), secondAction, 'right');
    expect(rank(vector, [comedy, movie(4, [28])]).map((m) => m.id)).toEqual([4, 3]);
    expect(vector['genre:28']).toBe(2);
  });

  it('demotes disliked features and reverses a like with a dislike', () => {
    expect(rank(applySwipe({}, action, 'left'), [action, comedy])).toEqual([comedy, action]);
    expect(score(applySwipe(applySwipe({}, action, 'right'), action, 'left'), action)).toBe(0);
  });

  it('uses unique normalized keywords and only the top three cast IDs', () => {
    expect(features({ ...movie(1, [28, 28], [' Heist ', 'heist', '']),
      castIds: [3223, 28, 9, 10] })).toEqual([
      'genre:28', 'keyword:heist', 'cast:3223', 'cast:28', 'cast:9',
    ]);
    expect(score({ 'cast:3223': 3 }, { ...movie(1, []), castIds: [3223] })).toBe(3);
  });

  it('normalizes by feature count instead of favoring long keyword lists', () => {
    expect(score({ 'genre:28': 2, 'keyword:heist': 1 }, movie(1, [28], ['heist']))).toBe(1.5);
    expect(score({ 'genre:28': 2 }, movie(1, [28], ['heist', 'spy', 'chase']))).toBe(0.5);
  });

  it('handles empty features, empty decks, and unseen features', () => {
    expect(score({}, movie(1, []))).toBe(0);
    expect(score({}, action)).toBe(0);
    expect(rank({}, [])).toEqual([]);
  });

  it('preserves input state and keeps ties in their original order', () => {
    const vector = Object.freeze({ 'genre:28': 2 });
    const deck = [action, secondAction, comedy];
    Object.freeze(deck);
    expect(applySwipe(vector, action, 'right')).toEqual({ 'genre:28': 3 });
    expect(vector).toEqual({ 'genre:28': 2 });
    const ranked = rank({}, deck);
    expect(ranked).toEqual(deck);
    expect(ranked).not.toBe(deck);
    expect(rank(vector, deck)[0]).toBe(action);
  });

  it('updates and ranks 60 catalog movies in under 5ms (median desktop sample)', () => {
    // Video is irrelevant to scoring; retain every real catalog feature.
    const catalog: Movie[] = rawSeed.slice(0, 60).map((m) => ({ ...m, video: null }));
    expect(catalog).toHaveLength(60);
    const vector = applySwipe({}, catalog[0], 'right');
    for (let i = 0; i < 20; i++) rank(vector, catalog);
    const samples = Array.from({ length: 101 }, () => {
      const start = performance.now();
      rank(applySwipe(vector, catalog[1], 'right'), catalog);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    console.time('issue-12: swipe + rank 60 movies');
    rank(applySwipe(vector, catalog[1], 'right'), catalog);
    console.timeEnd('issue-12: swipe + rank 60 movies');
    console.log(`60 movies: median=${samples[50].toFixed(3)}ms, p95=${samples[95].toFixed(3)}ms`);
    expect(samples[50]).toBeLessThan(5);
  });
});
