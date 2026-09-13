// The reveal's handling of a why line that never arrives (#10 + #21).
//
// The line is patched onto the match document later, by whichever device
// claimed the match (#17). A device that is not that one cannot tell "still
// coming" from "never coming", so the screen has to decide on a timer — and
// what it shows when it gives up is the last thing judges read.

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import renderer, { act, type ReactTestInstance } from 'react-test-renderer';

import { MatchReveal } from '@/components/MatchReveal';
import type { Match, Movie } from '@/types';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props: any) => <View {...props} /> };
});

const movie: Movie = {
  id: 496243,
  title: 'Parasite',
  year: 2019,
  genreIds: [35, 53, 18],
  genreNames: ['Comedy', 'Thriller', 'Drama'],
  keywords: ['class'],
  poster: 'https://image.tmdb.org/t/p/w780/poster.jpg',
  providers: ['Max', 'Hulu', 'Netflix', 'Prime Video'],
  video: null,
};

function match(why?: string): Match {
  return { tmdbId: movie.id, sessionCode: 'ABCD', matchedAt: 1, ...(why ? { why } : {}) };
}

let tree: renderer.ReactTestRenderer | null = null;
let onDismiss = jest.fn();
let onKeepSwiping = jest.fn();

beforeEach(() => {
  onDismiss = jest.fn();
  onKeepSwiping = jest.fn();
});

/** Reanimated's entrance effects run on mount, so creation has to be in act(). */
function render(why?: string, clearing = false) {
  act(() => {
    tree = renderer.create(
      <MatchReveal
        match={match(why)}
        movie={movie}
        onDismiss={onDismiss}
        onKeepSwiping={onKeepSwiping}
        clearing={clearing}
      />,
    );
  });
}

function rerender(why?: string) {
  act(() => {
    tree!.update(
      <MatchReveal
        match={match(why)}
        movie={movie}
        onDismiss={onDismiss}
        onKeepSwiping={onKeepSwiping}
      />,
    );
  });
}

/** The reveal's footer button whose label reads `label`. */
function button(label: string) {
  return tree!.root
    .findAll((node) => node.props.accessibilityRole === 'button')
    .find((node) => texts(node).includes(label));
}

function advance(ms: number) {
  act(() => { jest.advanceTimersByTime(ms); });
}

/** Every string rendered anywhere in `root`, or in the whole tree by default. */
function texts(root?: ReactTestInstance): string[] {
  return (root ?? tree!.root)
    .findAllByType(Text)
    .flatMap((node) => node.props.children)
    .filter((child: unknown): child is string => typeof child === 'string');
}

const PLACEHOLDER = 'Reel is weighing your tastes…';
const FALLBACK = 'Your group landed on this one.';

describe('MatchReveal — the why line', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => { tree?.unmount(); });
    tree = null;
    jest.useRealTimers();
  });

  it('shows the poster and title immediately, without waiting on the line', () => {
    render();
    // The whole point of #10's gotcha: nothing here is gated on Gemini.
    expect(texts()).toEqual(expect.arrayContaining(['Parasite', PLACEHOLDER]));
  });

  it('holds the placeholder while the line is still plausibly in flight', () => {
    render();
    advance(14_000);

    expect(texts()).toContain(PLACEHOLDER);
    expect(texts()).not.toContain(FALLBACK);
  });

  it('settles on a finished-looking line once it gives up', () => {
    render();

    const pendingColor = StyleSheet.flatten(
      tree!.root.findAllByType(Text).find((node) => node.props.children === PLACEHOLDER)!
        .props.style,
    ).color;

    advance(15_000);

    expect(texts()).toContain(FALLBACK);
    expect(texts()).not.toContain(PLACEHOLDER);

    // Not just different copy — it has to stop looking like it is still loading.
    const restingColor = StyleSheet.flatten(
      tree!.root.findAllByType(Text).find((node) => node.props.children === FALLBACK)!
        .props.style,
    ).color;
    expect(restingColor).not.toBe(pendingColor);
  });

  it('lets a late line replace the fallback', () => {
    render();
    advance(15_000);
    expect(texts()).toContain(FALLBACK);

    const why = 'You give up the car chase, they give up the gore. Watch on Max or Hulu.';
    rerender(why);

    expect(texts()).toContain(why);
    expect(texts()).not.toContain(FALLBACK);
  });

  it('never starts the timer when the line is already there', () => {
    const why = 'A real compromise. Watch on Max or Hulu.';
    render(why);
    advance(60_000);

    expect(texts()).toContain(why);
    expect(texts()).not.toContain(FALLBACK);
  });

  // #10's badge row was dropped: the validated why already ends with the
  // providers, and printing both said the same thing twice on the money shot.
  it('carries where-to-watch in the line alone, with no badge row', () => {
    const why = 'You both win. Watch on Max or Hulu.';
    render(why);

    expect(tree!.root.findAllByProps({ testID: 'provider-row' })).toHaveLength(0);
    const rendered = texts();
    expect(rendered).toContain(why);
    expect(rendered).not.toContain('WHERE TO WATCH');
    // The names appear only inside the sentence, never as standalone badges.
    expect(rendered).not.toContain('Max');
  });
});

/**
 * The two ways out of a reveal (#97). They are deliberately not the same
 * mechanism: "Nice" is this device saying it is done looking, "Keep swiping"
 * is the whole group passing on the film.
 */
describe('MatchReveal — the footer actions', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('offers both accepting the match and rejecting it', () => {
    render('You both win.');
    expect(texts()).toEqual(expect.arrayContaining(['Nice', 'Keep swiping']));
  });

  it('keeps the two actions apart', () => {
    render('You both win.');

    act(() => button('Keep swiping')!.props.onPress());
    expect(onKeepSwiping).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => button('Nice')!.props.onPress());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onKeepSwiping).toHaveBeenCalledTimes(1);
  });

  it('disables the shared action while the clear is in flight', () => {
    // The write takes a beat on venue Wi-Fi, and a button that looks idle
    // gets tapped again. The transaction behind it is round-guarded, so the
    // extra taps are harmless — this is about the reveal not looking broken.
    render('You both win.', true);

    const keep = button('Finding another…');
    expect(keep).toBeDefined();
    expect(keep!.props.accessibilityState).toEqual({ disabled: true });
    expect(texts()).not.toContain('Keep swiping');
  });

  it('still lets the user accept the match while a clear is pending', () => {
    render('You both win.', true);
    act(() => button('Nice')!.props.onPress());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
