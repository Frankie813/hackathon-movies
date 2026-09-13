// src/lib/match.ts — group consensus and the match event (issue #17).
//
// Step 4 of the demo path: two phones swipe, a title clears the bar, and
// "It's a Match!" fires on both at once. Everything here is driven by one
// Firestore document — sessions/{code}/match/current. A device never reveals
// off its own local swipe; it reveals because the document appeared. That is
// what keeps the two phones in sync when one of them is a beat behind.
//
// Data model (rules live in firestore.rules)
//   sessions/{code}/match/current     { tmdbId, sessionCode, matchedAt, why? }
//   users/{uid}/matches/{code}-{id}   same shape — #41's Saved tab reads these
//
// rankGroup() and detectMatch() are pure: no Firestore, no network, no clock.
// They are the half that has to keep working when the venue Wi-Fi dies
// (PLAN.md §L), so the seed catalog plus a cached member list is enough to
// reach a verdict offline.

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';

import { ensureAnonymousUser } from '../../lib/auth';
import { db } from '../../lib/firebase';
import { normalizeCode, subscribe as subscribeMembers } from '../../lib/session';
import type { Match, Member, Movie, TasteVector } from '../types';
import { applySwipe, score } from './taste';

/**
 * Average-without-Misery floor. A title whose predicted score for *any* member
 * falls below this is dropped outright rather than averaged away — one person
 * hating the film is not something a high mean from everyone else should be
 * able to buy off. 0 is neutral, so an unseen title at cold start survives.
 */
export const MISERY_FLOOR = 0;

/**
 * Fallback trigger: once every member has swiped this many cards without ever
 * landing on the same title, the top survivor wins. Without it a group with
 * divergent taste swipes forever and the demo has no step 4.
 */
export const MIN_SWIPES_FOR_FALLBACK = 8;

/** A group needs at least two people; one person agreeing with themselves is not a match. */
export const MIN_MEMBERS = 2;

export interface MatchOptions {
  /** Override MISERY_FLOOR. */
  floor?: number;
  /** Override MIN_SWIPES_FOR_FALLBACK. Infinity disables the fallback entirely. */
  minSwipes?: number;
}

const SESSIONS = 'sessions';
const MATCH = 'match';
/** Fixed id, so "has this session already matched?" is a single-document check. */
const MATCH_DOC = 'current';
const USERS = 'users';
const MATCHES = 'matches';

// ---------------------------------------------------------------------------
// Pure ranking
// ---------------------------------------------------------------------------

/**
 * The taste vector to score a member's candidates against.
 *
 * Prefers the vector #18 persists. Falls back to replaying the member's swipes
 * from the session document against the catalog, which is what makes this work
 * today: sessions/{code}/members holds likes[] and dislikes[] and nothing else,
 * and a guest who has never had a vector synced still has to be rankable.
 */
export function memberTaste(member: Member, movies: Movie[]): TasteVector {
  if (member.taste && Object.keys(member.taste).length > 0) return member.taste;

  const byId = new Map(movies.map((movie) => [movie.id, movie]));
  let vector: TasteVector = {};
  for (const id of member.likes) {
    const movie = byId.get(id);
    if (movie) vector = applySwipe(vector, movie, 'right');
  }
  for (const id of member.dislikes) {
    const movie = byId.get(id);
    if (movie) vector = applySwipe(vector, movie, 'left');
  }
  return vector;
}

/**
 * True when this member's opinion disqualifies the title for the whole group.
 *
 * An explicit swipe outranks the model in both directions. A left swipe is an
 * absolute veto — that is the AC — and a right swipe can never be turned into
 * a veto by a predicted score, which would otherwise happen to a member who
 * liked one horror film after disliking three others.
 */
function vetoes(member: Member, movie: Movie, taste: TasteVector, floor: number): boolean {
  if (member.likes.includes(movie.id)) return false;
  if (member.dislikes.includes(movie.id)) return true;
  return score(taste, movie) < floor;
}

/**
 * Average-without-Misery: drop every title any member vetoed, then rank the
 * survivors by mean predicted score, tie-broken by how many members explicitly
 * liked it. Ties beyond that retain input order, so the ranking is stable.
 *
 * @returns the survivors, best first. A vetoed title is absent, never last.
 */
export function rankGroup(members: Member[], movies: Movie[], opts: MatchOptions = {}): Movie[] {
  const floor = opts.floor ?? MISERY_FLOOR;
  const tastes = members.map((member) => memberTaste(member, movies));

  return movies
    .map((movie, index) => {
      let total = 0;
      let likes = 0;
      for (let i = 0; i < members.length; i += 1) {
        const member = members[i];
        if (vetoes(member, movie, tastes[i], floor)) return null;
        total += score(tastes[i], movie);
        if (member.likes.includes(movie.id)) likes += 1;
      }
      return { movie, index, mean: members.length > 0 ? total / members.length : 0, likes };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.mean - a.mean || b.likes - a.likes || a.index - b.index)
    .map((entry) => entry.movie);
}

function swipeCount(member: Member): number {
  return member.likes.length + member.dislikes.length;
}

/**
 * The title the group has landed on, or null if it hasn't yet.
 *
 * Two ways to cross the bar, in priority order:
 *   1. Every member swiped right on the same surviving title — the mutual like.
 *   2. Everyone has swiped `minSwipes` cards and still never agreed, so the
 *      top survivor takes it.
 *
 * Both draw from rankGroup(), so a vetoed title can never be returned by
 * either path.
 *
 * Pure and cheap — safe to call on every member snapshot. When it returns
 * non-null, fire #21's Gemini compromise call here at *detection* time, not
 * when the reveal mounts, so the `why` text is on screen with the verdict.
 */
export function detectMatch(
  members: Member[],
  movies: Movie[],
  opts: MatchOptions = {},
): Movie | null {
  if (members.length < MIN_MEMBERS) return null;

  const survivors = rankGroup(members, movies, opts);
  if (survivors.length === 0) return null;

  const unanimous = survivors.find((movie) =>
    members.every((member) => member.likes.includes(movie.id)),
  );
  if (unanimous) return unanimous;

  const minSwipes = opts.minSwipes ?? MIN_SWIPES_FOR_FALLBACK;
  if (members.every((member) => swipeCount(member) >= minSwipes)) return survivors[0];

  return null;
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------

function matchRef(code: string) {
  return doc(db, SESSIONS, code, MATCH, MATCH_DOC);
}

/** One doc per (session, title): a rewrite is idempotent and a later session keeps its own row. */
function userMatchRef(uid: string, code: string, tmdbId: number) {
  return doc(db, USERS, uid, MATCHES, `${code}-${tmdbId}`);
}

function userMatchesRef(uid: string) {
  return collection(db, USERS, uid, MATCHES);
}

/** Defensive read — a remote document is untrusted input, not a Match. */
function toMatch(data: DocumentData | undefined): Match | null {
  if (!data || typeof data.tmdbId !== 'number' || typeof data.sessionCode !== 'string') return null;
  const match: Match = {
    tmdbId: data.tmdbId,
    sessionCode: data.sessionCode,
    matchedAt: typeof data.matchedAt === 'number' ? data.matchedAt : 0,
  };
  if (typeof data.why === 'string' && data.why.length > 0) match.why = data.why;
  return match;
}

/**
 * Writes the group's verdict and fans it out to every member's Saved tab.
 *
 * Double-fire guard: the session match document is claimed in a transaction and
 * never overwritten. Both phones may well detect the same match in the same
 * tick; the first write wins and the loser adopts it, so the two devices can
 * never reveal two different films. If the winner picked a different title —
 * possible when the devices are a snapshot apart — the member documents follow
 * the document, not the local call.
 *
 * `matchedAt` is client epoch-ms rather than serverTimestamp() on purpose:
 * serverTimestamp() reads back null in the writer's own snapshot until the
 * server acknowledges it, and the reveal renders off that first local snapshot.
 *
 * @param why optional compromise line from #21, if it resolved before this call.
 */
export async function persistMatch(
  code: string,
  movie: Movie,
  members: Member[],
  why?: string,
): Promise<void> {
  const normalized = normalizeCode(code);

  const claimed = await runTransaction(db, async (tx) => {
    const existing = await tx.get(matchRef(normalized));
    const previous = existing.exists() ? toMatch(existing.data()) : null;
    if (previous) {
      // Somebody beat us to it. Add the `why` if we have one and it doesn't.
      if (why && !previous.why) {
        tx.update(matchRef(normalized), { why });
        return { ...previous, why };
      }
      return previous;
    }

    const match: Match = {
      tmdbId: movie.id,
      sessionCode: normalized,
      matchedAt: Date.now(),
      ...(why ? { why } : {}),
    };
    tx.set(matchRef(normalized), match);
    return match;
  });

  console.log('[match] session', normalized, 'matched tmdbId', claimed.tmdbId);
  await writeMemberMatches(
    claimed,
    members.map((member) => member.uid),
  );
}

/**
 * Copies the verdict into each member's users/{uid}/matches.
 *
 * Best effort per member: one uid failing (a rules change, a member who left)
 * must not take down the reveal that is already on screen. Failures are logged
 * loudly rather than swallowed, and subscribeMatch() writes each device's own
 * document as a second chance, so a member normally ends up with a row even if
 * the detecting device could not write it for them.
 */
async function writeMemberMatches(match: Match, uids: string[]): Promise<void> {
  const unique = [...new Set(uids)];
  const payload = {
    tmdbId: match.tmdbId,
    sessionCode: match.sessionCode,
    matchedAt: match.matchedAt,
    ...(match.why ? { why: match.why } : {}),
  };

  const results = await Promise.allSettled(
    unique.map((uid) =>
      setDoc(userMatchRef(uid, match.sessionCode, match.tmdbId), payload, { merge: true }),
    ),
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(`[match] could not save match for ${unique[index]}:`, result.reason);
    }
  });
}

/** Saves the verdict to the signed-in user's own Saved tab. Never throws. */
export async function saveMatchForCurrentUser(match: Match): Promise<void> {
  try {
    const user = await ensureAnonymousUser();
    await writeMemberMatches(match, [user.uid]);
  } catch (error) {
    console.warn('[match] could not save own match:', error);
  }
}

/**
 * Live subscription to the group's verdict — the match *event*.
 *
 * This is what #10's reveal mounts on, and it is the only thing that should
 * make a device say "It's a Match!". Fires immediately with null when no match
 * exists yet, then once the document lands, on every device in the session.
 *
 * Also writes the viewing device's own users/{uid}/matches row, so a member
 * whose document the detecting device could not write still gets one.
 *
 * @returns the Firestore unsubscribe — call it on unmount or listeners leak.
 */
export function subscribeMatch(code: string, cb: (match: Match | null) => void): Unsubscribe {
  const normalized = normalizeCode(code);
  let saved = '';

  return onSnapshot(
    matchRef(normalized),
    (snapshot) => {
      const match = snapshot.exists() ? toMatch(snapshot.data()) : null;
      if (match && saved !== `${match.sessionCode}-${match.tmdbId}`) {
        saved = `${match.sessionCode}-${match.tmdbId}`;
        void saveMatchForCurrentUser(match);
      }
      cb(match);
    },
    (error) => {
      console.warn('[match] match listener failed:', error.message);
    },
  );
}

/**
 * Live view of every group match written to this user — #41's Saved tab.
 *
 * Every member's users/{uid}/matches row is written by writeMemberMatches()
 * (best effort, from whichever device claims the match) and backstopped by
 * subscribeMatch()'s own save on each viewing device, so this fires for every
 * member after the reveal, which is the second AC.
 *
 * Fires with `[]` and returns a no-op unsubscribe when there is no uid yet.
 *
 * @returns the Firestore unsubscribe — call it on unmount or listeners leak.
 */
export function subscribeUserMatches(uid: string, cb: (matches: Match[]) => void): Unsubscribe {
  if (!uid) {
    cb([]);
    return () => {};
  }

  return onSnapshot(
    query(userMatchesRef(uid), orderBy('matchedAt', 'desc')),
    (snapshot) => {
      cb(
        snapshot.docs
          .map((docSnap) => toMatch(docSnap.data()))
          .filter((match): match is Match => match !== null),
      );
    },
    (error) => {
      console.warn('[match] user matches listener failed:', error.message);
    },
  );
}

/**
 * Drops one match from this user's own Saved tab — long-press to remove
 * (#41). Only this user's row; the session's shared match document and the
 * other members' Saved tabs are untouched. Never throws.
 */
export async function removeUserMatch(
  uid: string,
  sessionCode: string,
  tmdbId: number,
): Promise<void> {
  if (!uid) return;
  try {
    await deleteDoc(userMatchRef(uid, normalizeCode(sessionCode), tmdbId));
  } catch (error) {
    console.warn('[match] could not remove match:', error);
  }
}

export interface WatchMatchOptions extends MatchOptions {
  /**
   * Fired once, on the device that detects the match, with the verdict and the
   * member list that produced it. This is #21's hook for the Gemini compromise
   * line: resolve a string and it is patched onto the match document, which
   * pushes it to every device.
   *
   * It runs *after* the match document is claimed, not before. Awaiting Gemini
   * first would hold the reveal on both phones for the length of the round
   * trip; this way the verdict is on screen immediately and the `why` arrives
   * behind it, so #10 should render a placeholder for a match without one.
   */
  onDetect?: (movie: Movie, members: Member[]) => Promise<string | undefined> | string | undefined;
}

/**
 * The whole of step 4 in one call: watch the group, detect the match, write it,
 * and report it back off the document.
 *
 * `cb` fires from the match document only — never from this device's own
 * detection — so both phones reveal the same film off the same source of truth
 * even though only one of them did the writing.
 *
 * @param movies the catalog to rank, or a function returning it. Pass the
 *        function form when the catalog grows during the session (the live
 *        deck, #13's seeding): it is read on every member snapshot, so a title
 *        that arrived after subscribing is still detectable.
 * @returns an unsubscribe that detaches both listeners. Call it on unmount.
 */
export function watchForMatch(
  code: string,
  movies: Movie[] | (() => Movie[]),
  cb: (match: Match | null) => void,
  opts: WatchMatchOptions = {},
): Unsubscribe {
  const normalized = normalizeCode(code);
  const catalog = typeof movies === 'function' ? movies : () => movies;
  // Member snapshots arrive faster than a transaction round-trips, so without
  // this the same match is claimed several times over.
  let claiming = false;
  let matched = false;

  const stopMatch = subscribeMatch(normalized, (match) => {
    if (match) matched = true;
    cb(match);
  });

  const stopMembers = subscribeMembers(normalized, (members) => {
    if (matched || claiming) return;

    const winner = detectMatch(members, catalog(), opts);
    if (!winner) return;

    claiming = true;
    void (async () => {
      try {
        await persistMatch(normalized, winner, members);
        const why = await opts.onDetect?.(winner, members);
        if (why) await persistMatch(normalized, winner, members, why);
      } catch (error) {
        console.warn('[match] could not claim the match:', error);
        claiming = false; // Let the next member snapshot try again.
      }
    })();
  });

  return () => {
    stopMatch();
    stopMembers();
  };
}
