// lib/gemini.ts — the one Gemini entry point for the app (issues #3, #20).
//
// Firebase AI Logic holds the Gemini credential on the server. Only the public
// Firebase web configuration belongs in the app; do not add a Gemini API key.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from 'firebase/ai';

import type { Movie } from '@/types';
import { app } from './firebase';

/**
 * Pinned on purpose (AGENTS.md §3). `gemini-2.0-flash` is shut down and the 1.x
 * names 404; a floating alias would move under us mid-demo. Re-check with
 * `/verify-apis` at build time.
 */
export const GEMINI_MODEL = 'gemini-3.5-flash';

export const ai = getAI(app, { backend: new GoogleAIBackend() });
export const gemini = getGenerativeModel(ai, { model: GEMINI_MODEL });

// ─────────────────────────────────────────────────────────────────────────────
// "Why you'd like this" — issue #20
// ─────────────────────────────────────────────────────────────────────────────

const WHY_SYSTEM_PROMPT =
  'You are Reel, a witty film concierge. Given a user\'s liked movies and one ' +
  'candidate, explain in ONE sentence (max 20 words) why they would like it. ' +
  'No spoilers. Never name a film other than the candidate. Address the user ' +
  'as "you". Return only the JSON object.';

/**
 * Mime type *and* schema together are what make the response parseable —
 * `application/json` alone still lets the model pick its own field names.
 */
const WHY_SCHEMA = Schema.object({
  properties: {
    reason: Schema.string({
      description: 'One sentence, at most 20 words, no spoilers.',
    }),
    confidence: Schema.number({
      description: 'How well the candidate fits the likes, 0 to 1.',
    }),
  },
  // The issue's contract requires `reason` only; a missing confidence is fine.
  optionalProperties: ['confidence'],
});

/** Hard cap from the acceptance criteria — enforced locally, not just asked for. */
const MAX_WORDS = 20;

/** Likes to send. More than this is prompt noise and the taste is already clear. */
const MAX_LIKES = 5;

/**
 * Per-request budget. The card renders without a why line and fills it in when
 * this resolves, so a slow call costs nothing but a late line — but the SDK's
 * own default is 180s, which would keep a dead request in flight all demo.
 */
const REQUEST_TIMEOUT_MS = 8_000;

/** 429 retries. Two is enough to ride out a burst without stalling the deck. */
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 600;

/**
 * After the retries are also rate-limited we are genuinely over the 15 RPM free
 * tier, so stop asking. Every call during the cooldown returns null instantly
 * and the deck keeps swiping — the alternative is 60 cards each burning three
 * doomed requests.
 */
const QUOTA_COOLDOWN_MS = 60_000;

const DISK_KEY_PREFIX = 'why:v1:';

/**
 * By TMDB id, per the issue. The line is deliberately *not* keyed on the likes
 * as well: a user's taste shifts every swipe, and re-keying would miss the
 * cache on every card. The line stays as it was first written for this movie.
 */
const memoryCache = new Map<number, string>();

/** Dedupes concurrent calls — #8 prefetches the next few cards at once. */
const inFlight = new Map<number, Promise<string | null>>();

let quotaCooldownUntil = 0;

interface WhyResponse {
  reason?: unknown;
  confidence?: unknown;
}

function log(message: string, error?: unknown): void {
  if (__DEV__) console.warn(`[gemini] ${message}`, error ?? '');
}

/** Notified whenever a line lands in the memory cache. See subscribeWhyLines(). */
const listeners = new Set<(tmdbId: number, line: string) => void>();

/**
 * The synchronous read behind SwipeDeck's `whyFor` prop. Returns only what is
 * already in memory — it never touches disk or the network, so it is safe on
 * the render path.
 *
 * It is a plain Map read, so it is *not* enough on its own: a card that
 * rendered before the request resolved would keep its empty slot forever.
 * Pair it with subscribeWhyLines().
 */
export function cachedWhyLine(tmdbId: number): string | undefined {
  return memoryCache.get(tmdbId);
}

/**
 * Fires when a why line arrives, so the deck can re-render the card that is
 * already on screen. Without this the line only ever appears on *later* cards,
 * which happen to re-render when the swipe advances the index — the current
 * card, the one the judge is looking at, stays blank.
 *
 * Returns an unsubscribe; call it from the effect's cleanup.
 */
export function subscribeWhyLines(
  listener: (tmdbId: number, line: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Single write path for the memory cache, so no notification can be forgotten. */
function cacheWhyLine(tmdbId: number, line: string): void {
  memoryCache.set(tmdbId, line);
  for (const listener of listeners) {
    // A throwing subscriber must not take down the request that fed it.
    try {
      listener(tmdbId, line);
    } catch (error) {
      log('why line listener threw', error);
    }
  }
}

/** A 429 from Firebase AI Logic arrives as an AIError carrying the HTTP status. */
function isRateLimited(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { customErrorData?: { status?: number } }).customErrorData?.status;
  // When the SDK gave us a status, believe it. Sniffing the message as well
  // would let an unrelated failure that happens to contain "429" (a request id,
  // a byte count, a port) trip the 60s cooldown and silence the whole deck.
  if (typeof status === 'number') return status === 429;
  // Older SDK paths only put the status in the message.
  return error instanceof Error && /\b429\b|RESOURCE_EXHAUSTED/i.test(error.message);
}

/**
 * A one-line, key-free summary of a failure, safe to print in a dev log. The
 * SDK quotes the request URL in its message, so anything that looks like a
 * Google API key is masked before it can reach a terminal or a screen share.
 */
function scrubbed(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza…').slice(0, 300);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Collapses whitespace and enforces the 20-word cap ourselves. The prompt asks
 * for it and the model usually obliges, but "usually" is not an acceptance
 * criterion, and a paragraph would overflow the card chrome.
 */
function toWhyLine(reason: string): string | null {
  const words = reason.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return null;
  if (words.length <= MAX_WORDS) return words.join(' ');
  return `${words.slice(0, MAX_WORDS).join(' ').replace(/[,;:.!?—-]+$/, '')}…`;
}

/**
 * AsyncStorage is best-effort everywhere: it is absent under plain Node, and it
 * can fail on a full device. A cache miss is always survivable, so nothing here
 * is allowed to throw.
 */
async function readDisk(tmdbId: number): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(DISK_KEY_PREFIX + tmdbId);
  } catch (error) {
    log(`disk read failed for ${tmdbId}`, error);
    return null;
  }
}

async function writeDisk(tmdbId: number, line: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISK_KEY_PREFIX + tmdbId, line);
  } catch (error) {
    log(`disk write failed for ${tmdbId}`, error);
  }
}

function buildPrompt(candidate: Movie, likes: Movie[]): string {
  const recent = likes
    .slice(-MAX_LIKES)
    .reverse()
    .map((movie) => movie.title)
    .filter(Boolean);

  const genres = candidate.genreNames.length > 0 ? candidate.genreNames.join(', ') : 'unknown';

  return [
    recent.length > 0
      ? `Movies the user liked, most recent first: ${recent.join(', ')}.`
      : 'The user has not liked anything yet — pitch the candidate on its own merits.',
    `Candidate: "${candidate.title}" (${candidate.year || 'year unknown'}). Genres: ${genres}.`,
  ].join('\n');
}

/** One request. Throws — the retry loop in requestWhy() owns the recovery. */
async function generate(candidate: Movie, likes: Movie[]): Promise<string | null> {
  const result = await gemini.generateContent(
    {
      contents: [{ role: 'user', parts: [{ text: buildPrompt(candidate, likes) }] }],
      systemInstruction: WHY_SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: WHY_SCHEMA,
        temperature: 0.8,
      },
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  // The schema makes this parseable, it does not make it *true*. Nothing from
  // the response is treated as a catalog reference (AGENTS.md §3): we read one
  // free-text field and never a tmdb_id or a title.
  let body: WhyResponse;
  try {
    body = JSON.parse(result.response.text()) as WhyResponse;
  } catch (error) {
    log('response was not JSON', error);
    return null;
  }

  return typeof body.reason === 'string' ? toWhyLine(body.reason) : null;
}

async function requestWhy(candidate: Movie, likes: Movie[]): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    // Re-checked every attempt, not just on the way in: #8 prefetches 2–3 cards
    // at once, so a sibling can hit the wall and open the cooldown while this
    // loop is sleeping. Without this they each spend their remaining retries on
    // a quota we already know is exhausted.
    if (Date.now() < quotaCooldownUntil) return null;
    try {
      return await generate(candidate, likes);
    } catch (error) {
      if (!isRateLimited(error)) {
        log(`whyLine(${candidate.id}) failed`, error);
        return null;
      }
      if (attempt === MAX_RETRIES) {
        quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
        // The reason matters and the three cases look identical from here: a
        // 15 RPM burst clears in a minute, the 1,500/day cap does not clear
        // until tomorrow, and a model with no free-tier quota never clears at
        // all. Scrubbed: the message can quote the request URL.
        log(
          `whyLine(${candidate.id}) rate limited — pausing for ${QUOTA_COOLDOWN_MS}ms: ` +
            scrubbed(error),
        );
        return null;
      }
      // Full jitter, so two cards retrying at once don't collide again.
      await delay(Math.round(BACKOFF_BASE_MS * 2 ** attempt * (0.5 + Math.random() / 2)));
    }
  }
  return null;
}

/**
 * Reel's one-line pitch for `candidate`, given what the user has liked so far.
 *
 * Never throws and never blocks the deck: a quota wall, a dead network or a
 * malformed response all come back as null, and #8 renders the card without the
 * line. The first call for a movie hits the network; every later one is served
 * from memory or disk.
 *
 * Keep this off the swipe gesture path and prefetch only the next 2–3 cards —
 * the free tier is ~1,500 requests a day at 15 RPM, and a 60-card deck would
 * blow the minute quota in one go.
 */
export async function whyLine(candidate: Movie, likes: Movie[]): Promise<string | null> {
  const cached = memoryCache.get(candidate.id);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(candidate.id);
  if (pending) return pending;

  const work = (async (): Promise<string | null> => {
    const stored = await readDisk(candidate.id);
    if (stored) {
      cacheWhyLine(candidate.id, stored);
      return stored;
    }

    // Over quota: answer immediately rather than queue behind a wall we know is
    // there. Not cached, so the next deck pass tries again.
    if (Date.now() < quotaCooldownUntil) return null;

    const line = await requestWhy(candidate, likes);
    if (!line) return null;

    cacheWhyLine(candidate.id, line);
    // Not awaited: the disk copy only matters to a *later* run, and writeDisk
    // swallows its own errors. Awaiting it would hold the line the card is
    // waiting for behind an AsyncStorage bridge call.
    void writeDisk(candidate.id, line);
    return line;
  })().finally(() => {
    inFlight.delete(candidate.id);
  });

  inFlight.set(candidate.id, work);
  return work;
}

/** Test seam. Clears the in-memory cache and the quota cooldown, not the disk. */
export function __resetWhyLineCache(): void {
  memoryCache.clear();
  inFlight.clear();
  quotaCooldownUntil = 0;
}
