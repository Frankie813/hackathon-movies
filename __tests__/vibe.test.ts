// Issue #39: poster vibe tags. Gemini, the poster download and storage are
// injected, so no network is used.

import { __resetQuotaCooldown, openQuotaCooldown } from '../lib/quota';
import {
  createVibeTags,
  parseVibeTags,
  sanitizeTags,
  smallPoster,
  VIBE_SCHEMA,
  type PosterImage,
  type VibeStorage,
} from '../src/lib/vibe';
import type { Movie } from '../src/types';

const movie = (id: number, extra: Partial<Movie> = {}): Movie => ({
  id, title: `Movie ${id}`, year: 2010, genreIds: [], genreNames: [], keywords: [],
  poster: `https://image.tmdb.org/t/p/w780/p${id}.jpg`, providers: [], video: null, ...extra,
});
const image: PosterImage = { mimeType: 'image/jpeg', data: 'AAAA' };
const json = (tags: unknown) => JSON.stringify({ tags });

function memoryStorage(): VibeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
  };
}

beforeEach(() => __resetQuotaCooldown());

describe('vibeTags (#39)', () => {
  it('sends the w342 poster and title, and returns three tags', async () => {
    const fetchImage = jest.fn(async () => image);
    const generate = jest.fn(async () => json(['Neon-Noir', 'slow burn', 'rain-soaked']));
    const { vibeTags } = createVibeTags({ generate, fetchImage });

    await expect(vibeTags(movie(1))).resolves.toEqual(['neon-noir', 'slow burn', 'rain-soaked']);
    expect(fetchImage).toHaveBeenCalledWith('https://image.tmdb.org/t/p/w342/p1.jpg');
    expect(generate).toHaveBeenCalledWith(image, 'Movie 1');
  });

  it('caches per movie: one request, then memory, then disk after a restart', async () => {
    const storage = memoryStorage();
    const generate = jest.fn(async () => json(['popcorn', 'big swings', 'sunlit']));
    const first = createVibeTags({ generate, fetchImage: async () => image, storage });

    await Promise.all([first.vibeTags(movie(2)), first.vibeTags(movie(2))]);
    await first.vibeTags(movie(2));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(first.cachedVibeTags(movie(2))).toEqual(['popcorn', 'big swings', 'sunlit']);

    await new Promise<void>((done) => setImmediate(done));
    const restarted = createVibeTags({ generate, fetchImage: async () => image, storage });
    await expect(restarted.vibeTags(movie(2))).resolves.toEqual(['popcorn', 'big swings', 'sunlit']);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('serves pre-generated tags synchronously without any request', async () => {
    const generate = jest.fn(async () => json(['x', 'y', 'z']));
    const { vibeTags, cachedVibeTags } = createVibeTags({
      generate,
      fetchImage: async () => image,
      pregenerated: { 3: ['cosmic dread', 'lonely', 'vast'], 4: ['only', 'two'] },
    });

    expect(cachedVibeTags(movie(3))).toEqual(['cosmic dread', 'lonely', 'vast']);
    expect(cachedVibeTags(movie(4))).toBeUndefined(); // invalid bundled entry is ignored
    await expect(vibeTags(movie(3))).resolves.toEqual(['cosmic dread', 'lonely', 'vast']);
    expect(generate).not.toHaveBeenCalled();
  });

  it('resolves null, uncached, on failure, bad output, no poster, or over quota', async () => {
    const generate = jest.fn(async () => json(['one', 'two']));
    const { vibeTags, cachedVibeTags } = createVibeTags({ generate, fetchImage: async () => image });
    await expect(vibeTags(movie(5))).resolves.toBeNull();
    expect(cachedVibeTags(movie(5))).toBeUndefined();

    const offline = createVibeTags({ generate, fetchImage: async () => { throw new Error('offline'); } });
    await expect(offline.vibeTags(movie(6))).resolves.toBeNull();

    await expect(vibeTags(movie(7, { poster: '' }))).resolves.toBeNull();

    generate.mockClear();
    openQuotaCooldown();
    await expect(vibeTags(movie(8))).resolves.toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('tag validation', () => {
  it('accepts exactly three short, distinct tags and cleans them', () => {
    expect(sanitizeTags([' #Neon-Noir ', '"Slow  Burn"', 'popcorn!'])).toEqual(['neon-noir', 'slow burn', 'popcorn']);
    expect(sanitizeTags(['a', 'b'])).toBeNull();
    expect(sanitizeTags(['a', 'a', 'b'])).toBeNull();
    expect(sanitizeTags(['a', 'b', 'this is far too many words'])).toBeNull();
    expect(sanitizeTags(['a', 'b', 'x'.repeat(21)])).toBeNull();
    expect(sanitizeTags(['a', 'b', '<script>'])).toBeNull();
    expect(sanitizeTags(['a', 'b', 3])).toBeNull();
    expect(parseVibeTags('not json')).toBeNull();
  });

  it('schema asks for exactly three string tags', () => {
    expect(VIBE_SCHEMA.properties.tags).toMatchObject({ minItems: 3, maxItems: 3, items: { type: 'string' } });
    expect(smallPoster('https://image.tmdb.org/t/p/w780/a.jpg')).toBe('https://image.tmdb.org/t/p/w342/a.jpg');
  });
});
