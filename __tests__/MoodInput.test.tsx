import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { MoodInput, type AppliedMood } from '@/components/MoodInput';
import type { MoodFilters } from '@/src/lib/gemini';

const mockMoodToFilters = jest.fn<Promise<MoodFilters | null>, [string]>();
const mockIsOffline = jest.fn<boolean, []>();

// The real module pulls in Firebase AI Logic; #22 is covered by mood.test.ts.
jest.mock('@/src/lib/gemini', () => ({
  moodToFilters: (text: string) => mockMoodToFilters(text),
}));

jest.mock('@/lib/tmdb', () => ({
  isOffline: () => mockIsOffline(),
}));

/** Every literal string in the rendered output, whatever it is wrapped in. */
function texts(tree: ReactTestRenderer): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') found.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') walk((node as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return found;
}

/** Pressable renders both a composite and a host node for the same testID. */
function press(tree: ReactTestRenderer, testID: string): Promise<void> {
  const target = tree.root.findAllByProps({ testID }).find((node) => node.props.onPress);
  if (!target) throw new Error(`no pressable with testID ${testID}`);
  return act(async () => {
    target.props.onPress();
  });
}

function open(tree: ReactTestRenderer): Promise<void> {
  return press(tree, 'mood-open');
}

const rendered: ReactTestRenderer[] = [];

function render(overrides: Partial<React.ComponentProps<typeof MoodInput>> = {}) {
  const onApply = jest.fn<Promise<boolean>, [MoodFilters, string]>().mockResolvedValue(true);
  const onClear = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <MoodInput active={null} onApply={onApply} onClear={onClear} {...overrides} />,
    );
  });
  rendered.push(tree);
  return { tree, onApply, onClear };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOffline.mockReturnValue(false);
});

// The toast's dismissal timer outlives the test otherwise, and fires into a
// torn-down environment.
afterEach(() => {
  act(() => {
    rendered.splice(0).forEach((tree) => tree.unmount());
  });
});

describe('MoodInput', () => {
  it('turns a suggestion chip into filters and hands them to the deck', async () => {
    const filters: MoodFilters = { withGenres: [35], minRating: 7, tone: 'clever and funny' };
    mockMoodToFilters.mockResolvedValue(filters);
    const { tree, onApply } = render();

    await open(tree);
    await press(tree, 'mood-chip-funny but not dumb');

    expect(mockMoodToFilters).toHaveBeenCalledWith('funny but not dumb');
    expect(onApply).toHaveBeenCalledWith(filters, 'funny but not dumb');
    // The sheet closes, and Gemini's read of the mood is echoed on the deck.
    expect(tree.root.findAllByProps({ testID: 'mood-text' })).toHaveLength(0);
    expect(texts(tree)).toContain('Mood: clever and funny');
  });

  it('shows the parsed tone back inside the sheet once a mood is applied', async () => {
    const active: AppliedMood = { text: 'something to cry to', tone: 'tender and sad' };
    const { tree } = render({ active });

    await open(tree);

    expect(texts(tree)).toContain('tender and sad');
    expect(tree.root.findAllByProps({ testID: 'mood-clear' }).length).toBeGreaterThan(0);
  });

  it('keeps the deck and says so when Gemini cannot read the mood', async () => {
    mockMoodToFilters.mockResolvedValue(null);
    const { tree, onApply } = render();

    await open(tree);
    await press(tree, 'mood-chip-edge of my seat');

    expect(onApply).not.toHaveBeenCalled();
    const error = tree.root.findAllByProps({ testID: 'mood-error' })[0];
    expect(error.props.children).toMatch(/Couldn't read that one/);
  });

  it('blames the network, not the wording, when the catalog is offline', async () => {
    mockMoodToFilters.mockResolvedValue(null);
    mockIsOffline.mockReturnValue(true);
    const { tree } = render();

    await open(tree);
    await press(tree, 'mood-chip-edge of my seat');

    const error = tree.root.findAllByProps({ testID: 'mood-error' })[0];
    expect(error.props.children).toMatch(/offline catalog/);
  });

  it('reports a deck that could not be filtered rather than claiming the mood', async () => {
    mockMoodToFilters.mockResolvedValue({ withGenres: [27], tone: 'creepy' });
    const { tree, onApply } = render();
    onApply.mockResolvedValue(false);

    await open(tree);
    await press(tree, 'mood-chip-edge of my seat');

    // Sheet stays open, with the reason on it.
    expect(tree.root.findAllByProps({ testID: 'mood-text' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'mood-error' })[0].props.children).toMatch(
      /Nothing came back for that mood/,
    );
  });

  it('does not start a second mood while one is in flight', async () => {
    let release: (filters: MoodFilters | null) => void = () => {};
    mockMoodToFilters.mockReturnValue(
      new Promise<MoodFilters | null>((resolve) => {
        release = resolve;
      }),
    );
    const { tree, onApply } = render();

    await open(tree);
    await press(tree, 'mood-chip-funny but not dumb');
    expect(texts(tree)).toContain('Reading your mood…');

    await press(tree, 'mood-chip-something to cry to');
    expect(mockMoodToFilters).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ withGenres: [35], tone: 'clever and funny' });
    });
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('resets to the default deck', async () => {
    const { tree, onClear } = render({ active: { text: 'funny but not dumb', tone: 'wry' } });

    await open(tree);
    await press(tree, 'mood-clear');

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(texts(tree)).toContain('Mood cleared');
  });
});
