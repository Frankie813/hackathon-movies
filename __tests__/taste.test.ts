import { applySwipe, features, JITTER, makeJitter, rank, score } from '../src/lib/taste';
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

describe('session jitter (#96)', () => {
  const deck = Array.from({ length: 12 }, (_, i) => movie(i + 1, [i % 2 ? 28 : 35]));
  /** A seeded LCG, so "random" orders are reproducible in the test. */
  const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  it('deals a different cold-start order per session, stable within one', () => {
    const a = makeJitter(seeded(1));
    const b = makeJitter(seeded(2));
    const orderA = rank({}, deck, a).map((m) => m.id);
    expect(rank({}, deck, a).map((m) => m.id)).toEqual(orderA);
    expect(rank({}, deck, b).map((m) => m.id)).not.toEqual(orderA);
    expect([...orderA].sort((x, y) => x - y)).toEqual(deck.map((m) => m.id));
  });

  it('reshuffles near-ties but never lifts a clearly off-taste title over an on-taste one', () => {
    const vector = { 'genre:28': 4 }; // action scores 4, comedy 0
    for (let seed = 1; seed <= 25; seed += 1) {
      const ranked = rank(vector, deck, makeJitter(seeded(seed)));
      // Jitter is at most JITTER of the 0..4 range, so every action title still leads.
      expect(JITTER).toBeLessThan(1);
      expect(ranked.slice(0, 6).every((m) => m.genreIds[0] === 28)).toBe(true);
    }
    const orders = new Set(
      Array.from({ length: 10 }, (_, s) => rank(vector, deck, makeJitter(seeded(s + 1))).map((m) => m.id).join(',')),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('draws once per movie id, including ids it meets later', () => {
    const random = jest.fn(seeded(7));
    const jitter = makeJitter(random);
    jitter(1); jitter(1); jitter(2);
    expect(random).toHaveBeenCalledTimes(2);
    expect(jitter(1)).toBe(jitter(1));
  });
});
