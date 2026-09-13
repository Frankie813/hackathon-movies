import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import { useWhyLines, type WhyLines } from '@/lib/use-why-lines';
import type { Movie } from '@/types';

// lib/gemini.ts initialises Firebase AI at import time, and its own behaviour is
// covered by why-line.test.ts. What matters here is the glue: the subscription,
// what whyFor reads, and when the slot is reserved.
const mockNotify: Array<(tmdbId: number, line: string) => void> = [];
const mockWhyLine = jest.fn<Promise<string | null>, [Movie, Movie[]]>(async () => null);
const mockDiskCache = new Map<number, string>();

jest.mock('@/lib/gemini', () => ({
  whyLine: (candidate: Movie, likes: Movie[]) => mockWhyLine(candidate, likes),
  cachedWhyLine: (tmdbId: number) => mockDiskCache.get(tmdbId),
  subscribeWhyLines: (listener: (tmdbId: number, line: string) => void) => {
    mockNotify.push(listener);
    return () => {
      const at = mockNotify.indexOf(listener);
      if (at >= 0) mockNotify.splice(at, 1);
    };
  },
}));

const movie = (id: number, title: string): Movie => ({
  id,
  title,
  year: 2001,
  genreIds: [28],
  genreNames: ['Action'],
  keywords: [],
  poster: '',
  providers: [],
  video: null,
});

/** Publish a line the way lib/gemini does when a request lands. */
function deliver(tmdbId: number, line: string) {
  act(() => {
    for (const listener of [...mockNotify]) listener(tmdbId, line);
  });
}

let tree: renderer.ReactTestRenderer | null = null;
let hook: WhyLines;

function Probe() {
  hook = useWhyLines();
  return <Text>{String(hook.expectWhyLine)}</Text>;
}

beforeEach(() => {
  mockNotify.length = 0;
  mockDiskCache.clear();
  mockWhyLine.mockClear();
  act(() => {
    tree = renderer.create(<Probe />);
  });
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = null;
});

describe('useWhyLines (Issue #20)', () => {
  it('renders the line on the card that is already on screen', () => {
    expect(hook.whyFor(movie(1, 'Heat'))).toBeUndefined();

    deliver(1, 'A heist with manners.');

    expect(hook.whyFor(movie(1, 'Heat'))).toBe('A heist with manners.');
  });

  it('reads through to the module cache for a line delivered before mount', () => {
    // A line cached on disk from an earlier run, restored without a new event.
    mockDiskCache.set(7, 'Cached from last night.');
    expect(hook.whyFor(movie(7, 'Ronin'))).toBe('Cached from last night.');
  });

  it('holds the slot open only once Gemini has actually answered', () => {
    // Offline or over quota, no line ever lands and no card reserves a gap.
    expect(hook.expectWhyLine).toBe(false);

    deliver(1, 'A heist with manners.');

    expect(hook.expectWhyLine).toBe(true);
  });

  it('warms exactly the cards it is handed, with the likes so far', () => {
    const upcoming = [movie(1, 'Heat'), movie(2, 'Ronin'), movie(3, 'Se7en')];
    const likes = [movie(9, 'Inception')];

    act(() => {
      hook.prefetch(upcoming, likes);
    });

    expect(mockWhyLine).toHaveBeenCalledTimes(3);
    expect(mockWhyLine.mock.calls.map(([candidate]) => candidate.id)).toEqual([1, 2, 3]);
    for (const [, passedLikes] of mockWhyLine.mock.calls) {
      expect(passedLikes).toEqual(likes);
    }
  });

  it('survives a line arriving after the screen is gone', () => {
    act(() => {
      tree?.unmount();
    });
    tree = null;

    // Unsubscribed, so this is a no-op rather than a setState on a dead tree.
    expect(() => deliver(1, 'Too late.')).not.toThrow();
    expect(mockNotify).toHaveLength(0);
  });
});
