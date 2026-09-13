import type { Movie } from '../src/types';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
  },
}));

import {
  countsTowardPin,
  GENRE_PIN_LIMIT,
  getGenrePin,
  pinnedRank,
  setGenrePin,
} from '../src/lib/genre-pin';
import { rank } from '../src/lib/taste';

function movie(id: number, genreIds: number[]): Movie {
  return {
    id,
    title: `Movie ${id}`,
    year: 2026,
    genreIds,
    genreNames: [],
    keywords: [],
    poster: '',
    providers: [],
    video: null,
  };
}

const ANIMATION = 16;
const ACTION = 28;

describe('pinnedRank', () => {
  const deck = [movie(1, [ACTION]), movie(2, [ANIMATION]), movie(3, [ACTION]), movie(4, [ANIMATION])];

  it('falls through to a plain rank() with no pin', () => {
    const v = { [`genre:${ACTION}`]: 3 };
    expect(pinnedRank(null, v, deck)).toEqual(rank(v, deck));
  });

  it('falls through once the pin budget is spent', () => {
    const v = {};
    const pin = { genreIds: [ANIMATION], count: GENRE_PIN_LIMIT };
    expect(pinnedRank(pin, v, deck)).toEqual(rank(v, deck));
  });

  it('forces the pinned genre to the front even after dislikes tanked its score', () => {
    // Four dislikes on Animation titles would ordinarily push genre:16 well
    // below the untouched Action titles — this is exactly that state.
    const v = { [`genre:${ANIMATION}`]: -4 };
    const pin = { genreIds: [ANIMATION], count: 2 };
    const [first] = pinnedRank(pin, v, deck);
    expect(first.genreIds).toContain(ANIMATION);
  });

  it('falls through when the deck has nothing left from the pinned genre', () => {
    const v = {};
    const pin = { genreIds: [999], count: 0 };
    expect(pinnedRank(pin, v, deck)).toEqual(rank(v, deck));
  });

  it('never drops or duplicates a card', () => {
    const pin = { genreIds: [ANIMATION], count: 0 };
    const out = pinnedRank(pin, {}, deck);
    expect(out).toHaveLength(deck.length);
    expect(new Set(out.map((m) => m.id))).toEqual(new Set([1, 2, 3, 4]));
  });
});

describe('countsTowardPin', () => {
  const animated = movie(2, [ANIMATION]);
  const nonAnimated = movie(1, [ACTION]);

  it('is false with no pin', () => {
    expect(countsTowardPin(null, animated)).toBe(false);
  });

  it('is true for a pinned-genre title under budget', () => {
    expect(countsTowardPin({ genreIds: [ANIMATION], count: 0 }, animated)).toBe(true);
  });

  it('is false once the budget is spent', () => {
    expect(countsTowardPin({ genreIds: [ANIMATION], count: GENRE_PIN_LIMIT }, animated)).toBe(false);
  });

  it('is false for a title outside the pinned genre(s)', () => {
    expect(countsTowardPin({ genreIds: [ANIMATION], count: 0 }, nonAnimated)).toBe(false);
  });
});

describe('getGenrePin / setGenrePin', () => {
  beforeEach(() => mockStore.clear());

  it('is null when nothing has been set', async () => {
    expect(await getGenrePin()).toBeNull();
  });

  it('round-trips a pin', async () => {
    await setGenrePin({ genreIds: [ANIMATION, ACTION], count: 3 });
    expect(await getGenrePin()).toEqual({ genreIds: [ANIMATION, ACTION], count: 3 });
  });

  it('clears on null', async () => {
    await setGenrePin({ genreIds: [ANIMATION], count: 1 });
    await setGenrePin(null);
    expect(await getGenrePin()).toBeNull();
  });

  it('treats malformed storage as no pin', async () => {
    mockStore.set('moviematch.genrePin', '{"not":"a pin"}');
    expect(await getGenrePin()).toBeNull();
  });
});
