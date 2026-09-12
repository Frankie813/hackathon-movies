// Covers #18's write-coalescing and its defensive reads. The round trip
// itself (does the vector really survive a reload?) needs a real project or
// the emulator and is verified by hand — see the PR body.
//
// The Firebase SDK ships ESM that jest-expo does not transform, and
// lib/firebase initializes an app from env vars Jest never loads. Stub both,
// and keep a hand-rolled firestore mock so the calls can be asserted on.
interface Ref {
  path: string;
}

interface Snapshot {
  exists(): boolean;
  data(): Record<string, unknown>;
}

interface QuerySnapshot {
  docs: { id: string; data(): Record<string, unknown> }[];
}

// `mock`-prefixed so jest's factory hoisting allows the reference.
const mockSetDoc: jest.Mock<Promise<void>, [Ref, Record<string, unknown>]> = jest.fn();
const mockGetDoc: jest.Mock<Promise<Snapshot>, [Ref]> = jest.fn();
const mockGetDocs: jest.Mock<Promise<QuerySnapshot>, [Ref]> = jest.fn();
const mockDeleteDoc: jest.Mock<Promise<void>, [Ref]> = jest.fn();

// Forwarded rather than passed straight through: jest hoists this factory
// above the consts above, so it has to reach them at call time, not now.
jest.mock('firebase/firestore', () => ({
  setDoc: (ref: Ref, data: Record<string, unknown>) => mockSetDoc(ref, data),
  getDoc: (ref: Ref) => mockGetDoc(ref),
  getDocs: (ref: Ref) => mockGetDocs(ref),
  deleteDoc: (ref: Ref) => mockDeleteDoc(ref),
  // Path builders: return the path so assertions can read it back.
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (ref: unknown) => ref,
  orderBy: jest.fn(),
}));
jest.mock('firebase/auth', () => new Proxy({}, { get: () => jest.fn() }));
jest.mock('../lib/firebase', () => ({ app: {}, db: {}, auth: {} }));

import {
  flushTaste,
  loadLikes,
  loadTaste,
  removeLike,
  saveLike,
  saveTaste,
  TASTE_DEBOUNCE_MS,
  TASTE_FLUSH_EVERY,
  WRITE_ACK_MS,
} from '../src/lib/persist';

/** Lets the microtask queue drain between fake-timer advances. */
const settle = () => Promise.resolve();

function snapshot(data?: Record<string, unknown>): Snapshot {
  return { exists: () => data !== undefined, data: () => data ?? {} };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSetDoc.mockClear().mockResolvedValue(undefined);
  mockDeleteDoc.mockClear().mockResolvedValue(undefined);
  mockGetDoc.mockReset();
  mockGetDocs.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('saveTaste — debounce', () => {
  it('writes nothing until the window closes, then writes once', async () => {
    void saveTaste('u1', { 'genre:28': 1 });
    void saveTaste('u1', { 'genre:28': 2 });
    expect(mockSetDoc).not.toHaveBeenCalled();

    jest.advanceTimersByTime(TASTE_DEBOUNCE_MS);
    await settle();

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][0]).toEqual({ path: 'users/u1/taste/current' });
    // Only the newest vector — each one already contains the swipes before it.
    expect(mockSetDoc.mock.calls[0][1]).toMatchObject({ vector: { 'genre:28': 2 } });
  });

  it('does not wait for the timer once a burst of swipes piles up', async () => {
    for (let i = 1; i <= TASTE_FLUSH_EVERY; i += 1) void saveTaste('u1', { 'genre:28': i });
    await settle();

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][1]).toMatchObject({
      vector: { 'genre:28': TASTE_FLUSH_EVERY },
    });

    // The burst reset the counter, so the next swipe is debounced again.
    void saveTaste('u1', { 'genre:28': 99 });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(TASTE_DEBOUNCE_MS);
    await settle();
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
  });

  it('keeps one user\'s pending write out of another\'s', async () => {
    void saveTaste('u1', { 'genre:28': 1 });
    void saveTaste('u2', { 'genre:35': 1 });
    jest.advanceTimersByTime(TASTE_DEBOUNCE_MS);
    await settle();

    expect(mockSetDoc.mock.calls.map((call) => call[0].path).sort()).toEqual([
      'users/u1/taste/current',
      'users/u2/taste/current',
    ]);
  });

  it('flushTaste writes immediately and cancels the pending timer', async () => {
    void saveTaste('u1', { 'genre:28': 1 });
    await flushTaste('u1');
    expect(mockSetDoc).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(TASTE_DEBOUNCE_MS);
    await settle();
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });

  it('flushTaste with nothing pending is a no-op', async () => {
    await flushTaste('u1');
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('survives a failed write instead of rejecting into the swipe handler', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('offline'));
    void saveTaste('u1', { 'genre:28': 1 });
    await expect(flushTaste('u1')).resolves.toBeUndefined();
  });

  it('stops waiting once the write is queued, rather than hanging offline', async () => {
    // Offline, setDoc() stays pending for the length of the outage.
    mockSetDoc.mockReturnValue(new Promise(() => {}));

    const swipe = saveTaste('u1', { 'genre:28': 1 });
    const flush = flushTaste('u1');
    jest.advanceTimersByTime(WRITE_ACK_MS);

    // Both the flush and the swipe's own promise let go.
    await expect(Promise.all([flush, swipe])).resolves.toEqual([undefined, undefined]);
  });

  it('skips the write when there is no uid yet', async () => {
    await saveTaste('', { 'genre:28': 1 });
    jest.advanceTimersByTime(TASTE_DEBOUNCE_MS);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

describe('loadTaste', () => {
  it('returns the stored vector', async () => {
    mockGetDoc.mockResolvedValue(snapshot({ vector: { 'genre:28': 3, 'keyword:heist': -1 } }));
    await expect(loadTaste('u1')).resolves.toEqual({ 'genre:28': 3, 'keyword:heist': -1 });
  });

  it('returns {} on a first run, without a uid, and when the read fails', async () => {
    mockGetDoc.mockResolvedValue(snapshot(undefined));
    await expect(loadTaste('u1')).resolves.toEqual({});

    await expect(loadTaste('')).resolves.toEqual({});

    mockGetDoc.mockRejectedValue(new Error('permission-denied'));
    await expect(loadTaste('u1')).resolves.toEqual({});
  });

  it('starts cold rather than hanging when Firestore never answers', async () => {
    mockGetDoc.mockReturnValue(new Promise(() => {}));
    const pending = loadTaste('u1');
    jest.runAllTimers();
    await expect(pending).resolves.toEqual({});
  });

  it('drops non-numeric weights so one bad key cannot NaN the whole ranking', async () => {
    mockGetDoc.mockResolvedValue(
      snapshot({ vector: { 'genre:28': 2, 'genre:35': 'lots', 'cast:1': null } }),
    );
    await expect(loadTaste('u1')).resolves.toEqual({ 'genre:28': 2 });
  });

  it('tolerates a vector field that is not an object at all', async () => {
    mockGetDoc.mockResolvedValue(snapshot({ vector: ['genre:28'] }));
    await expect(loadTaste('u1')).resolves.toEqual({});
  });
});

describe('likes', () => {
  it('writes one row per title, keyed by the movie id', async () => {
    await saveLike('u1', 27205);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][0]).toEqual({ path: 'users/u1/likes/27205' });
    expect(mockSetDoc.mock.calls[0][1]).toMatchObject({ movieId: 27205 });
    expect((mockSetDoc.mock.calls[0][1] as { likedAt: number }).likedAt).toBeGreaterThan(0);
  });

  it('drops the row again on a left swipe, so a rejected title leaves Saved', async () => {
    await removeLike('u1', 27205);
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    expect(mockDeleteDoc.mock.calls[0][0]).toEqual({ path: 'users/u1/likes/27205' });
  });

  it('does not reject or hang when the delete fails or never acknowledges', async () => {
    mockDeleteDoc.mockRejectedValueOnce(new Error('offline'));
    await expect(removeLike('u1', 27205)).resolves.toBeUndefined();

    mockDeleteDoc.mockReturnValue(new Promise(() => {}));
    const pending = removeLike('u1', 603);
    jest.advanceTimersByTime(WRITE_ACK_MS);
    await expect(pending).resolves.toBeUndefined();
  });

  it('skips both writes when there is no uid yet', async () => {
    await saveLike('', 27205);
    await removeLike('', 27205);
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it('reads the like list back and skips rows without a usable id', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: '27205', data: () => ({ movieId: 27205, likedAt: 2 }) },
        { id: '603', data: () => ({ likedAt: 1 }) }, // id falls back to the doc id
        { id: 'junk', data: () => ({}) },
      ],
    });

    await expect(loadLikes('u1')).resolves.toEqual([
      { movieId: 27205, likedAt: 2 },
      { movieId: 603, likedAt: 1 },
    ]);
  });

  it('returns [] when the read fails', async () => {
    mockGetDocs.mockRejectedValue(new Error('offline'));
    await expect(loadLikes('u1')).resolves.toEqual([]);
  });
});
