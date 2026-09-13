// __tests__/solo-loop.test.tsx — the end-to-end single-player loop (issue #24).
//
// #24 is a checkpoint, not a feature: getDeck() (#15) → the taste vector (#12,
// #18) → SwipeDeck (#6) → MovieCard/TrailerVideoPlayer (#7), driven from the
// real Swipe screen, with the Wi-Fi on and with it off. Its acceptance
// criterion is a manual pass on a physical device, and that pass is still
// required — simulators and Jest both lie about autoplay, the silent switch
// and 60fps gestures (AGENTS.md §6).
//
// What this file *can* hold down is the part that keeps breaking silently
// between branches: that the screen mounts the deck at all, that the deck it
// mounts came from the layer it is supposed to have come from, that a swipe
// visibly re-ranks what is underneath it, and that none of it stalls or shows
// an error when the network is gone. Those are the four ways the solo loop has
// failed so far, and none of them need hardware to catch.
//
// Deliberately NOT covered here (needs a device):
//   - the trailer actually autoplaying, muted, inside the WebView shell
//   - gesture smoothness, and the drag thresholds in SwipeDeck's pan handler
//   - the iPhone silent switch vs. tap-to-unmute
//
// The whole app below the screen is real: lib/tmdb's mapper, lib/seed.json,
// src/lib/taste, src/lib/explore and components/SwipeDeck all run unmocked.
// Only the four things Jest has no version of are stubbed — the network, the
// WebView, Firebase, and the native gradient/icon shims.

import React from 'react';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator } from 'react-native';

// ---------------------------------------------------------------------------
// Stubs. `mock`-prefixed names so jest's factory hoisting allows the reference.
// ---------------------------------------------------------------------------

jest.mock('react-native-webview', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  const MockWebView = ReactLib.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    ReactLib.useImperativeHandle(ref, () => ({ injectJavaScript: jest.fn() }));
    return <View {...props} />;
  });
  return { __esModule: true, WebView: MockWebView, default: MockWebView };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props: Record<string, unknown>) => <View {...props} /> };
});

jest.mock('@/components/DynamicHueBackdrop', () => {
  const { View } = require('react-native');
  return { DynamicHueBackdrop: () => <View /> };
});

/**
 * Firestore, hand-rolled: the SDK ships ESM jest-expo does not transform, and
 * lib/firebase initializes an app from env vars Jest never loads. `getDoc` and
 * `setDoc` are swapped per test — offline they are promises that never settle,
 * which is exactly how the real SDK behaves with no connection, and is the
 * thing #18's timeouts exist to survive.
 */
let mockGetDoc: () => Promise<unknown> = () => Promise.resolve({ exists: () => false, data: () => ({}) });
let mockSetDoc: () => Promise<void> = () => Promise.resolve();

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: () => mockGetDoc(),
  setDoc: () => mockSetDoc(),
  deleteDoc: () => mockSetDoc(),
  getDocs: async () => ({ docs: [] }),
  query: (ref: unknown) => ref,
  orderBy: jest.fn(),
  onSnapshot: jest.fn(() => () => {}),
  arrayUnion: jest.fn(),
  arrayRemove: jest.fn(),
  serverTimestamp: jest.fn(),
  runTransaction: jest.fn(),
  updateDoc: jest.fn(),
  getFirestore: jest.fn(),
}));
jest.mock('firebase/auth', () => new Proxy({}, { get: () => jest.fn() }));
jest.mock('@/lib/firebase', () => ({ app: {}, db: {}, auth: {} }));

/** Sign-in state the screen sees. The offline case sets isSigningIn forever. */
let mockAuth: { uid: string | null; isSigningIn: boolean; error: Error | null } = {
  uid: 'solo-uid',
  isSigningIn: false,
  error: null,
};
jest.mock('@/lib/auth', () => ({
  useAnonymousAuth: () => mockAuth,
  ensureAnonymousUser: jest.fn(),
}));

/** Solo, by definition: #24 is the single-player loop, so no group code. */
jest.mock('@/lib/active-session', () => ({
  useActiveCode: () => ({ code: null, ready: true }),
  getActiveCode: () => null,
  subscribeActiveCode: () => () => {},
  hydrateActiveCode: () => Promise.resolve(null),
}));

// ---------------------------------------------------------------------------
// TMDB fixtures
// ---------------------------------------------------------------------------

const ACTION = { id: 28, name: 'Action' };
const DRAMA = { id: 18, name: 'Drama' };

/**
 * Ids sit above the seed catalog's range on purpose: a fixture that collided
 * with lib/seed.json would inherit its pre-validated video key and its
 * keywords, and the ranking assertions below would stop meaning anything.
 *
 * Enough of them (22 > MIN_DECK) that getDeck() does not pad the deck from
 * seed — this test is about the live path, and a padded deck would mix the two.
 */
const FIRST_ID = 900001;
const DECK_IDS = Array.from({ length: 22 }, (_, i) => FIRST_ID + i);
const PAGE_SIZE = 11;

/**
 * One action title first, then ten dramas, then eleven more action titles.
 * Cold start ranks on a zero vector, so ties keep this order and the first
 * card is 900001; one right swipe on it should pull the *action* block to the
 * front, past ten dramas that would otherwise have come next. That gap is what
 * makes "the deck re-ranked" observable rather than a coin flip.
 */
function genreFor(id: number) {
  return id === FIRST_ID || id >= FIRST_ID + PAGE_SIZE ? ACTION : DRAMA;
}

/** The first card after one right swipe, if and only if the deck re-ranks. */
const RERANKED_TOP_ID = FIRST_ID + PAGE_SIZE;
/** The card that would be next if it did not. */
const UNRANKED_TOP_ID = FIRST_ID + 1;

/**
 * Swipes that take the unseen tail below SwipeDeck's LOW_WATER (5), which is
 * what makes #13's top-up fire. Anything shorter never calls fetch() again
 * after the deck has landed, so a test that only swipes a handful of cards
 * would report on a dead network without ever touching one. Four short of the
 * end, so the deck still has cards left when the assertions run.
 */
const SWIPES_PAST_LOW_WATER = DECK_IDS.length - 4;

/**
 * A /movie/{id} payload with exactly one feature (`genre:N`) — no keywords, no
 * cast. score() averages over a movie's features, so a single-feature title
 * scores the full weight of that genre and the ranking has one variable in it.
 */
function detail(id: number) {
  return {
    id,
    title: `Movie ${id}`,
    release_date: '2026-01-01',
    poster_path: `/${id}.jpg`,
    overview: `Overview ${id}`,
    genres: [genreFor(id)],
    videos: { results: [{ key: `key${id}`, site: 'YouTube', type: 'Clip', official: true }] },
    keywords: { keywords: [] },
    credits: { cast: [] },
  };
}

function json(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

/** TMDB, answering. */
function onlineFetch(url: string) {
  if (url.includes('/discover/movie')) {
    const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? '1');
    const ids = DECK_IDS.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return json({ results: ids.map((id) => ({ id })) });
  }
  const id = Number(/\/movie\/(\d+)/.exec(url)?.[1] ?? '0');
  return json(detail(id));
}

/** The Wi-Fi is off. This is what RN's fetch does — reject, not resolve non-2xx. */
function offlineFetch() {
  return Promise.reject(new Error('Network request failed'));
}

function setFetch(fn: (url: string) => Promise<unknown>): void {
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(fn);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Everything below the screen is imported once, from one module registry.
 *
 * Not `jest.resetModules()` per test, tempting as it looks: lib/tmdb keeps its
 * hydrated-movie cache in module scope and it would be nice to drop it between
 * tests, but resetting the registry hands the screen a second copy of React
 * while react-test-renderer still holds the first, and every hook in the tree
 * throws. The cache is harmless here anyway — the online tests share one set of
 * fixtures, and the offline ones never reach hydration, because /discover fails
 * first and getDeck() falls straight through to seed.
 *
 * The same reasoning rules out asserting lib/tmdb's isOffline(): it compares
 * two module-scope timestamps taken from Date.now(), which fake timers move
 * around per test. Where the deck actually came from is the better question
 * and this file can answer it directly — the fixture ids above and the seed
 * catalog's are disjoint sets.
 */
import { seedMoviesWithVideo } from '@/lib/seed';

const SEED_IDS = new Set(seedMoviesWithVideo.map((movie) => movie.id));

// lib/tmdb reads the token into a module constant at import time, and an
// `import` would be hoisted above this line — so the screen is pulled in by
// require(), after the environment it reads has been set up. Without a token
// every call short-circuits to the seed catalog and the "online" tests below
// would quietly be testing the offline path.
process.env.EXPO_PUBLIC_TMDB_READ_TOKEN = 'test-token';
const SwipeScreen = require('@/app/(tabs)/swipe').default as React.ComponentType;
const { MovieCard } = require('@/components/MovieCard') as {
  MovieCard: React.ComponentType;
};

let tree: ReactTestRenderer | null = null;

/** Advance timers and drain the promise chain the screen is waiting on. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    // getDeck() hydrates through a bounded pool, so the deck lands several
    // microtask turns deep. Drain generously rather than guessing the depth.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

function cards(): ReactTestInstance[] {
  return tree!.root.findAllByType(MovieCard as never);
}

/** The card on top of the stack. SwipeDeck keeps the next one(s) mounted under it. */
function topCard(): ReactTestInstance {
  const active = cards().filter((card) => card.props.active === true);
  expect(active).toHaveLength(1);
  return active[0];
}

function topMovieId(): number {
  return topCard().props.movie.id as number;
}

/** Like / Pass, pressed the way a user presses them. */
async function press(label: 'Like' | 'Pass'): Promise<void> {
  const button = tree!.root
    .findAllByProps({ accessibilityLabel: label })
    .find((node) => typeof node.props.onPress === 'function');
  expect(button).toBeDefined();

  await act(async () => {
    button!.props.onPress();
  });
  // The throw animation, then SwipeDeck's 100ms hue handoff.
  await settle(500);
}

/**
 * Every string actually rendered into a <Text>, joined.
 *
 * Not JSON.stringify(tree.toJSON()): that sweeps up the WebView's injected
 * player shell, whose YouTube API glue mentions `onError` — which is markup,
 * not something a judge can see.
 */
function visibleText(): string {
  return tree!.root
    .findAllByType('Text' as never)
    .flatMap((node) => React.Children.toArray(node.props.children))
    .filter((child): child is string => typeof child === 'string')
    .join(' | ');
}

beforeEach(() => {
  jest.useFakeTimers();
  // exploreRank() serves one card in five off-profile on purpose (EPSILON).
  // Pinned to the exploit branch here so "did the deck re-rank" has one answer
  // instead of a 20% chance of a random one — the same knob #28 sets to 0
  // before recording the demo.
  jest.spyOn(Math, 'random').mockReturnValue(0.99);
  mockAuth = { uid: 'solo-uid', isSigningIn: false, error: null };
  mockGetDoc = () => Promise.resolve({ exists: () => false, data: () => ({}) });
  mockSetDoc = () => Promise.resolve();
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Online
// ---------------------------------------------------------------------------

describe('the solo loop, online', () => {
  it('fills the deck from TMDB and puts a playable card on top', async () => {
    setFetch(onlineFetch);

    act(() => {
      tree = renderer.create(<SwipeScreen />);
    });
    // Nothing is ranked against a half-loaded vector: the deck is gated behind
    // both the catalog and the stored taste (#18).
    expect(tree!.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(cards()).toHaveLength(0);

    await settle();

    const top = topCard();
    expect(top.props.movie.id).toBe(FIRST_ID);
    // Clip-first: a card with no video is a static poster, and getDeck() is
    // supposed to have dropped those before the screen ever sees them.
    expect(top.props.movie.video?.key).toBe(`key${FIRST_ID}`);
    // Live TMDB, not the seed fallback dressed up as it — the two id ranges
    // are disjoint, so this is the whole question of "which path ran".
    expect(SEED_IDS.has(top.props.movie.id as number)).toBe(false);
    expect(DECK_IDS).toContain(top.props.movie.id);
    // The next card is already mounted underneath, buffering its trailer (#7).
    expect(cards().length).toBeGreaterThan(1);
  });

  it('re-ranks the rest of the deck after a swipe', async () => {
    setFetch(onlineFetch);

    act(() => {
      tree = renderer.create(<SwipeScreen />);
    });
    await settle();
    expect(topMovieId()).toBe(FIRST_ID);

    await press('Like');

    // Liking an action title pulled the action block past ten dramas that were
    // physically next in the deck. This is the demo beat in step 2.
    expect(topMovieId()).toBe(RERANKED_TOP_ID);
    expect(topMovieId()).not.toBe(UNRANKED_TOP_ID);
  });

  it('keeps advancing when the Wi-Fi dies mid-deck, without a restart', async () => {
    setFetch(onlineFetch);

    act(() => {
      tree = renderer.create(<SwipeScreen />);
    });
    await settle();
    const before = topMovieId();

    // The venue Wi-Fi goes down between one card and the next. Nothing
    // re-mounts; the deck in memory is all the app has left. Counted, because
    // the deck only reaches for the network again once it runs low — without
    // that the "offline" half of this test would never be exercised at all.
    let callsAfterTheCut = 0;
    setFetch(() => {
      callsAfterTheCut += 1;
      return offlineFetch();
    });
    mockSetDoc = () => new Promise<void>(() => {});

    const seen: number[] = [before];
    for (let i = 0; i < SWIPES_PAST_LOW_WATER; i += 1) {
      await press(i % 2 === 0 ? 'Like' : 'Pass');
      seen.push(topMovieId());
    }

    // A new card every time, no stall — even though #13's top-up went out over
    // a dead network and came back with nothing, and every Firestore write
    // from those swipes is still sitting unacknowledged.
    expect(new Set(seen).size).toBe(seen.length);
    expect(callsAfterTheCut).toBeGreaterThan(0);
    expect(tree!.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    // Positive control first: a visibleText() that silently stopped collecting
    // would make the negative assertion below pass without meaning anything.
    expect(visibleText()).toContain(topCard().props.movie.title);
    expect(visibleText()).not.toMatch(/DECK COMPLETED/);
    // Crossing LOW_WATER takes SWIPES_PAST_LOW_WATER presses, and each one
    // mounts a card and drains the promise chain behind it. That lands close
    // enough to jest's 5s default to time out under a parallel full-suite run
    // — which reads as a flaky test rather than as the slow one it is.
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Offline — PLAN.md §L's highest likelihood, highest impact risk
// ---------------------------------------------------------------------------

describe('the solo loop, with the Wi-Fi off', () => {
  it('falls back to the seed catalog and still shows a playable deck', async () => {
    setFetch(offlineFetch);
    // Firestore with no connection: the read never settles, the write never
    // acknowledges. Neither may hold up the deck.
    mockGetDoc = () => new Promise(() => {});
    mockSetDoc = () => new Promise<void>(() => {});

    act(() => {
      tree = renderer.create(<SwipeScreen />);
    });
    await settle();

    // Still gated: the taste read is out there with nothing to answer it.
    expect(cards()).toHaveLength(0);

    // #18's LOAD_TIMEOUT_MS gives up and starts the deck cold.
    await settle(1600);

    const top = topCard();
    // The seed catalog, and every one of its titles has a validated key —
    // getDeck() fell back rather than handing the screen an empty deck.
    expect(SEED_IDS.has(top.props.movie.id as number)).toBe(true);
    expect(top.props.movie.video?.key).toBeTruthy();
    for (const card of cards()) expect(card.props.movie.video?.key).toBeTruthy();

    // Whatever the user is looking at, it is a movie. The app has no error
    // state to render by design (#15 returns data or falls back, never
    // throws), so the two ways this screen can fail visibly are a spinner
    // that never resolves and an empty deck — check for both.
    expect(tree!.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(visibleText()).toContain(top.props.movie.title);
    expect(visibleText()).not.toMatch(/DECK COMPLETED/);
  });

  it('still re-ranks on a swipe that nothing can be persisted from', async () => {
    setFetch(offlineFetch);
    mockGetDoc = () => new Promise(() => {});
    mockSetDoc = () => new Promise<void>(() => {});

    act(() => {
      tree = renderer.create(<SwipeScreen />);
    });
    await settle(1600);

    const first = topCard().props.movie;
    await press('Like');
    const second = topCard().props.movie;

    expect(second.id).not.toBe(first.id);
    // The offline deck ranks on the same vector the online one does: the card
    // promoted after liking `first` shares a genre with it.
    const shared = second.genreIds.filter((id: number) => first.genreIds.includes(id));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('starts the deck cold rather than waiting forever on sign-in', async () => {
    // The venue Wi-Fi that accepts a connection and then swallows it:
    // signInAnonymously() never settles, so there is no uid and never will be.
    setFetch(offlineFetch);
    mockAuth = { uid: null, isSigningIn: true, error: null };
    mockGetDoc = () => new Promise(() => {});

    act(() => {
      tree = renderer.create(<SwipeScreen />);
    });
    await settle();
    expect(cards()).toHaveLength(0);

    await settle(1600);

    // A cold deck is a working deck. A spinner is not.
    expect(cards().length).toBeGreaterThan(0);
    expect(topCard().props.movie.video?.key).toBeTruthy();
  });
});
