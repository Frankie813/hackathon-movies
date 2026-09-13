// src/lib/picks.ts — the end of a swipe round (issues #97, #91).
//
// The deck is capped at 30 cards so a demo is two minutes, not twenty
// (AGENTS.md §2). When a round runs out the user does not get "DECK
// COMPLETED": they get the algorithm's top few picks, and if none of those
// appeal, "Keep swiping" starts the next round.
//
// One build serves both. The picks are literally the head of the next round's
// ranked pool, which means:
//   - the fetch happens once, and the picks screen is what the user looks at
//     while it lands rather than a spinner;
//   - the picks are honestly "what the algorithm would show you next", not a
//     separate list assembled to look impressive;
//   - "Keep swiping" is instant, because the deck is already in hand.
//
// Nothing here rejects. Every source below is #15's fetch layer or built on
// it, and all of them degrade to the seed catalog rather than throwing, so the
// worst case offline is a weaker set of picks — never a dead end (PLAN.md §L).

import { DECK_MAX, getDeck } from '@/lib/tmdb';
import { seedCandidates } from './candidates';
import { rank, type RankJitter } from './taste';
import type { DiscoverFilters, Movie, TasteVector } from '../types';

/**
 * Recommendations shown at the end of a round. Three fits a phone screen
 * without scrolling and reads as a considered shortlist; a longer list is just
 * the deck again in a different shape.
 */
export const PICKS_COUNT = 3;

export interface NextRoundOptions {
  /** Movies swiped in this or any earlier session — never dealt again. */
  seen?: ReadonlySet<number>;
  /** The active mood (#11/#22), so a filtered deck stays filtered across rounds. */
  filters?: DiscoverFilters;
  /** #96's per-session tie-break, so two rounds don't rank identically. */
  jitter?: RankJitter;
}

export interface NextRound {
  /** The top PICKS_COUNT titles: the recommendations screen. */
  picks: Movie[];
  /**
   * The next round's cards, ranked, capped at DECK_MAX.
   *
   * The cap is applied here rather than left to SwipeDeck: `maxCards` only
   * stops #13's top-ups, it does not trim the deck it is handed, so merging
   * two sources would otherwise deal a 50-card round and the whole point of
   * #97 — a demo that is two minutes and not twenty — would be lost.
   */
  deck: Movie[];
}

/**
 * The next round's ranked pool, split into the picks and the deck behind them.
 *
 * Two sources, deliberately:
 *   - getDeck() is the breadth — a fresh /discover page the user has not seen.
 *     Without it a round-two deck would be nothing but relatives of round
 *     one's likes and the deck would narrow to a single genre by round three.
 *   - seedCandidates() is the depth — TMDB's related titles for whatever they
 *     liked most. This is the half that makes the picks feel earned.
 *
 * Gemini is not asked. seedCandidates() answers the same question off TMDB
 * without spending from a 15 RPM budget, and SwipeDeck already falls back to
 * the Gemini recommender mid-round when the related-title pool comes back dry.
 *
 * Ranked with plain rank(), not exploreRank(): the ε-greedy pick exists to
 * keep a *deck* from collapsing into one genre, but a recommendation that is
 * deliberately off-profile is just a worse recommendation.
 */
export async function buildNextRound(
  taste: TasteVector,
  liked: Movie[],
  opts: NextRoundOptions = {},
): Promise<NextRound> {
  const seen = opts.seen ?? new Set<number>();

  // In parallel: both are bounded by #15's own operation budget, and running
  // them in series would double the wait the picks screen has to cover.
  const [discovered, related] = await Promise.all([
    getDeck(opts.filters, { seen }),
    // Resolves [] with no likes or no network rather than rejecting.
    seedCandidates(taste, liked, { swiped: seen }),
  ]);

  const pool: Movie[] = [];
  const have = new Set<number>();
  for (const movie of [...related, ...discovered]) {
    // getDeck() only falls back to already-seen titles when it cannot find
    // enough new ones, so this is a filter of last resort rather than the
    // common path — but a round that re-deals a card the user just swiped is
    // the one thing that makes the loop look broken.
    if (have.has(movie.id) || seen.has(movie.id)) continue;
    have.add(movie.id);
    pool.push(movie);
  }

  // Everything the user has already judged is exhausted. Better to re-deal
  // than to hand back an empty round and dead-end the demo.
  const ranked = rank(taste, pool.length > 0 ? pool : discovered, opts.jitter);

  return {
    picks: ranked.slice(0, PICKS_COUNT),
    deck: ranked.slice(PICKS_COUNT, PICKS_COUNT + DECK_MAX),
  };
}
