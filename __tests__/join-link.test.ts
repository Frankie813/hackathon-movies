// __tests__/join-link.test.ts — the link contract in #19. #33 serves the other
// half of it, so a change here that isn't matched there breaks the QR silently.

import {
  APP_SCHEME,
  joinSchemeUrl,
  joinUrl,
  onJoinRequested,
  parseJoinLink,
  requestJoin,
  takeParkedJoin,
  WEB_ORIGIN,
} from '../lib/join-link';

// join-link takes isValidCode/normalizeCode from lib/session, which drags in
// the Firestore SDK — ESM that jest won't transform, and a configured app it
// doesn't have. Nothing under test goes near the network; stub the reach.
jest.mock('firebase/firestore', () => ({}));
jest.mock('../lib/firebase', () => ({ db: {} }));
jest.mock('../lib/auth', () => ({ ensureAnonymousUser: jest.fn() }));

/** Runs `body` with EXPO_PUBLIC_JOIN_BASE_URL set to `value`, then puts it back. */
function withJoinBaseUrl(value: string | undefined, body: () => void): void {
  const previous = process.env.EXPO_PUBLIC_JOIN_BASE_URL;
  if (value === undefined) delete process.env.EXPO_PUBLIC_JOIN_BASE_URL;
  else process.env.EXPO_PUBLIC_JOIN_BASE_URL = value;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_JOIN_BASE_URL;
    else process.env.EXPO_PUBLIC_JOIN_BASE_URL = previous;
  }
}

describe('link shapes', () => {
  it('encodes the QR URL as {origin}/j/{CODE} — the path #33 serves', () => {
    expect(joinUrl('BCDF')).toBe(`${WEB_ORIGIN}/j/BCDF`);
  });

  it.each([
    ['unset', undefined, 'https://movienight.tech/j/BCDF'],
    ['empty', '', 'https://movienight.tech/j/BCDF'],
    // A checkout that copied .env.example before #32 named the domain. The QR
    // is pixels; a dead domain in it is invisible until a judge scans it.
    ['the .env.example placeholder', 'https://yourname.tech', 'https://movienight.tech/j/BCDF'],
    [
      'the Hosting fallback',
      'https://moviematch-hackwestx.web.app',
      'https://moviematch-hackwestx.web.app/j/BCDF',
    ],
    [
      'a trailing slash',
      'https://moviematch-hackwestx.web.app/',
      'https://moviematch-hackwestx.web.app/j/BCDF',
    ],
  ])('resolves the origin when EXPO_PUBLIC_JOIN_BASE_URL is %s', (_label, value, expected) => {
    withJoinBaseUrl(value, () => {
      jest.isolateModules(() => {
        const fresh = require('../lib/join-link') as { joinUrl: (code: string) => string };
        expect(fresh.joinUrl('BCDF')).toBe(expected);
      });
    });
  });

  it('uses the app scheme for the in-app link', () => {
    expect(joinSchemeUrl('BCDF')).toBe('moviematch://join/BCDF');
    expect(joinSchemeUrl('BCDF')).toBe(`${APP_SCHEME}://join/BCDF`);
  });

  it('normalizes a lowercase or padded code into the URL', () => {
    expect(joinUrl(' bcdf ')).toBe(`${WEB_ORIGIN}/j/BCDF`);
  });
});

describe('parseJoinLink', () => {
  it('reads the scheme link', () => {
    expect(parseJoinLink('moviematch://join/BCDF')).toBe('BCDF');
  });

  it('reads the https link the QR encodes', () => {
    expect(parseJoinLink('https://movienight.tech/j/BCDF')).toBe('BCDF');
  });

  it('reads the Expo Go development shape', () => {
    expect(parseJoinLink('exp://10.0.0.4:8081/--/join/BCDF')).toBe('BCDF');
  });

  it('uppercases and tolerates a trailing slash or query', () => {
    expect(parseJoinLink('moviematch://join/bcdf')).toBe('BCDF');
    expect(parseJoinLink('https://movienight.tech/j/BCDF/')).toBe('BCDF');
    expect(parseJoinLink('https://movienight.tech/j/BCDF?from=qr')).toBe('BCDF');
  });

  it('rejects a code carrying letters that are not in the alphabet', () => {
    // 'A' is a vowel; the alphabet is consonants only, so this is not a code.
    expect(parseJoinLink('moviematch://join/ABCD')).toBeNull();
  });

  it('rejects a wrong-length code rather than truncating it into a valid one', () => {
    expect(parseJoinLink('moviematch://join/BCDFG')).toBeNull();
    expect(parseJoinLink('moviematch://join/BCD')).toBeNull();
  });

  it('ignores links that are not join links', () => {
    expect(parseJoinLink('moviematch://swipe')).toBeNull();
    expect(parseJoinLink('https://movienight.tech/')).toBeNull();
    expect(parseJoinLink('')).toBeNull();
  });
});

describe('handoff', () => {
  afterEach(() => {
    takeParkedJoin();
  });

  it('parks a code when nobody is listening yet (cold start)', () => {
    requestJoin('BCDF');
    expect(takeParkedJoin()).toBe('BCDF');
    expect(takeParkedJoin()).toBeNull();
  });

  it('hands straight to a listener and parks nothing (warm start)', () => {
    const seen: string[] = [];
    const stop = onJoinRequested((code) => seen.push(code));

    requestJoin('BCDF');

    expect(seen).toEqual(['BCDF']);
    expect(takeParkedJoin()).toBeNull();
    stop();
  });

  it('stops delivering after unsubscribe', () => {
    const seen: string[] = [];
    onJoinRequested((code) => seen.push(code))();

    requestJoin('BCDF');

    expect(seen).toEqual([]);
    // Nothing was listening, so it parked instead of being dropped.
    expect(takeParkedJoin()).toBe('BCDF');
  });
});
