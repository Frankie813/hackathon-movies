// Covers watchForMatch's claim/explain handoff — the seam between #17 (which
// title the group gets) and #21 (the line that describes it), which #10 then
// renders as one unit.
//
// match.test.ts covers the pure ranking and stops at the Firestore boundary.
// The bug this file pins is on the other side of that boundary and only shows
// up when two devices detect in the same tick: the transaction adopts the
// first device's title, and a caller that went on to describe its *own*
// detected title would patch a `why` about film A onto a document naming film
// B. The reveal would then put a real poster above a real sentence about a
// different real film — every part valid, the pair wrong.
//
// The fake below is deliberately lazy about snapshots: onSnapshot registers a
// listener and never fires on its own. That is what lets a test deliver a
// member snapshot *before* the match snapshot, which is the race itself — in
// production the match document arriving first sets `matched` and the claim
// path is never entered at all.

// Everything the factory touches is `mock`-prefixed on purpose, types included:
// babel-plugin-jest-hoist rejects out-of-scope references inside a jest.mock
// factory and reads a parameter name inside a function-type annotation as one,
// so an inline `(snap: unknown) => void` fails where `MockListener` passes.
type MockRef = { path: string };
type MockData = Record<string, unknown>;
type MockListener = (snap: unknown) => void;
type MockTransaction = (tx: unknown) => Promise<unknown>;

const mockStore = new Map<string, MockData>();
const mockListeners = new Map<string, MockListener[]>();

const mockSnapshot = (path: string) => ({
  exists: () => mockStore.has(path),
  data: () => mockStore.get(path),
});

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]): MockRef => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]): MockRef => ({ path: segments.join('/') }),
  onSnapshot: (ref: MockRef, next: MockListener) => {
    mockListeners.set(ref.path, [...(mockListeners.get(ref.path) ?? []), next]);
    return () =>
      mockListeners.set(
        ref.path,
        (mockListeners.get(ref.path) ?? []).filter((listener) => listener !== next),
      );
  },
  runTransaction: async (_db: unknown, fn: MockTransaction) =>
    fn({
      get: async (ref: MockRef) => mockSnapshot(ref.path),
      set: (ref: MockRef, data: MockData) => mockStore.set(ref.path, { ...data }),
      update: (ref: MockRef, data: MockData) =>
        mockStore.set(ref.path, { ...(mockStore.get(ref.path) ?? {}), ...data }),
    }),
  setDoc: async (ref: MockRef, data: MockData) => {
    mockStore.set(ref.path, { ...(mockStore.get(ref.path) ?? {}), ...data });
  },
  deleteDoc: async (ref: MockRef) => mockStore.delete(ref.path),
  query: (ref: MockRef) => ref,
  orderBy: () => ({}),
}));

jest.mock('firebase/auth', () => new Proxy({}, { get: () => jest.fn() }));
jest.mock('../lib/firebase', () => ({ app: {}, db: {}, auth: {} }));
jest.mock('../lib/auth', () => ({
  ensureAnonymousUser: jest.fn(async () => ({ uid: 'me' })),
}));

// The member stream is the trigger for the whole claim path, so the test drives
// it directly rather than through a second layer of Firestore fake.
let emitMembers: ((members: unknown[]) => void) | null = null;
jest.mock('../lib/session', () => ({
  normalizeCode: (code: string) => code.toUpperCase(),
  subscribe: (_code: string, cb: (members: unknown[]) => void) => {
    emitMembers = cb;
    return () => {
      emitMembers = null;
    };
  },
}));

import { watchForMatch } from '../src/lib/match';
import type { Match, Member, Movie } from '../src/types';

/** Delivers a match-document snapshot to watchForMatch's listener on demand. */
function emitMatchDoc(path: string): void {
  for (const listener of mockListeners.get(path) ?? []) listener(mockSnapshot(path));
}

const CODE = 'ABCD';
const MATCH_PATH = `sessions/${CODE}/match/current`;

function movie(id: number, title: string): Movie {
  return {
    id, title, year: 2026, genreIds: [28], genreNames: [], keywords: [],
    poster: '', providers: [], video: null,
  };
}

/** Everyone liked Alpha and nobody liked Beta, so detectMatch returns Alpha. */
const alpha = movie(1, 'Alpha');
const beta = movie(2, 'Beta');
const catalog = [alpha, beta];
const members: Member[] = [
  { uid: 'a', likes: [1], dislikes: [] },
  { uid: 'b', likes: [1], dislikes: [] },
];

/** Lets the floating `void (async () => …)()` claim chain in watchForMatch settle. */
const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

beforeEach(() => {
  mockStore.clear();
  mockListeners.clear();
  emitMembers = null;
  jest.clearAllMocks();
});

describe('watchForMatch — claim and explain', () => {
  it('explains its own winner when it claims the match uncontested', async () => {
    const onDetect = jest.fn(async (film: Movie) => `A line about ${film.title}.`);
    const stop = watchForMatch(CODE, catalog, () => {}, { onDetect });

    emitMembers!(members);
    await flush();

    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(onDetect.mock.calls[0][0].id).toBe(alpha.id);
    expect(mockStore.get(MATCH_PATH)).toMatchObject({
      tmdbId: alpha.id,
      why: 'A line about Alpha.',
    });
    stop();
  });

  // The regression. Without following the transaction's result this writes a
  // line about Alpha onto a document that names Beta.
  it('explains the adopted title, not its own, when another device claimed first', async () => {
    mockStore.set(MATCH_PATH, {
      tmdbId: beta.id,
      sessionCode: CODE,
      matchedAt: 1,
    });

    const onDetect = jest.fn(async (film: Movie) => `A line about ${film.title}.`);
    const stop = watchForMatch(CODE, catalog, () => {}, { onDetect });

    // The member snapshot lands before the match snapshot — the race.
    emitMembers!(members);
    await flush();

    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(onDetect.mock.calls[0][0].id).toBe(beta.id);

    const stored = mockStore.get(MATCH_PATH);
    expect(stored).toMatchObject({ tmdbId: beta.id, why: 'A line about Beta.' });
    stop();
  });

  it('does not spend a Gemini request when the claimed match already has a why', async () => {
    mockStore.set(MATCH_PATH, {
      tmdbId: beta.id,
      sessionCode: CODE,
      matchedAt: 1,
      why: 'Already explained by the other device.',
    });

    const onDetect = jest.fn(async () => 'A line that would be discarded.');
    const stop = watchForMatch(CODE, catalog, () => {}, { onDetect });

    emitMembers!(members);
    await flush();

    expect(onDetect).not.toHaveBeenCalled();
    expect(mockStore.get(MATCH_PATH)).toMatchObject({
      why: 'Already explained by the other device.',
    });
    stop();
  });

  it('stays quiet when the adopted title is not in this device catalog', async () => {
    mockStore.set(MATCH_PATH, {
      tmdbId: 999,
      sessionCode: CODE,
      matchedAt: 1,
    });

    const onDetect = jest.fn(async (film: Movie) => `A line about ${film.title}.`);
    const stop = watchForMatch(CODE, catalog, () => {}, { onDetect });

    emitMembers!(members);
    await flush();

    expect(onDetect).not.toHaveBeenCalled();
    expect(mockStore.get(MATCH_PATH)).not.toHaveProperty('why');
    stop();
  });

  it('reveals off the document, reporting the adopted title rather than its own', async () => {
    mockStore.set(MATCH_PATH, {
      tmdbId: beta.id,
      sessionCode: CODE,
      matchedAt: 1,
    });

    const seen: (Match | null)[] = [];
    const stop = watchForMatch(CODE, catalog, (match) => seen.push(match), {
      onDetect: async (film: Movie) => `A line about ${film.title}.`,
    });

    emitMembers!(members);
    await flush();
    emitMatchDoc(MATCH_PATH);

    const last = seen.at(-1);
    expect(last).toMatchObject({ tmdbId: beta.id, why: 'A line about Beta.' });
    stop();
  });
});
