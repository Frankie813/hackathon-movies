// src/lib/candidates.ts — candidate seeding from related titles (issue #13).
//
// PLAN.md §H calls this the "cheap collaborative substitute": we have no
// ratings matrix and no server, so instead of computing neighbours we let TMDB
// do it — /recommendations and /similar on the titles the user liked most.
//
// The job is to stop the deck running dry. #12 re-ranks what is already in the
// pool; this is the only thing that puts anything *new* in it.
//
// Every network call goes through #15's fetch layer, which never throws and
// falls back to the seed catalog. So nothing here needs a try/catch and nothing
// here can surface an error to the user — that is deliberate, not an oversight.

import { similar } from '@/lib/tmdb';
import type { Movie, TasteVector } from '../types';
import { rank } from './taste';

/**
 * Liked titles to expand. TMDB returns ~20 related ids each and #15 hydrates a
 * capped slice of them, so three is already 20–36 hydration calls; a fourth
 * buys little and costs a visible pause on venue Wi-Fi.
 */
const TOP_LIKES = 3;

/**
 * Hard ceiling on deck + new candidates. rank() is O(n) per swipe and runs
 * inside the gesture (#12's <5ms-for-60-movies budget), so the pool is not
 * allowed to grow without bound just because the user keeps liking things.
 */
const MAX_POOL = 100;

export interface SeedCandidatesOptions {
  /**
   * TMDB ids currently in the deck. Deduped against, and counted against
   * MAX_POOL — pass this, or the caller gets back titles it is already showing.
   */
  deck?: Iterable<number>;
  /** TMDB ids already swiped. Never returned again, liked or disliked. */
  swiped?: Iterable<number>;
  /** Ceiling on `deck.length + result.length`. Defaults to 100. */
  maxPool?: number;
}

/**
 * New candidates to append to the deck, best-first by the current taste vector.
 *
 * Returns only titles the caller does not already have: `liked`, `opts.deck`
 * and `opts.swiped` are all excluded, and the three related-title lists are
 * deduped against each other. Appending the result to the deck therefore
 * cannot produce a duplicate id — the issue's second acceptance criterion.
 *
 * Returns `[]` rather than throwing when there is nothing to add: no likes yet,
 * the pool is already at `maxPool`, or the network is down.
 *
 * The `opts` parameter is additive to the signature frozen in issue #13
 * (`seedCandidates(v, liked)`); two-argument callers still compile, they just
 * dedupe against `liked` alone.
 */
export async function seedCandidates(
  v: TasteVector,
  liked: Movie[],
  opts: SeedCandidatesOptions = {},
): Promise<Movie[]> {
  const deck = new Set(opts.deck ?? []);
  const maxPool = opts.maxPool ?? MAX_POOL;

  const room = maxPool - deck.size;
  if (room <= 0 || liked.length === 0) return [];

  // Top-3 by the *current* taste vector, not swipe order: after five swipes the
  // vector knows which of the likes was on-taste and which was a one-off.
  const seeds = rank(v, liked).slice(0, TOP_LIKES);

  // In parallel: each similar() carries its own deadline and returns seed-based
  // results rather than throwing, so there is no failure to propagate here.
  //
  // Offline that fallback is what makes this a no-op without a special case:
  // #15 answers from the seed catalog, and offline the seed catalog *is* the
  // deck, so every related title dedupes away below and the deck is left
  // untouched. On a mid-session drop the deck is live titles instead, and the
  // seed suggestions that survive are real, pre-validated cards — better than
  // returning nothing, and still no risk of a duplicate.
  const lists = await Promise.all(seeds.map((movie) => similar(movie.id)));

  const seen = new Set<number>([
    ...deck,
    ...(opts.swiped ?? []),
    ...liked.map((movie) => movie.id),
  ]);

  const fresh: Movie[] = [];
  for (const movie of lists.flat()) {
    if (seen.has(movie.id)) continue;
    seen.add(movie.id);
    // #15 already drops poster-only titles, but a card with no key is a dead
    // player mid-demo — cheap to re-check, expensive to get wrong.
    if (movie.video === null) continue;
    fresh.push(movie);
  }

  // Rank before capping so the cap drops the least on-taste titles, not the
  // ones TMDB happened to list last.
  return rank(v, fresh).slice(0, room);
}
