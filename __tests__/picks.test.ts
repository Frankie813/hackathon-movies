// __tests__/picks.test.ts — the end of a swipe round (#97, #91).
//
// buildNextRound() is the seam between "the deck ran out" and "here is what to
// watch, or swipe another thirty". Both of its sources are #15's contract and
// are mocked here, so these assert the *composition* — what gets merged, what
// gets dropped, and how the pool is split — rather than TMDB's current
// /discover page.

import { buildNextRound, PICKS_COUNT } from '../src/lib/picks';
import { applySwipe } from '../src/lib/taste';
import type { Movie, TasteVector } from '../src/types';

jest.mock('../lib/tmdb', () => ({ getDeck: jest.fn(), DECK_MAX: 30 }));
jest.mock('../src/lib/candidates', () => ({ seedCandidates: jest.fn() }));

const { getDeck } = jest.requireMock<{ getDeck: jest.Mock<Promise<Movie[]>, unknown[]> }>(
  '../lib/tmdb',
);
const { seedCandidates } = jest.requireMock<{
  seedCandidates: jest.Mock<Promise<Movie[]>, unknown[]>;
}>('../src/lib/candidates');

function movie(id: number, genreIds: number[] = [28]): Movie {
  return {
    id,
    title: `Movie ${id}`,
    year: 2026,
    genreIds,
    genreNames: [],
    keywords: [],
    poster: '',
    providers: [],
    video: { key: `yt${id}`, start: 5, end: 23, source: 'tmdb-clip' },
  };
}

/** A vector that plainly prefers action (28) over comedy (35). */
function actionTaste(): TasteVector {
  return [movie(90), movie(91)].reduce<TasteVector>((v, m) => applySwipe(v, m, 'right'), {});
}

beforeEach(() => {
  getDeck.mockReset();
  seedCandidates.mockReset();
  getDeck.mockResolvedValue([]);
  seedCandidates.mockResolvedValue([]);
});

describe('buildNextRound', () => {
  it('splits the pool into the picks and the deck behind them', async () => {
    getDeck.mockResolvedValue([1, 2, 3, 4, 5, 6].map((id) => movie(id)));

    const round = await buildNextRound({}, []);

    expect(round.picks).toHaveLength(PICKS_COUNT);
    expect(round.deck).toHaveLength(6 - PICKS_COUNT);
    // The whole point of one build serving both: a title the user was just
    // shown and declined must not be dealt back as a card.
    const dealt = round.deck.map((m) => m.id);
    for (const pick of round.picks) expect(dealt).not.toContain(pick.id);
  });

  it('leads with the titles the taste vector actually prefers', async () => {
    // Comedy from /discover, action from the related-title expansion. The
    // ranking, not the source, decides what surfaces as a recommendation.
    getDeck.mockResolvedValue([movie(1, [35]), movie(2, [35]), movie(3, [35])]);
    seedCandidates.mockResolvedValue([movie(10), movie(11), movie(12)]);

    const round = await buildNextRound(actionTaste(), [movie(90)]);

    expect(round.picks.map((m) => m.id)).toEqual([10, 11, 12]);
  });

  it('merges both sources and deduplicates across them', async () => {
    // TMDB's related list routinely overlaps the discover page; a duplicate
    // here would show the same film twice on a three-item screen.
    getDeck.mockResolvedValue([movie(1), movie(2)]);
    seedCandidates.mockResolvedValue([movie(2), movie(3)]);

    const round = await buildNextRound({}, [movie(90)]);
    const ids = [...round.picks, ...round.deck].map((m) => m.id);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('never deals a title the user has already swiped', async () => {
    // getDeck() only returns seen titles when it runs out of new ones, so this
    // is the last line of defence rather than the common path.
    getDeck.mockResolvedValue([movie(1), movie(2), movie(3)]);
    seedCandidates.mockResolvedValue([movie(4)]);

    const round = await buildNextRound({}, [], { seen: new Set([1, 3]) });
    const ids = [...round.picks, ...round.deck].map((m) => m.id);

    expect(ids).not.toContain(1);
    expect(ids).not.toContain(3);
    expect(ids.sort()).toEqual([2, 4]);
  });

  it('carries the active mood into the next round', async () => {
    // A mood that lapsed silently after thirty cards would look like the
    // filter had stopped working (#11).
    const filters = { withGenres: [27] };
    await buildNextRound({}, [], { filters });

    expect(getDeck).toHaveBeenCalledWith(filters, expect.anything());
  });

  it('still produces a round when the related-title pool is dry', async () => {
    // Offline, or with no likes yet: seedCandidates resolves [] rather than
    // throwing, and getDeck has already fallen back to the seed catalog.
    getDeck.mockResolvedValue([1, 2, 3, 4].map((id) => movie(id)));
    seedCandidates.mockResolvedValue([]);

    const round = await buildNextRound({}, []);

    expect(round.picks).toHaveLength(PICKS_COUNT);
    expect(round.deck).toHaveLength(1);
  });

  it('re-deals rather than dead-ending when every new title is exhausted', async () => {
    // Everything TMDB has left is already seen. A repeat card is a far better
    // outcome than an empty round with nothing to swipe (PLAN.md §L).
    getDeck.mockResolvedValue([movie(1), movie(2), movie(3), movie(4)]);
    seedCandidates.mockResolvedValue([]);

    const round = await buildNextRound({}, [], { seen: new Set([1, 2, 3, 4]) });

    expect([...round.picks, ...round.deck]).toHaveLength(4);
  });

  it('never deals more than a round, however much the two sources return', async () => {
    // The reason the cap lives here: SwipeDeck's maxCards stops #13's top-ups
    // but does not trim the deck it is handed, so merging /discover with the
    // related-title expansion would otherwise deal a fifty-card round and the
    // whole point of the cap — a two-minute demo — would be gone.
    getDeck.mockResolvedValue(Array.from({ length: 20 }, (_, i) => movie(i + 1)));
    seedCandidates.mockResolvedValue(Array.from({ length: 36 }, (_, i) => movie(i + 100)));

    const round = await buildNextRound({}, [movie(90)]);

    expect(round.picks).toHaveLength(PICKS_COUNT);
    expect(round.deck).toHaveLength(30);
  });

  it('asks both sources at once rather than one after the other', async () => {
    // In series these two are the difference between a picks screen that
    // appears in eight seconds and one that appears in sixteen.
    let settle: (() => void) | null = null;
    getDeck.mockImplementation(
      () => new Promise<Movie[]>((resolve) => { settle = () => resolve([movie(1)]); }),
    );
    seedCandidates.mockResolvedValue([movie(2)]);

    const pending = buildNextRound({}, [movie(90)]);
    await Promise.resolve();

    expect(seedCandidates).toHaveBeenCalledTimes(1);
    settle!();
    await pending;
  });
});
