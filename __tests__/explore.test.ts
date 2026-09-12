import { EPSILON, exploreRank, nextCard } from '../src/lib/explore';
import { rank } from '../src/lib/taste';
import type { Movie } from '../src/types';

function movie(id: number, genreIds: number[]): Movie {
  return { id, title: `Movie ${id}`, year: 2026, genreIds, genreNames: [],
    keywords: [], poster: '', providers: [], video: null };
}

/** Deterministic PRNG (mulberry32) so the rate test never flakes. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ε-greedy exploration', () => {
  const taste = { 'genre:28': 3 };
  const deck = [movie(1, [35]), movie(2, [28]), movie(3, [27]), movie(4, [18])];

  it('exports ε = 0.2', () => {
    expect(EPSILON).toBe(0.2);
  });

  it('serves the top-scored title when the roll misses ε', () => {
    expect(nextCard(taste, deck, () => 0.5).id).toBe(2);
  });

  it('serves an off-profile title when the roll hits ε', () => {
    const rolls = [0.1, 0];
    expect(nextCard(taste, deck, () => rolls.shift()!).id).not.toBe(2);
  });

  it('is fully greedy with ε = 0', () => {
    expect(nextCard(taste, deck, () => 0, 0).id).toBe(2);
  });

  it('returns the only card and rejects an empty deck', () => {
    expect(nextCard(taste, [deck[0]], () => 0).id).toBe(1);
    expect(() => nextCard(taste, [])).toThrow();
  });

  it('keeps every card exactly once when exploring', () => {
    const rolls = [0.1, 0.99];
    const ranked = exploreRank(taste, deck, () => rolls.shift()!);
    expect(ranked).toHaveLength(deck.length);
    expect(new Set(ranked.map((m) => m.id))).toEqual(new Set([1, 2, 3, 4]));
    expect(ranked[0].id).not.toBe(2);
    expect(exploreRank(taste, deck, () => 0.5)).toEqual(rank(taste, deck));
    expect(exploreRank(taste, [])).toEqual([]);
  });

  it('serves roughly 1 in 5 cards off-profile', () => {
    const random = seeded(14);
    const trials = 5000;
    let offProfile = 0;
    for (let i = 0; i < trials; i++) {
      if (nextCard(taste, deck, random).id !== 2) offProfile++;
    }
    expect(offProfile / trials).toBeGreaterThan(0.17);
    expect(offProfile / trials).toBeLessThan(0.23);
  });
});
