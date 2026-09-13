// __tests__/active-session.test.ts — the one value the Group tab, the Swipe
// tab and the match watcher all have to agree on.

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

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __resetActiveCode,
  getActiveCode,
  hydrateActiveCode,
  setActiveCode,
  subscribeActiveCode,
} from '../lib/active-session';

const KEY = 'moviematch.activeSessionCode';

beforeEach(() => {
  __resetActiveCode();
  mockStore.clear();
  jest.clearAllMocks();
});

describe('active session code', () => {
  it('starts empty and restores the persisted code', async () => {
    mockStore.set(KEY, 'BCDF');
    expect(getActiveCode()).toBeNull();
    await expect(hydrateActiveCode()).resolves.toBe('BCDF');
    expect(getActiveCode()).toBe('BCDF');
  });

  it('persists a set code and clears it on leave', async () => {
    setActiveCode('GHJK');
    expect(getActiveCode()).toBe('GHJK');
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(KEY, 'GHJK');

    setActiveCode(null);
    expect(getActiveCode()).toBeNull();
    await Promise.resolve();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY);
  });

  it('lets a code set during hydration win over the stored one', async () => {
    mockStore.set(KEY, 'OLDD');
    const restoring = hydrateActiveCode();
    setActiveCode('NEWW'); // a QR scan while the read is in flight
    await expect(restoring).resolves.toBe('NEWW');
    expect(getActiveCode()).toBe('NEWW');
  });

  it('does not resurrect a stored code after an explicit leave', async () => {
    mockStore.set(KEY, 'OLDD');
    const restoring = hydrateActiveCode();
    setActiveCode(null);
    await expect(restoring).resolves.toBeNull();
    expect(getActiveCode()).toBeNull();
  });

  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const seen: (string | null)[] = [];
    const stop = subscribeActiveCode((code) => seen.push(code));
    setActiveCode('BCDF');
    setActiveCode('BCDF'); // no-op: same code
    setActiveCode(null);
    stop();
    setActiveCode('GHJK');
    expect(seen).toEqual(['BCDF', null]);
  });

  it('survives a storage read failure by starting empty', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    await expect(hydrateActiveCode()).resolves.toBeNull();
  });
});
