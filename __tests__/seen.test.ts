// lib/seen.ts: the swiped-movie history that lets a returning user get new
// films instead of the same popular ones every launch.

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { __resetSeen, getSeen, loadSeen, markSeen, MAX_SEEN } from '../lib/seen';

const KEY = 'moviematch.seenMovies.v1';

beforeEach(() => {
  jest.useFakeTimers();
  __resetSeen();
  mockStore.clear();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

describe('seen movies', () => {
  it('restores what earlier sessions swiped', async () => {
    mockStore.set(KEY, JSON.stringify([603, 27205]));
    expect(getSeen().size).toBe(0);
    const seen = await loadSeen();
    expect([...seen]).toEqual([603, 27205]);
  });

  it('persists swipes in one batched write, likes and passes alike', async () => {
    await loadSeen();
    markSeen(1);
    markSeen(2);
    markSeen(1);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockStore.get(KEY)!)).toEqual([2, 1]);
  });

  it('keeps swipes made before the stored list finished loading', async () => {
    mockStore.set(KEY, JSON.stringify([10, 11]));
    const loading = loadSeen();
    markSeen(12);
    expect([...(await loading)]).toEqual([10, 11, 12]);
  });

  it('forgets the oldest past MAX_SEEN', async () => {
    mockStore.set(KEY, JSON.stringify(Array.from({ length: MAX_SEEN }, (_, i) => i + 1)));
    await loadSeen();
    markSeen(99999);
    expect(getSeen().size).toBe(MAX_SEEN);
    expect(getSeen().has(1)).toBe(false);
    expect(getSeen().has(99999)).toBe(true);
  });

  it('treats unreadable or corrupt storage as an empty history', async () => {
    mockStore.set(KEY, '{not json');
    expect((await loadSeen()).size).toBe(0);
    __resetSeen();
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await loadSeen()).size).toBe(0);
  });
});
