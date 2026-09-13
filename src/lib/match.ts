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
import type { Match, Member, Movie, SessionMatch, TasteVector } from '../types';
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

/**
 * Extra swipes demanded of the group after a "Keep swiping" (#97), on top of
 * whatever anyone had already swiped. Without it the fallback re-fires on the
 * very next member snapshot — everyone is already past MIN_SWIPES_FOR_FALLBACK
 * by then — and the group gets the runner-up instantly, having swiped nothing.
 */
export const REMATCH_SWIPES = 8;

/** A group needs at least two people; one person agreeing with themselves is not a match. */
export const MIN_MEMBERS = 2;

export interface MatchOptions {
  /** Override MISERY_FLOOR. */
  floor?: number;
  /** Override MIN_SWIPES_FOR_FALLBACK. Infinity disables the fallback entirely. */
  minSwipes?: number;
  /**
   * tmdbIds the group has already rejected (#97). Dropped from the ranking
   * entirely, so neither the unanimous path nor the fallback can return one.
   */
  exclude?: Iterable<number>;
  /**
   * Raises the fallback's swipe bar without lowering it: the threshold is
   * max(minSwipes, swipeFloor). Set from the match document after a rejection
   * so the group swipes again before the next forced pick.
   */
  swipeFloor?: number;
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
  const excluded = new Set(opts.exclude ?? []);
  const tastes = members.map((member) => memberTaste(member, movies));

  return movies
    .map((movie, index) => {
      // A rejected title leaves the ranking outright, which is what keeps it
      // out of detectMatch's unanimous path too — dropping it from the
      // fallback alone would let a title the whole group liked, and then
      // rejected, re-fire on the very next snapshot.
      if (excluded.has(movie.id)) return null;
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

/** Cards this member has judged, either way. Exported for clearMatch's floor. */
export function swipeCount(member: Member): number {
  return member.likes.length + member.dislikes.length;
}

/**
 * The bar the group must clear before the fallback may fire again, set when a
 * verdict is rejected (#97). Anchored to the member who has swiped *most*, so
 * in a lopsided group the quieter member may owe more than REMATCH_SWIPES —
 * deliberate: a per-uid map would need rebuilding whenever somebody joins, and
 * the ungated unanimous path is the pressure valve either way.
 */
export function nextSwipeFloor(members: Member[]): number {
  return Math.max(0, ...members.map(swipeCount)) + REMATCH_SWIPES;
}

/**
 * The title the group has landed on, or null if it hasn't yet.
 *
 * Two ways to cross the bar, in priority order:
 *   1. Every member swiped right on the same surviving title — the mutual like.
 *   2. Everyone has swiped `minSwipes` cards and still never agreed, so the
 *      top survivor takes it.
 *
 * Both draw from rankGroup(), so neither a vetoed title nor one the group has
 * already rejected via `opts.exclude` can be returned by either path. Only
 * path 2 is held back by `opts.swipeFloor`: a group that genuinely agrees on
 * something new should not have to swipe out a penalty first (#97).
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

  // The floor raises the bar, never lowers it: a session that has never had a
  // rejection carries swipeFloor 0 and behaves exactly as it did before (#97).
  const minSwipes = Math.max(opts.minSwipes ?? MIN_SWIPES_FOR_FALLBACK, opts.swipeFloor ?? 0);
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
 * The session's verdict document, with the round bookkeeping (#97) defaulted.
 *
 * The defaults are load-bearing, not hygiene: a document written before rounds
 * existed carries none of these fields, and it has to read back as a *live,
 * uncleared round 1* or the reveal on an in-flight session would vanish the
 * moment this ships.
 */
function toSessionMatch(data: DocumentData | undefined): SessionMatch | null {
  const base = toMatch(data);
  if (!base) return null;
  return {
    ...base,
    round: typeof data?.round === 'number' && data.round > 0 ? data.round : 1,
    rejected: Array.isArray(data?.rejected)
      ? data.rejected.filter((id: unknown): id is number => Number.isInteger(id))
      : [],
    cleared: data?.cleared === true,
    swipeFloor: typeof data?.swipeFloor === 'number' ? data.swipeFloor : 0,
  };
}

/** The verdict as a Saved-tab row: the round fields have no business there. */
function toSavedMatch(match: SessionMatch): Match {
  return {
    tmdbId: match.tmdbId,
    sessionCode: match.sessionCode,
    matchedAt: match.matchedAt,
    ...(match.why ? { why: match.why } : {}),
  };
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
 * @returns the verdict that is actually in the document — `movie` when this
 *          call claimed it, the other device's title when it adopted one. A
 *          caller that goes on to describe the match must describe *this*,
 *          never the title it walked in with.
 */
export async function claimMatch(
  code: string,
  movie: Movie,
  members: Member[],
): Promise<SessionMatch> {
  const normalized = normalizeCode(code);

  const claimed = await runTransaction(db, async (tx) => {
    const existing = await tx.get(matchRef(normalized));
    const previous = existing.exists() ? toSessionMatch(existing.data()) : null;

    // Somebody holds the current round. Adopt their verdict rather than
    // writing our own — this is what stops two phones revealing two films.
    if (previous && !previous.cleared) return previous;

    // The round is derived here, inside the transaction, from what the
    // document actually says — never from a number the caller walked in with.
    // A device whose last snapshot was a round behind would otherwise re-write
    // a round number that is already taken, and the reveal's remount key
    // (MatchOverlay keys on the round) would stop changing.
    const match: SessionMatch = {
      tmdbId: movie.id,
      sessionCode: normalized,
      matchedAt: Date.now(),
      round: (previous?.round ?? 0) + 1,
      rejected: previous?.rejected ?? [],
      cleared: false,
      swipeFloor: previous?.swipeFloor ?? 0,
    };
    // set, not update: the previous round's `why` must not survive into this
    // one, or the group reveals a new film under a sentence about the film
    // they just rejected.
    tx.set(matchRef(normalized), match);
    return match;
  });

  console.log('[match] session', normalized, 'round', claimed.round, 'matched tmdbId', claimed.tmdbId);
  await writeMemberMatches(
    toSavedMatch(claimed),
    members.map((member) => member.uid),
  );

  return claimed;
}

/**
 * Patches #21's compromise line onto a verdict that is still the current one.
 *
 * Guarded on the round *and* the title, because the gap between claiming and
 * Gemini answering is seconds long and the group can reject and re-match
 * inside it. An unguarded patch would then put round N's sentence under round
 * N+1's poster — a real film described by a real line about a different film,
 * which is exactly the failure the validation rule exists to prevent.
 *
 * A no-op when the round has moved on. Never throws.
 */
export async function attachWhy(
  code: string,
  round: number,
  tmdbId: number,
  why: string,
  members: Member[],
): Promise<void> {
  const normalized = normalizeCode(code);

  const patched = await runTransaction(db, async (tx) => {
    const existing = await tx.get(matchRef(normalized));
    const current = existing.exists() ? toSessionMatch(existing.data()) : null;
    if (!current || current.cleared || current.round !== round || current.tmdbId !== tmdbId) {
      return null;
    }
    // Already explained by whoever claimed it. Overwriting would spend a
    // write to replace one valid line with another.
    if (current.why) return null;
    tx.update(matchRef(normalized), { why });
    return { ...current, why };
  }).catch((error: unknown) => {
    console.warn('[match] could not attach the why line:', error);
    return null;
  });

  if (!patched) return;

  // The line is part of the verdict, so the Saved rows want it too — merged
  // onto the rows claimMatch() already wrote. Best effort; the reveal itself
  // reads the line straight off the document listener.
  await writeMemberMatches(
    toSavedMatch(patched),
    members.map((member) => member.uid),
  );
}

/**
 * "Keep swiping" (#97): the group passes on this verdict and carries on.
 *
 * Shared, not local — it writes to the one document every device reveals off,
 * so one press clears the reveal on every phone. The title joins `rejected`
 * for the rest of the session and the fallback is held back by a fresh
 * `swipeFloor` so the runner-up does not fire on the very next snapshot.
 *
 * A transaction rather than a blind update, and guarded on the round, for two
 * reasons that both show up in a live demo: the button gets double-tapped
 * while the write is in flight, and two phones press it within the same
 * second. Either way the second call reads `cleared` and does nothing, so the
 * round advances once and `swipeFloor` is written once — a blind update would
 * let a stale clear land on a round nobody rejected.
 *
 * Never throws: a failed clear leaves the reveal up, which is the honest
 * outcome, and the caller re-enables its button.
 */
export async function clearMatch(
  code: string,
  round: number,
  tmdbId: number,
  members: Member[],
): Promise<void> {
  const normalized = normalizeCode(code);
  try {
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(matchRef(normalized));
      const current = existing.exists() ? toSessionMatch(existing.data()) : null;
      if (!current || current.cleared || current.round !== round) return;

      // Computed explicitly rather than with arrayUnion(): the value is
      // already in hand from the read, and a sentinel would be one more thing
      // for every caller and test double to understand.
      const rejected = current.rejected.includes(tmdbId)
        ? current.rejected
        : [...current.rejected, tmdbId];

      tx.update(matchRef(normalized), {
        cleared: true,
        rejected,
        swipeFloor: nextSwipeFloor(members),
      });
    });
    console.log('[match] session', normalized, 'rejected tmdbId', tmdbId, '— round', round);
  } catch (error) {
    console.warn('[match] could not clear the match:', error);
  }
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
 * Takes a rejected verdict back off the signed-in user's Saved tab (#97).
 *
 * The rows are written the moment a match is claimed, so without this a group
 * that rejects three titles leaves four rows behind — three of them films the
 * group explicitly said no to — on the screen that closes the demo (#42).
 *
 * Each device does this for itself: the rules only allow deleting your own
 * row, which is stricter than the write path but also means a member who was
 * offline for the clear still tidies up when they come back. Never throws.
 */
export async function removeMatchForCurrentUser(
  sessionCode: string,
  tmdbId: number,
): Promise<void> {
  try {
    const user = await ensureAnonymousUser();
    await removeUserMatch(user.uid, sessionCode, tmdbId);
  } catch (error) {
    console.warn('[match] could not drop the rejected match:', error);
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
export function subscribeMatch(
  code: string,
  cb: (match: SessionMatch | null) => void,
): Unsubscribe {
  const normalized = normalizeCode(code);
  let saved = '';
  /** Rejected ids this device has already tidied, so it does not retry forever. */
  const dropped = new Set<number>();

  return onSnapshot(
    matchRef(normalized),
    (snapshot) => {
      const match = snapshot.exists() ? toSessionMatch(snapshot.data()) : null;

      if (match) {
        // Everything the group has passed on comes off this device's Saved
        // tab. Driven off the cumulative `rejected` list rather than off the
        // clear event, so a device that was closed or offline when the group
        // rejected something still reconciles on its next snapshot.
        for (const id of match.rejected) {
          if (dropped.has(id)) continue;
          dropped.add(id);
          void removeMatchForCurrentUser(match.sessionCode, id);
        }

        // A cleared document names a title the group has rejected, so there is
        // nothing to save from it. Keyed by round as well as title: the why
        // line lands as a second snapshot and has to reach the row too.
        const key = `${match.sessionCode}-${match.round}-${match.tmdbId}-${match.why ? 1 : 0}`;
        if (!match.cleared && saved !== key) {
          saved = key;
          void saveMatchForCurrentUser(toSavedMatch(match));
        }
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
   *
   * `movie` is the title the *document* names, which is not always the one this
   * device detected — see watchForMatch below. Describe what you are handed.
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
  cb: (match: SessionMatch | null) => void,
  opts: WatchMatchOptions = {},
): Unsubscribe {
  const normalized = normalizeCode(code);
  const catalog = typeof movies === 'function' ? movies : () => movies;
  // Member snapshots arrive faster than a transaction round-trips, so without
  // this the same match is claimed several times over.
  let claiming = false;
  let claimedRound = 0;
  /**
   * The last document this device saw. Detection is gated on it rather than on
   * a latch of its own (#97): while any device can still see a reveal the
   * document reads `cleared: false`, so every device that has received it is
   * blocked, and the window to detect the next match opens on all of them only
   * once the cleared snapshot has fanned out. `rejected` and `swipeFloor` are
   * read from here too, so they can never go stale the way an option captured
   * at subscribe time would.
   */
  let current: SessionMatch | null = null;

  const stopMatch = subscribeMatch(normalized, (match) => {
    current = match;
    // A cleared round releases the claim guard so this device can compete for
    // the next one — but only once the clear is at least as new as our own
    // last claim, or a stale snapshot would unlatch us mid-transaction.
    if (match?.cleared && match.round >= claimedRound) claiming = false;
    cb(match);
  });

  const stopMembers = subscribeMembers(normalized, (members) => {
    if (claiming) return;
    // A live, uncleared verdict is on screen: nothing to detect.
    if (current && !current.cleared) return;

    const winner = detectMatch(members, catalog(), {
      ...opts,
      exclude: [...(opts.exclude ?? []), ...(current?.rejected ?? [])],
      swipeFloor: Math.max(opts.swipeFloor ?? 0, current?.swipeFloor ?? 0),
    });
    if (!winner) return;

    claiming = true;
    void (async () => {
      try {
        // What the *document* ended up naming, which is not always `winner`:
        // the transaction adopts another device's verdict when that device
        // claimed first, and two devices a snapshot apart can detect two
        // different titles. Everything after this point follows the document.
        const claimed = await claimMatch(normalized, winner, members);
        claimedRound = claimed.round;

        // Already explained by whoever claimed it — asking again would spend a
        // request from a 15 RPM budget to produce a line the transaction will
        // discard anyway.
        if (claimed.why) return;

        const film =
          claimed.tmdbId === winner.id
            ? winner
            : catalog().find((movie) => movie.id === claimed.tmdbId);
        // The adopted title is missing from this device's catalog, so there is
        // nothing here to describe it with. The device that claimed it has the
        // title and writes the line; this one reveals off the document.
        if (!film) return;

        const why = await opts.onDetect?.(film, members);
        // Round-scoped: the group can reject and re-match while Gemini is
        // answering, and this line describes the round we claimed, not
        // whatever is on screen by the time it lands.
        if (why) await attachWhy(normalized, claimed.round, claimed.tmdbId, why, members);
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
