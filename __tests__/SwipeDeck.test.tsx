import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { SwipeDeck, type SwipeDeckRef } from '@/components/SwipeDeck';
import { MovieCard } from '@/components/MovieCard';
import { SEED_MOVIES } from '@/data/seedMovies';

// The deck keeps the next card(s) mounted underneath the top card so their
// trailers are buffered before they are shown. These tests pin down that the
// promoted card keeps its component instance (and so its WebView) across a
// swipe.

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockWebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: jest.fn() }));
    return <View {...props} />;
  });
  return { __esModule: true, WebView: MockWebView, default: MockWebView };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: any) => <Text>{name}</Text> };
});

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props: any) => <View {...props} /> };
});

jest.mock('@/components/DynamicHueBackdrop', () => {
  const { View } = require('react-native');
  return { DynamicHueBackdrop: () => <View /> };
});

// `autoSeed` defaults to true, so swiping right on a short deck runs the real
// top-up path. Unmocked, #13's seedCandidates and then #23's rankedCandidates
// both fire; the latter dynamically imports the Firebase model, whose module
// scope throws without EXPO_PUBLIC_FIREBASE_* set. The rejection is swallowed
// inside rankedCandidates, so it never fails a test — it just leaves async work
// running after the test body returns, which is what makes this suite flaky.
// These tests are about card identity across a swipe, not about seeding.
jest.mock('@/src/lib/candidates', () => ({ seedCandidates: jest.fn(async () => []) }));
jest.mock('@/src/lib/gemini', () => ({ rankedCandidates: jest.fn(async () => []) }));

let tree: renderer.ReactTestRenderer | null = null;
afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = null;
});

function cardsByActive(root: renderer.ReactTestInstance) {
  const cards = root.findAllByType(MovieCard);
  return {
    top: cards.filter((c) => c.props.active === true),
    hidden: cards.filter((c) => c.props.active !== true),
  };
}

describe('SwipeDeck next-card preloading', () => {
  it('mounts the top card active and the predicted next card(s) inactive underneath', () => {
    act(() => {
      tree = renderer.create(<SwipeDeck movies={SEED_MOVIES} />);
    });
    const { top, hidden } = cardsByActive(tree!.root);

    expect(top).toHaveLength(1);
    expect(top[0].props.movie.id).toBe(SEED_MOVIES[0].id);
    // One or two candidates (like vs pass may rank a different head), never the top movie.
    expect(hidden.length).toBeGreaterThanOrEqual(1);
    expect(hidden.length).toBeLessThanOrEqual(2);
    for (const card of hidden) expect(card.props.movie.id).not.toBe(SEED_MOVIES[0].id);
  });

  it('keeps the promoted card instance (same WebView source object) across a swipe', () => {
    const ref = React.createRef<SwipeDeckRef>();
    act(() => {
      tree = renderer.create(<SwipeDeck ref={ref} movies={SEED_MOVIES} />);
    });
    const root = tree!.root;

    // Snapshot each hidden card's WebView `source` object identity.
    const before = new Map<number, unknown>();
    for (const card of cardsByActive(root).hidden) {
      before.set(card.props.movie.id, card.findByProps({ testID: 'trailer-webview' }).props.source);
    }

    act(() => {
      ref.current!.swipeRight();
    });
    // The transition hands off after 100ms.
    act(() => {
      jest.advanceTimersByTime(150);
    });

    const { top } = cardsByActive(root);
    expect(top).toHaveLength(1);
    const promotedId = top[0].props.movie.id as number;
    expect(promotedId).not.toBe(SEED_MOVIES[0].id);
    // It was one of the pre-mounted candidates, and it is the same instance.
    expect(before.has(promotedId)).toBe(true);
    expect(top[0].findByProps({ testID: 'trailer-webview' }).props.source).toBe(before.get(promotedId));
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  // exploreRank() picks an off-profile card with probability EPSILON (0.2), and
  // nothing pre-mounts that card — so without pinning the draw to the exploit
  // branch the promotion test below fails about one run in five. The gap is
  // real and logged as break point 1 in docs/ISSUE-24-SOLO-LOOP.md; what this
  // pins is the claim the test is actually making, about the other four runs.
  jest.spyOn(Math, 'random').mockReturnValue(0.99);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
