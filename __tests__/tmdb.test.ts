import type { Movie } from '../src/types';

// lib/tmdb.ts reads the token into a module constant at import time and keeps
// the movie cache and the online/offline stamps in module scope, so each test
// takes a fresh copy rather than inheriting the previous one's state.
type Tmdb = {
  getDeck: (filters?: unknown) => Promise<Movie[]>;
  getMovie: (id: number) => Promise<Movie | null>;
  similar: (id: number) => Promise<Movie[]>;
  isOffline: () => boolean;
};

function loadTmdb(): Tmdb {
  let mod!: Tmdb;
  jest.isolateModules(() => {
    mod = require('../lib/tmdb') as Tmdb;
  });
  return mod;
}

/** A /movie/{id} payload. Ids here are deliberately outside lib/seed.json. */
function detail(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Movie ${id}`,
    release_date: '2026-01-01',
    poster_path: '/p.jpg',
    genres: [{ id: 28, name: 'Action' }],
    videos: { results: [{ key: 'abc123', site: 'YouTube', type: 'Clip', official: true }] },
    ...extra,
  };
}

function respondWith(body: unknown) {
  return jest.fn(async (_url: string, _init?: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
}

function setFetch(fn: unknown): void {
  (globalThis as unknown as { fetch: unknown }).fetch = fn;
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_TMDB_READ_TOKEN = 'test-token';
  jest.restoreAllMocks();
});

describe('castIds hydration', () => {
  it('keeps the top five billed cast, in billing order', async () => {
    // Deliberately out of order, and more than the cap: TMDB returns `order`
    // explicitly and array position is not guaranteed to match it.
    setFetch(
      respondWith(
        detail(900001, {
          credits: {
            cast: [
              { id: 30, order: 3 },
              { id: 10, order: 1 },
              { id: 60, order: 6 },
              { id: 50, order: 5 },
              { id: 0o0, order: 0 },
              { id: 40, order: 4 },
              { id: 20, order: 2 },
            ],
          },
        }),
      ),
    );

    const movie = await loadTmdb().getMovie(900001);

    expect(movie?.castIds).toEqual([0, 10, 20, 30, 40]);
  });

  it('yields an empty list rather than undefined when a movie has no credits', async () => {
    setFetch(respondWith(detail(900002)));

    const movie = await loadTmdb().getMovie(900002);

    // features() in taste.ts guards with `?? []`, but a Movie that reaches
    // Firestore or Gemini with `castIds: undefined` is a different shape.
    expect(movie?.castIds).toEqual([]);
  });

  it('requests credits alongside the other appended resources', async () => {
    const fetchMock = respondWith(detail(900003));
    setFetch(fetchMock);

    await loadTmdb().getMovie(900003);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(url)).toContain('videos,watch/providers,keywords,credits');
  });
});

describe('isOffline', () => {
  it('is false before any call', () => {
    expect(loadTmdb().isOffline()).toBe(false);
  });

  it('is false once TMDB answers', async () => {
    setFetch(respondWith(detail(900010)));
    const tmdb = loadTmdb();

    await tmdb.getMovie(900010);

    expect(tmdb.isOffline()).toBe(false);
  });

  it('is true when the network does not answer', async () => {
    setFetch(jest.fn(async () => Promise.reject(new Error('Network request failed'))));
    const tmdb = loadTmdb();

    await tmdb.getMovie(900011);

    expect(tmdb.isOffline()).toBe(true);
  });

  it('clears once a later call succeeds', async () => {
    const tmdb = loadTmdb();

    setFetch(jest.fn(async () => Promise.reject(new Error('Network request failed'))));
    await tmdb.getMovie(900012);
    expect(tmdb.isOffline()).toBe(true);

    // The Wi-Fi comes back mid-session. Nothing resets the flag explicitly, so
    // this is the property that makes it self-healing rather than sticky.
    setFetch(respondWith(detail(900013)));
    await tmdb.getMovie(900013);

    expect(tmdb.isOffline()).toBe(false);
  });

  it('does not read an empty but valid response as an outage', async () => {
    // An empty /discover page still falls back to seed, but the network answered
    // — #26 and the About screen would be lying if this read as offline.
    setFetch(respondWith({ results: [] }));
    const tmdb = loadTmdb();

    const deck = await tmdb.getDeck();

    expect(deck.length).toBeGreaterThan(0);
    expect(tmdb.isOffline()).toBe(false);
  });

  // Documents the known gap in the isOffline() docblock rather than asserting
  // it away. #13 calls similar() three times at once, and with two succeeding
  // and one timing out the answer is decided by which settled last — not by
  // which outcome matters more. Both orderings are plausible on venue Wi-Fi.
  // If #26 gives the flag a real meaning, this is the test that should change.
  it.each([
    ['the failure settles last', true, true],
    ['the failure settles first', false, false],
  ])('with one of three calls failing and %s, reports offline=%s', async (_label, failSlowly, expected) => {
    const tmdb = loadTmdb();
    setFetch(
      jest.fn(async (url: string) => {
        const fails = String(url).includes('/movie/2/');
        await new Promise((resolve) => setTimeout(resolve, fails === failSlowly ? 40 : 0));
        if (fails) throw new Error('Network request failed');
        return { ok: true, status: 200, json: async () => ({ results: [] }) };
      }),
    );

    await Promise.all([tmdb.similar(1), tmdb.similar(2), tmdb.similar(3)]);

    expect(tmdb.isOffline()).toBe(expected);
  });
});

describe('searchMovie (#23 title validation)', () => {
  type Search = { searchMovie: (title: string, year?: number) => Promise<Movie | null>; isOffline: () => boolean };
  const loadSearch = () => loadTmdb() as unknown as Search;

  /** /search/movie answers with `results`; /movie/{id} hydrates from detail(). */
  function searchFetch(results: { id: number; title: string; original_title?: string; release_date: string }[]) {
    return jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => {
        if (String(url).includes('/search/movie')) return { results };
        const id = Number(String(url).match(/\/movie\/(\d+)/)?.[1]);
        const hit = results.find((result) => result.id === id);
        return detail(id, hit ? { title: hit.title, release_date: hit.release_date } : {});
      },
    }));
  }

  it('resolves an exact title match to the hydrated TMDB movie, ignoring fuzzy hits', async () => {
    const tmdb = loadSearch();
    setFetch(searchFetch([
      { id: 900001, title: 'Arrival of the Dead', release_date: '2016-01-01' },
      { id: 900002, title: 'Arrival', release_date: '2016-11-10' },
    ]));
    const movie = await tmdb.searchMovie('arrival', 2016);
    expect(movie?.id).toBe(900002);
    expect(movie?.title).toBe('Arrival');
  });

  it('rejects an invented title and a same-name film from another era', async () => {
    const tmdb = loadSearch();
    setFetch(searchFetch([{ id: 900003, title: 'Dune', release_date: '1984-12-14' }]));
    await expect(tmdb.searchMovie('The Quantum Heist of Neptune', 2019)).resolves.toBeNull();
    await expect(tmdb.searchMovie('Dune', 2021)).resolves.toBeNull();
    await expect(tmdb.searchMovie('Dune', 1985)).resolves.toMatchObject({ id: 900003 });
  });

  it('matches through punctuation, accents, a leading article, and original_title', async () => {
    const tmdb = loadSearch();
    setFetch(searchFetch([
      { id: 900004, title: 'Amélie', original_title: "Le Fabuleux Destin d'Amélie Poulain", release_date: '2001-04-25' },
    ]));
    await expect(tmdb.searchMovie('amelie')).resolves.toMatchObject({ id: 900004 });
    await expect(tmdb.searchMovie("Le fabuleux destin d'Amelie Poulain", 2001)).resolves.toMatchObject({ id: 900004 });
  });

  it('falls back to the seed catalog offline, and never marks the deck offline', async () => {
    const tmdb = loadSearch();
    setFetch(jest.fn(async () => { throw new TypeError('Network request failed'); }));
    await expect(tmdb.searchMovie('the matrix', 1999)).resolves.toMatchObject({ id: 603 });
    await expect(tmdb.searchMovie('Not A Real Film')).resolves.toBeNull();
    expect(tmdb.isOffline()).toBe(false);
  });
});
