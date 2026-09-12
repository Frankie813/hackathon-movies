// lib/join-link.ts — the shapes of a join link, and the handoff from an
// inbound one to the group screen (issue #19).
//
// Two URLs, one code:
//
//   https://movienight.tech/j/BCDF   what the QR encodes. A phone camera can
//                                    open it without the app installed, so it
//                                    is the one a guest actually scans. #33
//                                    serves it and offers the scheme link.
//   moviematch://join/BCDF           what opens the app. `scheme` in app.json.
//
// Universal https links do NOT reach the app in Expo Go — they need an EAS
// build plus an AASA file (#31). Until that lands the https URL only ever
// reaches the web page, and that page's "Open in app" link is what crosses
// over. Don't promise otherwise in the pitch.

import { isValidCode, normalizeCode } from './session';

/**
 * The domain registered in #32, and the default if nothing overrides it.
 *
 * Demo-day escape hatch for DNS trouble: Firebase Hosting serves the same site
 * at https://moviematch-hackwestx.web.app. Put that in
 * EXPO_PUBLIC_JOIN_BASE_URL and restart — no code change, and the QR starts
 * pointing somewhere that resolves.
 */
const DEFAULT_WEB_ORIGIN = 'https://movienight.tech';

/**
 * The value .env.example shipped before the domain existed. Some checkouts
 * still carry it verbatim, and an unignored placeholder would put a dead
 * domain in the QR — the one part of this that nobody can eyeball, because it
 * only shows up as pixels.
 */
const PLACEHOLDER_ORIGIN = 'https://yourname.tech';

/**
 * The origin the QR points at. A public, non-secret URL, which is the only
 * kind of thing that belongs in an EXPO_PUBLIC_ var — those ship to the phone
 * in plaintext (AGENTS.md §3).
 */
export const WEB_ORIGIN = resolveOrigin(process.env.EXPO_PUBLIC_JOIN_BASE_URL);

function resolveOrigin(configured: string | undefined): string {
  const trimmed = configured?.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === PLACEHOLDER_ORIGIN) return DEFAULT_WEB_ORIGIN;
  return trimmed;
}

/** Matches app.json's `expo.scheme`. */
export const APP_SCHEME = 'moviematch';

/** The URL the QR encodes, and the one printed under it so the domain is on camera. */
export function joinUrl(code: string): string {
  return `${WEB_ORIGIN}/j/${normalizeCode(code)}`;
}

/** The scheme link that opens the app straight into the session. */
export function joinSchemeUrl(code: string): string {
  return `${APP_SCHEME}://join/${normalizeCode(code)}`;
}

/**
 * Both link shapes end in `/join/{CODE}` or `/j/{CODE}`, which is all we need
 * to find — matching on the path rather than parsing the URL keeps this
 * working for the third shape nobody thinks about until demo day:
 * `exp://10.0.0.4:8081/--/join/BCDF`, which is how a deep link arrives while
 * the app is running under Expo Go.
 *
 * @returns the normalized code, or null if the link isn't a join link or
 *          carries something that isn't a real code.
 */
export function parseJoinLink(url: string): string | null {
  const match = /(?:^|\/)(?:join|j)\/([A-Za-z]+)(?=$|[/?#])/.exec(url);
  if (!match) return null;

  // Validate rather than normalize: normalizeCode() would quietly turn a
  // mistyped 5-letter code into a different, valid-looking 4-letter one and
  // drop the guest into a stranger's session.
  const candidate = match[1];
  return isValidCode(candidate) ? normalizeCode(candidate) : null;
}

// --- handoff -------------------------------------------------------------
//
// app/join/[code].tsx is where a deep link lands, but the group screen is what
// owns session state. On a cold start the group screen isn't mounted yet; on a
// warm one it already is. This covers both: hand the code to a listener if
// there is one, otherwise park it for the next mount.

type JoinListener = (code: string) => void;

let parked: string | null = null;
const listeners = new Set<JoinListener>();

/** Called by the deep-link route with an already-validated code. */
export function requestJoin(code: string): void {
  if (listeners.size > 0) {
    listeners.forEach((listener) => listener(code));
    return;
  }
  parked = code;
}

/** Reads and clears a code parked before anyone was listening. */
export function takeParkedJoin(): string | null {
  const code = parked;
  parked = null;
  return code;
}

/** @returns an unsubscribe. Call it on unmount, or the group screen leaks a listener per remount. */
export function onJoinRequested(listener: JoinListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
