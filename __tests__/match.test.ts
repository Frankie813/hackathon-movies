// Covers the pure half of #17. The Firestore half (persistMatch,
// subscribeMatch) needs a real project or the emulator and is verified by
// hand — see the PR body.
//
// The Firebase SDK ships ESM that jest-expo does not transform, and
// lib/firebase initializes an app from env vars Jest never loads. Neither is
// reachable from the pure functions under test, so stub both out.
jest.mock('firebase/firestore', () => new Proxy({}, { get: () => jest.fn() }));
jest.mock('firebase/auth', () => new Proxy({}, { get: () => jest.fn() }));
jest.mock('../lib/firebase', () => ({ app: {}, db: {}, auth: {} }));

import { detectMatch, MIN_SWIPES_FOR_FALLBACK, memberTaste, rankGroup } from '../src/lib/match';
import type { Member, Movie } from '../src/types';

function movie(id: number, genreIds: number[], keywords: string[] = []): Movie {
  return { id, title: `Movie ${id}`, year: 2026, genreIds, genreNames: [],
    keywords, poster: '', providers: [], video: null };
}

function member(uid: string, likes: number[] = [], dislikes: number[] = []): Member {
  return { uid, likes, dislikes };
}

/** Enough swipes to arm the no-agreement fallback, none of them about `movies`. */
function padding(count = MIN_SWIPES_FOR_FALLBACK): number[] {
  return Array.from({ length: count }, (_, i) => 900 + i);
}

const action = movie(1, [28]);
const comedy = movie(2, [35]);
const horror = movie(3, [27]);
const catalog = [action, comedy, horror];

describe('rankGroup — Average-without-Misery', () => {
  it('drops a title any single member swiped left on, however much the rest like it', () => {
    const ranked = rankGroup([member('a', [1]), member('b', [], [1])], catalog);
    expect(ranked.map((m) => m.id)).not.toContain(1);
  });

  it('ranks survivors by mean score, so a shared genre beats a one-sided one', () => {
    const both = [member('a', [10]), member('b', [11])];
    const withHistory = [movie(10, [28]), movie(11, [28, 35]), action, comedy];
    // a likes only action; b likes action + comedy. Pure action scores 1 for
    // both; the mixed title is diluted for a, and the pure comedy only pleases b.
    expect(rankGroup(both, withHistory).map((m) => m.id)).toEqual([10, 1, 11, 2]);
    const tail = rankGroup(both, [action, comedy]);
    expect(tail.map((m) => m.id)).toEqual([1, 2]);
  });

  it('tie-breaks equal means by mutual-like count, then by input order', () => {
    // Both titles score 0 for everyone (no history), but one was liked by both.
    const ranked = rankGroup([member('a', [2]), member('b', [2])], [action, comedy, horror]);
    expect(ranked.map((m) => m.id)).toEqual([2, 1, 3]);
  });

  it('keeps an explicit like even when the member disliked its whole genre before', () => {
    const grumpy = member('a', [1], [10, 11]);
    const history = [movie(10, [28]), movie(11, [28]), action];
    // Two action dislikes against one action like leaves the genre net negative.
    expect(memberTaste(grumpy, history)['genre:28']).toBe(-1);
    expect(rankGroup([grumpy, member('b', [1])], history).map((m) => m.id)).toContain(1);
  });

  it('drops a title scored below the misery floor without an explicit swipe', () => {
    const hatesHorror = member('a', [], [30]);
    const history = [movie(30, [27]), horror, comedy];
    expect(rankGroup([hatesHorror, member('b')], history).map((m) => m.id)).toEqual([2]);
  });

  it('prefers a persisted taste vector over replaying swipes', () => {
    const withVector: Member = { uid: 'a', likes: [], dislikes: [], taste: { 'genre:35': 5 } };
    expect(memberTaste(withVector, catalog)).toEqual({ 'genre:35': 5 });
    expect(rankGroup([withVector, member('b')], catalog)[0].id).toBe(2);
  });

  it('returns everything in input order for an empty group or an empty catalog', () => {
    expect(rankGroup([], catalog)).toEqual(catalog);
    expect(rankGroup([member('a')], [])).toEqual([]);
  });
});

describe('detectMatch', () => {
  it('fires on a mutual like', () => {
    expect(detectMatch([member('a', [2]), member('b', [2])], catalog)?.id).toBe(2);
  });

  it('never fires on a title one member vetoed, even if everyone else liked it', () => {
    const members = [member('a', [1]), member('b', [1]), member('c', [], [1])];
    expect(detectMatch(members, catalog)?.id).not.toBe(1);
  });

  it('holds while only one member has liked the title', () => {
    expect(detectMatch([member('a', [2]), member('b')], catalog)).toBeNull();
  });

  it('never matches a solo session', () => {
    expect(detectMatch([member('a', [1, 2, 3])], catalog)).toBeNull();
  });

  it('falls back to the top survivor once everyone has swiped enough', () => {
    const a = member('a', padding());
    const b = member('b', padding());
    expect(detectMatch([a, b], catalog)).not.toBeNull();
    // One card short on either side and it still holds.
    expect(detectMatch([member('a', padding(MIN_SWIPES_FOR_FALLBACK - 1)), b], catalog)).toBeNull();
  });

  it('never lets the fallback pick a vetoed title', () => {
    const a = { ...member('a', padding()), taste: { 'genre:28': 9 } };
    const b = { ...member('b', padding(), [1]), taste: { 'genre:28': 9 } };
    const winner = detectMatch([a, b], catalog);
    expect(winner).not.toBeNull();
    expect(winner?.id).not.toBe(1);
  });

  it('returns null when every title is vetoed', () => {
    const a = member('a', padding(), [1, 2, 3]);
    expect(detectMatch([a, member('b', padding())], catalog)).toBeNull();
  });

  it('honors an overridden swipe threshold', () => {
    const members = [member('a', [10]), member('b', [11])];
    expect(detectMatch(members, catalog, { minSwipes: 1 })).not.toBeNull();
  });
});
