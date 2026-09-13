// #101: leaving a group has to reach the other phones. Before, Leave only
// cleared this device's active code, so the member doc stayed and everyone
// else kept seeing the person who left — and kept ranking the group with them.
//
// A small in-memory Firestore stands in for the real one: onSnapshot re-fires
// on every write to the collection it watches, which is the realtime behaviour
// the other phone depends on.

type MockRef = { path: string };
type MockData = Record<string, unknown>;
type MockListener = (snap: unknown) => void;
type MockTransaction = (tx: unknown) => Promise<unknown>;

const mockStore = new Map<string, MockData>();
const mockListeners = new Map<string, MockListener[]>();
const MOCK_DELETE = { __delete: true };

function mockApply(path: string, data: MockData, merge: boolean): void {
  const next: MockData = merge ? { ...(mockStore.get(path) ?? {}) } : {};
  for (const [key, value] of Object.entries(data)) {
    if (value === MOCK_DELETE) delete next[key];
    else next[key] = value;
  }
  mockStore.set(path, next);
  const collection = path.split('/').slice(0, -1).join('/');
  for (const listener of mockListeners.get(collection) ?? []) listener(mockQuery(collection));
}

function mockQuery(collection: string) {
  const docs = [...mockStore.entries()]
    .filter(([path]) => path.split('/').slice(0, -1).join('/') === collection)
    .map(([path, data]) => ({ id: path.split('/').pop()!, data: () => data }));
  return { docs };
}

function mockNotFound(): Error {
  return Object.assign(new Error('not found'), { code: 'not-found' });
}

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]): MockRef => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]): MockRef => ({ path: segments.join('/') }),
  onSnapshot: (ref: MockRef, next: MockListener) => {
    mockListeners.set(ref.path, [...(mockListeners.get(ref.path) ?? []), next]);
    next(mockQuery(ref.path));
    return () => mockListeners.set(ref.path, (mockListeners.get(ref.path) ?? []).filter((l) => l !== next));
  },
  getDoc: async (ref: MockRef) => ({ exists: () => mockStore.has(ref.path), data: () => mockStore.get(ref.path) }),
  setDoc: async (ref: MockRef, data: MockData) => mockApply(ref.path, data, false),
  updateDoc: async (ref: MockRef, data: MockData) => {
    if (!mockStore.has(ref.path)) throw mockNotFound();
    mockApply(ref.path, data, true);
  },
  runTransaction: async (_db: unknown, fn: MockTransaction) =>
    fn({
      get: async (ref: MockRef) => ({ exists: () => mockStore.has(ref.path), data: () => mockStore.get(ref.path) }),
      set: (ref: MockRef, data: MockData) => mockApply(ref.path, data, false),
      update: (ref: MockRef, data: MockData) => mockApply(ref.path, data, true),
    }),
  deleteField: () => MOCK_DELETE,
  serverTimestamp: () => 1,
  arrayUnion: (...ids: number[]) => ids,
  arrayRemove: () => [],
}));

let mockUid = 'host';
jest.mock('../lib/firebase', () => ({ db: {} }));
jest.mock('../lib/auth', () => ({ ensureAnonymousUser: jest.fn(async () => ({ uid: mockUid })) }));

import { joinSession, leaveSession, subscribe } from '../lib/session';
import type { Member } from '../src/types';

const CODE = 'BCDF';

beforeEach(() => {
  mockStore.clear();
  mockListeners.clear();
  mockStore.set(`sessions/${CODE}`, { code: CODE, hostUid: 'host' });
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function joinAs(uid: string): Promise<void> {
  mockUid = uid;
  await joinSession(CODE);
}

describe('leaving a group (#101)', () => {
  it('drops the member from everyone else\'s live list', async () => {
    await joinAs('host');
    await joinAs('guest');
    let seenByHost: Member[] = [];
    subscribe(CODE, (members) => {
      seenByHost = members;
    });
    expect(seenByHost.map((m) => m.uid).sort()).toEqual(['guest', 'host']);

    mockUid = 'guest';
    await leaveSession(CODE);

    expect(seenByHost.map((m) => m.uid)).toEqual(['host']);
  });

  it('keeps the swipes, so rejoining brings the member back where they left off', async () => {
    await joinAs('guest');
    mockStore.set(`sessions/${CODE}/members/guest`, {
      ...mockStore.get(`sessions/${CODE}/members/guest`),
      likes: [603],
    });
    let list: Member[] = [];
    subscribe(CODE, (members) => {
      list = members;
    });

    await leaveSession(CODE);
    expect(list).toHaveLength(0);

    await joinSession(CODE);
    expect(list.map((m) => m.uid)).toEqual(['guest']);
    expect(list[0].likes).toEqual([603]);
    expect(mockStore.get(`sessions/${CODE}/members/guest`)).not.toHaveProperty('left');
  });

  it('does not rewrite a member who never left when they rejoin', async () => {
    await joinAs('host');
    const before = mockStore.get(`sessions/${CODE}/members/host`);
    await joinSession(CODE);
    expect(mockStore.get(`sessions/${CODE}/members/host`)).toBe(before);
  });

  it('treats leaving a member doc that is already gone as done', async () => {
    mockUid = 'nobody';
    await expect(leaveSession(CODE)).resolves.toBeUndefined();
  });
});
