import type { Movie, TasteVector } from '../types';
import { rank, type RankJitter } from './taste';

/**
 * Share of cards served off-profile so the deck doesn't collapse into one genre.
 * Set to 0 before recording the demo video (#28) for a deterministic deck.
 */
export const EPSILON = 0.2;

/**
 * ε-greedy pick from the unseen deck: usually the top-scored title, but with
 * probability `epsilon` a random other one. Picks from the local deck so it
 * works offline. Throws on an empty deck.
 */
export function nextCard(
  v: TasteVector,
  deck: Movie[],
  random: () => number = Math.random,
  epsilon: number = EPSILON,
  jitter?: RankJitter,
): Movie {
  if (deck.length === 0) throw new Error('nextCard: empty deck');
  const [top, ...rest] = rank(v, deck, jitter);
  if (rest.length === 0 || random() >= epsilon) return top;
  return rest[Math.floor(random() * rest.length)];
}

/** Rank the unseen deck with the ε-greedy pick at the front. */
export function exploreRank(
  v: TasteVector,
  deck: Movie[],
  random: () => number = Math.random,
  epsilon: number = EPSILON,
  jitter?: RankJitter,
): Movie[] {
  if (deck.length === 0) return [];
  const pick = nextCard(v, deck, random, epsilon, jitter);
  return [pick, ...rank(v, deck.filter((movie) => movie !== pick), jitter)];
}
