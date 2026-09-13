import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { SwipeDeck, type SwipeDeckRef } from '@/components/SwipeDeck';
import { MovieCard } from '@/components/MovieCard';
import { SEED_MOVIES } from '@/data/seedMovies';

// The deck keeps the next card(s) mounted underneath the top card so their
// trailers are buffered before they are shown. These tests pin down that the
// promoted card keeps its component instance (and so its WebView) across a
// swipe.
//
// Both sources of nondeterminism are pinned down here, or the assertions fail
// intermittently:
//   - Math.random is stubbed above EPSILON so exploreRank() takes its greedy
//     branch (#14). Left live, roughly one run in eight promotes a random card
//     that was deliberately never pre-mounted.
//   - autoSeed={false}: SEED_MOVIES is 6 long and LOW_WATER is 10, so the first
//     swipe would otherwise fire the TMDB top-up (#13), which resolves on its
//     own schedule and appends to the deck mid-assertion.

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

// No pin active in these tests — getGenrePin() resolving to null makes
// handleSwipeComplete fall through to exploreRank exactly as before this
// module existed, which is what the identity-across-a-swipe assertions below
// depend on. Mocked rather than pulling in the real AsyncStorage-backed
// module, which needs its native module mocked separately (see solo-loop.test.tsx).
jest.mock('@/src/lib/genre-pin', () => ({
  GENRE_PIN_LIMIT: 6,
  getGenrePin: jest.fn(async () => null),
  setGenrePin: jest.fn(async () => {}),
  pinnedRank: jest.fn((_pin: unknown, _v: unknown, deck: unknown[]) => deck),
  countsTowardPin: jest.fn(() => false),
}));

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
      tree = renderer.create(<SwipeDeck movies={SEED_MOVIES} autoSeed={false} />);
    });
    const { top, hidden } = cardsByActive(tree!.root);

    expect(top).toHaveLength(1);
    expect(top[0].props.movie.id).toBe(SEED_MOVIES[0].id);
    // One or two candidates (like vs pass may rank a different head), never the top movie.
    expect(hidden.length).toBeGreaterThanOrEqual(1);
    expect(hidden.length).toBeLessThanOrEqual(2);
    for (const card of hidden) expect(card.props.movie.id).not.toBe(SEED_MOVIES[0].id);
  });

  it('passes the screen\'s why-slot decision down to every card', () => {
    act(() => {
      tree = renderer.create(<SwipeDeck movies={SEED_MOVIES} autoSeed={false} />);
    });
    for (const card of tree!.root.findAllByType(MovieCard)) {
      expect(card.props.expectWhyLine).toBe(false);
    }

    act(() => {
      tree!.update(<SwipeDeck movies={SEED_MOVIES} autoSeed={false} expectWhyLine />);
    });
    for (const card of tree!.root.findAllByType(MovieCard)) {
      expect(card.props.expectWhyLine).toBe(true);
    }
  });

  it('announces the card on screen plus the pre-mounted ones, and again after a swipe', () => {
    const onUpcoming = jest.fn<void, [typeof SEED_MOVIES]>();
    const ref = React.createRef<SwipeDeckRef>();
    act(() => {
      tree = renderer.create(
        <SwipeDeck ref={ref} movies={SEED_MOVIES} autoSeed={false} onUpcoming={onUpcoming} />
      );
    });

    // The top card first, then whatever is warming behind it — never the whole
    // deck: #20 runs on 15 requests a minute.
    expect(onUpcoming).toHaveBeenCalledTimes(1);
    const first = onUpcoming.mock.calls[0][0];
    expect(first[0].id).toBe(SEED_MOVIES[0].id);
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first.length).toBeLessThanOrEqual(3);
    expect(new Set(first.map((m) => m.id)).size).toBe(first.length);

    act(() => {
      ref.current!.swipeRight();
    });
    act(() => {
      jest.advanceTimersByTime(150);
    });

    // The promoted card is now the one worth spending a request on.
    const latest = onUpcoming.mock.calls[onUpcoming.mock.calls.length - 1][0];
    expect(latest[0].id).not.toBe(SEED_MOVIES[0].id);
  });

  it('keeps the promoted card instance (same WebView source object) across a swipe', () => {
    const ref = React.createRef<SwipeDeckRef>();
    act(() => {
      tree = renderer.create(<SwipeDeck ref={ref} movies={SEED_MOVIES} autoSeed={false} />);
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

describe('SwipeDeck watch later button', () => {
  /** The dock button, pressed the way a user presses it. */
  function watchLaterButton(root: renderer.ReactTestInstance) {
    return root
      .findAllByProps({ accessibilityLabel: 'Watch later' })
      .find((node) => typeof node.props.onPress === 'function');
  }

  it('saves the card on screen and throws it right, so it is a save and a like', () => {
    const onWatchLater = jest.fn();
    const onSwipeRight = jest.fn();
    act(() => {
      tree = renderer.create(
        <SwipeDeck
          movies={SEED_MOVIES}
          autoSeed={false}
          onWatchLater={onWatchLater}
          onSwipeRight={onSwipeRight}
        />
      );
    });

    act(() => {
      watchLaterButton(tree!.root)!.props.onPress();
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onWatchLater).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
    // The same object, not merely the same id: the screen writes the watchlist
    // row from one and the like row from the other, and they must agree.
    expect(onWatchLater.mock.calls[0][0]).toBe(onSwipeRight.mock.calls[0][1]);
    expect(onWatchLater.mock.calls[0][0].id).toBe(SEED_MOVIES[0].id);

    // And the deck actually moved on.
    expect(cardsByActive(tree!.root).top[0].props.movie.id).not.toBe(SEED_MOVIES[0].id);
  });

  it('saves once when the button is hit twice inside one frame', () => {
    const onWatchLater = jest.fn();
    const onSwipeRight = jest.fn();
    act(() => {
      tree = renderer.create(
        <SwipeDeck
          movies={SEED_MOVIES}
          autoSeed={false}
          onWatchLater={onWatchLater}
          onSwipeRight={onSwipeRight}
        />
      );
    });

    // Both presses in one act(): a re-render between them would hand the second
    // one a fresh isAnimating shared value under Reanimated's Jest mock, and
    // the guard being tested here would never be the one that fires.
    act(() => {
      const button = watchLaterButton(tree!.root)!;
      button.props.onPress();
      button.props.onPress();
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onWatchLater).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('goes away with the action buttons once the deck is done', () => {
    const ref = React.createRef<SwipeDeckRef>();
    act(() => {
      tree = renderer.create(<SwipeDeck ref={ref} movies={[SEED_MOVIES[0]]} autoSeed={false} />);
    });
    expect(watchLaterButton(tree!.root)).toBeDefined();

    act(() => {
      ref.current!.swipeRight();
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // triggerProgrammaticSwipe() bails while isDone, so leaving it up would be
    // dead chrome next to "DECK COMPLETED".
    expect(watchLaterButton(tree!.root)).toBeUndefined();
  });
});

describe('SwipeDeck unplayable cards', () => {
  it('drops a pre-mounted card whose trailer cannot be embedded', () => {
    act(() => {
      tree = renderer.create(<SwipeDeck movies={SEED_MOVIES} autoSeed={false} />);
    });

    const doomed = cardsByActive(tree!.root).hidden[0];
    const doomedId = doomed.props.movie.id as number;

    act(() => {
      doomed.props.onCardFailed(doomed.props.movie);
    });

    // Gone from the deck entirely, not merely shown as a poster: the counter
    // is rendered from deck.length, so a title left in it would still be
    // promoted on the next swipe.
    const ids = tree!.root.findAllByType(MovieCard).map((c) => c.props.movie.id);
    expect(ids).not.toContain(doomedId);
  });

  it('keeps the card on screen, which has its own poster fallback', () => {
    act(() => {
      tree = renderer.create(<SwipeDeck movies={SEED_MOVIES} autoSeed={false} />);
    });

    const top = cardsByActive(tree!.root).top[0];
    act(() => {
      top.props.onCardFailed(top.props.movie);
    });

    // Removing it would swap the card out from under a finger that may already
    // be dragging it.
    expect(cardsByActive(tree!.root).top[0].props.movie.id).toBe(SEED_MOVIES[0].id);
  });
});

describe('SwipeDeck off screen (#100)', () => {
  it('stops the top trailer while paused and plays it again on return, same card', () => {
    act(() => {
      tree = renderer.create(<SwipeDeck movies={SEED_MOVIES} autoSeed={false} />);
    });
    const topId = () => tree!.root.findAllByType(MovieCard).find((c) => c.props.active)?.props.movie.id;
    const cardFor = (id: number) => tree!.root.findAllByType(MovieCard).find((c) => c.props.movie.id === id)!;
    const first = topId();
    expect(first).toBeDefined();
    const player = () => cardFor(first).findByProps({ testID: 'trailer-webview' }).props.source;
    const source = player();

    // Off to the Group tab: nothing plays, the top card is still the top card.
    act(() => {
      tree!.update(<SwipeDeck movies={SEED_MOVIES} autoSeed={false} paused />);
    });
    expect(tree!.root.findAllByType(MovieCard).some((c) => c.props.active)).toBe(false);
    expect(cardFor(first).props.movie.id).toBe(first);

    // Back on Swipe: the same card plays again, without remounting its player.
    act(() => {
      tree!.update(<SwipeDeck movies={SEED_MOVIES} autoSeed={false} paused={false} />);
    });
    expect(topId()).toBe(first);
    expect(player()).toBe(source);
  });
});

describe('SwipeDeck session order (#96)', () => {
  /** The deck order a fresh mount deals, with `random` behind makeJitter(). */
  function dealtOrder(random: () => number): number[] {
    jest.spyOn(Math, 'random').mockImplementation(random);
    const onUpcoming = jest.fn<void, [typeof SEED_MOVIES]>();
    act(() => {
      tree = renderer.create(<SwipeDeck movies={SEED_MOVIES} autoSeed={false} onUpcoming={onUpcoming} />);
    });
    const top = cardsByActive(tree!.root).top[0].props.movie.id as number;
    act(() => tree!.unmount());
    tree = null;
    return [top];
  }

  it('does not open on the same card every session', () => {
    const tops = new Set<number>();
    for (let seed = 1; seed <= 12; seed += 1) {
      let state = seed;
      tops.add(dealtOrder(() => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296))[0]);
    }
    expect(tops.size).toBeGreaterThan(1);
  });
});

describe('SwipeDeck deck cap (#97)', () => {
  const { seedCandidates } = jest.requireMock('@/src/lib/candidates') as {
    seedCandidates: jest.Mock;
  };
  const extra = Array.from({ length: 10 }, (_, i) => ({
    ...SEED_MOVIES[0],
    id: 800000 + i,
    title: `Extra ${i}`,
  }));

  /** Like every card until the deck reports it is done; returns how many were swiped. */
  async function swipeToEnd(ref: React.RefObject<SwipeDeckRef | null>, onSwipedAll: jest.Mock) {
    let swipes = 0;
    while (!onSwipedAll.mock.calls.length && swipes < 50) {
      await act(async () => {
        ref.current!.swipeRight();
        jest.advanceTimersByTime(150);
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
      });
      swipes += 1;
    }
    return swipes;
  }

  it('tops the deck up but never past maxCards', async () => {
    seedCandidates.mockResolvedValue(extra);
    const ref = React.createRef<SwipeDeckRef>();
    const onSwipedAll = jest.fn();
    act(() => {
      tree = renderer.create(
        <SwipeDeck ref={ref} movies={SEED_MOVIES} maxCards={9} onSwipedAll={onSwipedAll} />
      );
    });

    // 6 dealt + top-ups, trimmed to 9 in total.
    expect(await swipeToEnd(ref, onSwipedAll)).toBe(9);
    expect(seedCandidates).toHaveBeenCalled();
    seedCandidates.mockReset();
    seedCandidates.mockImplementation(async () => []);
  });

  it('waits on a top-up that lands after the last card, then shows the new cards', async () => {
    let land!: (movies: typeof extra) => void;
    seedCandidates.mockImplementationOnce(() => new Promise((resolve) => { land = resolve; }));
    const ref = React.createRef<SwipeDeckRef>();
    const onSwipedAll = jest.fn();
    act(() => {
      tree = renderer.create(
        <SwipeDeck ref={ref} movies={SEED_MOVIES} maxCards={30} onSwipedAll={onSwipedAll} />
      );
    });
    const text = () =>
      tree!.root.findAll((n) => typeof n.props.children === 'string').map((n) => n.props.children);

    // Swipe the whole deck faster than the top-up answers.
    expect(await swipeToEnd(ref, onSwipedAll)).toBe(SEED_MOVIES.length);
    expect(text()).toContain('Finding more movies for you…');
    expect(text()).not.toContain('DECK COMPLETED');

    await act(async () => {
      land(extra);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    const top = cardsByActive(tree!.root).top;
    expect(top).toHaveLength(1);
    expect(top[0].props.movie.id).toBeGreaterThanOrEqual(800000);
    seedCandidates.mockImplementation(async () => []);
  });

  it('never tops up with movies swiped in earlier sessions', async () => {
    seedCandidates.mockClear();
    const ref = React.createRef<SwipeDeckRef>();
    const seen = () => [111, 222];
    act(() => {
      tree = renderer.create(<SwipeDeck ref={ref} movies={SEED_MOVIES} seenIds={seen} />);
    });
    await act(async () => {
      ref.current!.swipeRight();
      jest.advanceTimersByTime(150);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(seedCandidates).toHaveBeenCalled();
    const [, , opts] = seedCandidates.mock.calls[0];
    expect(opts.swiped).toEqual(expect.arrayContaining([111, 222]));
  });

  it('does not ask for more once the deck already holds maxCards', async () => {
    seedCandidates.mockClear();
    const ref = React.createRef<SwipeDeckRef>();
    const onSwipedAll = jest.fn();
    act(() => {
      tree = renderer.create(
        <SwipeDeck ref={ref} movies={SEED_MOVIES} maxCards={SEED_MOVIES.length} onSwipedAll={onSwipedAll} />
      );
    });

    expect(await swipeToEnd(ref, onSwipedAll)).toBe(SEED_MOVIES.length);
    expect(seedCandidates).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  // >= EPSILON: exploreRank() promotes the top-ranked card rather than exploring.
  jest.spyOn(Math, 'random').mockReturnValue(0.99);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
