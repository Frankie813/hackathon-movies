// Covers the three acceptance criteria of issue #20: a ≤20-word reason, a
// second request served from cache with zero network, and a 429 that leaves the
// deck running instead of throwing.

import type { Movie } from '../src/types';

// The real module builds a Firebase app at import time, which needs the
// EXPO_PUBLIC_FIREBASE_* config jest does not load. Only `app` is consumed.
jest.mock('../lib/firebase', () => ({ app: {} }));

const mockGenerateContent = jest.fn();

jest.mock('firebase/ai', () => ({
  getAI: jest.fn(() => ({})),
  // Indirect on purpose: babel hoists the `import` of lib/gemini above the
  // `const` below, so the model is built before the spy exists. Resolving it at
  // call time instead of capture time is what makes the spy reachable.
  getGenerativeModel: jest.fn(() => ({
    generateContent: (...args: unknown[]) => mockGenerateContent(...args),
  })),
  GoogleAIBackend: jest.fn(),
  Schema: {
    object: (params: unknown) => params,
    string: (params: unknown) => params,
    number: (params: unknown) => params,
  },
}));

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
  },
}));

import { __resetWhyLineCache, cachedWhyLine, subscribeWhyLines, whyLine } from '../lib/gemini';

function movie(id: number, title: string): Movie {
  return {
    id, title, year: 2026, genreIds: [28], genreNames: ['Action'],
    keywords: [], poster: '', providers: [], video: null,
  };
}

/** Shapes a fake response the way the SDK does: `response.text()` is a method. */
function reply(reason: string, confidence = 0.9) {
  return { response: { text: () => JSON.stringify({ reason, confidence }) } };
}

/** A 429 as Firebase AI Logic raises it — an AIError carrying the HTTP status. */
function rateLimited(): Error & { customErrorData: { status: number } } {
  return Object.assign(new Error('Error fetching from ...: [429 Too Many Requests]'), {
    customErrorData: { status: 429 },
  });
}

const candidate = movie(1, 'Heat');
const likes = [movie(2, 'Sicario'), movie(3, 'The Town')];

beforeEach(() => {
  mockStore.clear();
  mockGenerateContent.mockReset();
  __resetWhyLineCache();
});

describe('whyLine', () => {
  it('returns a reason of at most 20 words', async () => {
    const reason = 'Slow-burn heists and professionals who talk like they mean it.';
    mockGenerateContent.mockResolvedValue(reply(reason));

    const line = await whyLine(candidate, likes);

    expect(line).toBe(reason);
    expect(line!.split(' ')).toHaveLength(10);
  });

  it('truncates a model that ignores the word cap', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join('  ');
    mockGenerateContent.mockResolvedValue(reply(long));

    const line = await whyLine(candidate, likes);

    expect(line!.split(' ')).toHaveLength(20);
    expect(line!.endsWith('…')).toBe(true);
  });

  it('sends the recent likes and the candidate, and pins the model and schema', async () => {
    mockGenerateContent.mockResolvedValue(reply('Because you like a heist with manners.'));

    await whyLine(candidate, likes);

    const [request] = mockGenerateContent.mock.calls[0];
    const prompt: string = request.contents[0].parts[0].text;
    // Most recent like first, so a shifting taste reads left to right.
    expect(prompt).toContain('The Town, Sicario');
    expect(prompt).toContain('"Heat"');
    expect(request.generationConfig.responseMimeType).toBe('application/json');
    expect(request.generationConfig.responseSchema).toBeDefined();

    const { getGenerativeModel } = jest.requireMock('firebase/ai');
    expect(getGenerativeModel).toHaveBeenCalledWith(expect.anything(), {
      model: 'gemini-3.5-flash',
    });
  });

  it('serves the second request for the same movie from memory with no network', async () => {
    mockGenerateContent.mockResolvedValue(reply('Because you like a heist with manners.'));

    const first = await whyLine(candidate, likes);
    const second = await whyLine(candidate, likes);

    expect(second).toBe(first);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(cachedWhyLine(candidate.id)).toBe(first);
  });

  it('serves it from disk after the in-memory cache is gone', async () => {
    mockGenerateContent.mockResolvedValue(reply('Because you like a heist with manners.'));

    const first = await whyLine(candidate, likes);
    __resetWhyLineCache();
    expect(cachedWhyLine(candidate.id)).toBeUndefined();

    expect(await whyLine(candidate, likes)).toBe(first);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent requests for one movie into a single call', async () => {
    mockGenerateContent.mockResolvedValue(reply('Because you like a heist with manners.'));

    const [a, b] = await Promise.all([whyLine(candidate, likes), whyLine(candidate, likes)]);

    expect(a).toBe(b);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and returns the reason when the retry lands', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(rateLimited())
      .mockResolvedValue(reply('Because you like a heist with manners.'));

    expect(await whyLine(candidate, likes)).toBe('Because you like a heist with manners.');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('returns null instead of throwing when every retry is rate limited', async () => {
    mockGenerateContent.mockRejectedValue(rateLimited());

    await expect(whyLine(candidate, likes)).resolves.toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);

    // Over quota: the next card must not burn three more doomed requests.
    await expect(whyLine(movie(9, 'Ronin'), likes)).resolves.toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  it('notifies subscribers so the card already on screen can re-render', async () => {
    const reason = 'Because you like a heist with manners.';
    mockGenerateContent.mockResolvedValue(reply(reason));
    const seen: [number, string][] = [];
    const unsubscribe = subscribeWhyLines((id, line) => seen.push([id, line]));

    try {
      await whyLine(candidate, likes);
      expect(seen).toEqual([[candidate.id, reason]]);

      // The disk hit has to notify too, or an offline relaunch renders blank.
      __resetWhyLineCache();
      await whyLine(candidate, likes);
      expect(seen).toHaveLength(2);
    } finally {
      unsubscribe();
    }

    await whyLine(movie(9, 'Ronin'), likes);
    expect(seen).toHaveLength(2);
  });

  it('returns null without retrying on a non-429 failure', async () => {
    mockGenerateContent.mockRejectedValue(new Error('network down'));

    await expect(whyLine(candidate, likes)).resolves.toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('returns null on a malformed or empty response rather than caching junk', async () => {
    mockGenerateContent.mockResolvedValueOnce({ response: { text: () => 'not json' } });
    await expect(whyLine(candidate, likes)).resolves.toBeNull();

    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => JSON.stringify({ reason: '   ' }) },
    });
    await expect(whyLine(candidate, likes)).resolves.toBeNull();

    // A failure is never cached, so a later deck pass can still get a line.
    expect(cachedWhyLine(candidate.id)).toBeUndefined();
    expect(mockStore.size).toBe(0);
  });
});
