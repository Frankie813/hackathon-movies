// lib/session.ts — group sessions over Firestore realtime (issue #16).
//
// The whole group demo hangs off this file: two phones, one 4-letter code, a
// member list that updates live, and swipes that land in Firestore fast enough
// that the second phone reacts while the judge is still watching the first.
//
// Data model
//   sessions/{code}                  { code, hostUid, createdAt }
//   sessions/{code}/members/{uid}    { likes[], dislikes[], joinedAt, name?, left? }
//
// The member doc is keyed by the anonymous uid (#2), which is what makes rejoin
// idempotent: the same guest coming back writes the same document instead of
// spawning a second member. #17 reads Member[] from subscribe() to rank the
// group; nothing here knows anything about scoring.

import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';

import type { Member, Session, SwipeDirection } from '@/types';

import { ensureAnonymousUser } from './auth';
import { db } from './firebase';

/**
 * Consonants only. A code can never accidentally spell a word in front of
 * judges, and dropping the vowels also removes most of the confusable pairs.
 * 20 letters ^ 4 = 160,000 codes, which is more than a hackathon needs.
 */
export const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 4;

const SESSIONS = 'sessions';
const MEMBERS = 'members';

/** Thrown by joinSession() when the code doesn't exist — the join screen shows this. */
export class SessionNotFoundError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`No session with code ${code}. Check the code and try again.`);
    this.name = 'SessionNotFoundError';
    this.code = code;
  }
}

/** Uppercases and strips anything that can't appear in a code. For text inputs. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((char) => CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, CODE_LENGTH);
}

/**
 * True when the input is a code and nothing else. Surrounding whitespace is
 * forgiven — a code pasted out of a QR payload or a deep link (#19) arrives
 * with it — but extra characters are not, because normalizeCode() would
 * silently truncate them into a different, valid-looking code.
 */
export function isValidCode(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.length === CODE_LENGTH && normalizeCode(trimmed).length === CODE_LENGTH;
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function sessionRef(code: string) {
  return doc(db, SESSIONS, code);
}

function membersRef(code: string) {
  return collection(db, SESSIONS, code, MEMBERS);
}

function memberRef(code: string, uid: string) {
  return doc(db, SESSIONS, code, MEMBERS, uid);
}

/**
 * serverTimestamp() resolves to null in the writer's own local snapshot until
 * the server acknowledges it (latency compensation), so every read has to cope
 * with a missing timestamp rather than trusting it.
 */
function toMillis(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toMillis' in value &&
    typeof (value as { toMillis: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

function toIdArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number') : [];
}

// The Firestore adapter always normalizes joinedAt, even though the shared
// Member contract permits callers without session metadata.
function toMember(uid: string, data: DocumentData): Member & { joinedAt: number } {
  const member: Member & { joinedAt: number } = {
    uid,
    likes: toIdArray(data.likes),
    dislikes: toIdArray(data.dislikes),
    // 0 sorts a not-yet-acknowledged join to the front of the list, which is
    // where a member who just appeared belongs anyway.
    joinedAt: toMillis(data.joinedAt, 0),
  };
  if (typeof data.name === 'string' && data.name.length > 0) member.name = data.name;
  return member;
}

/** The label the member list shows. Keeps the uid fallback in one place. */
export function memberLabel(member: Member): string {
  return member.name ?? `Guest ${member.uid.slice(0, 4).toUpperCase()}`;
}

/**
 * Creates a session and joins the caller to it as the host.
 *
 * The host is added as a member here rather than being left to the caller —
 * a host missing from sessions/{code}/members is invisible to #17's ranking,
 * and that failure only shows up at match time. Calling joinSession() again
 * afterwards is harmless.
 *
 * @returns the 4-letter code to put on screen.
 */
export async function createSession(name?: string): Promise<string> {
  const user = await ensureAnonymousUser();

  // Collisions are ~1 in 160k, but a rehearsal that reuses a live code would
  // silently drop two groups into one session. Cheap to rule out.
  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomCode();
    const existing = await getDoc(sessionRef(candidate));
    if (!existing.exists()) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new Error('Could not allocate an unused session code. Try again.');

  const session: Omit<Session, 'createdAt'> = { code, hostUid: user.uid };
  await setDoc(sessionRef(code), { ...session, createdAt: serverTimestamp() });
  await joinSession(code, name);

  console.log('[session] created', code);
  return code;
}

/**
 * Joins sessions/{code} as the current anonymous user.
 *
 * Idempotent by design: rejoining writes `name` but never touches likes or
 * dislikes, so a guest who backgrounds the app and comes back keeps every
 * swipe they made. The read-then-write runs in a transaction so two joins
 * racing each other can't both decide the member is new and blank the arrays.
 *
 * @throws SessionNotFoundError if the code doesn't exist.
 */
export async function joinSession(code: string, name?: string): Promise<void> {
  const user = await ensureAnonymousUser();
  const normalized = normalizeCode(code);

  await runTransaction(db, async (tx) => {
    const session = await tx.get(sessionRef(normalized));
    if (!session.exists()) throw new SessionNotFoundError(normalized);

    const member = await tx.get(memberRef(normalized, user.uid));
    if (member.exists()) {
      // Rejoin: leave likes/dislikes/joinedAt exactly as they are. A member
      // who left (#101) is back in the list for everyone once `left` goes.
      const update: DocumentData = {};
      if (name) update.name = name;
      if (member.data().left) update.left = deleteField();
      if (Object.keys(update).length > 0) tx.update(memberRef(normalized, user.uid), update);
      return;
    }

    tx.set(memberRef(normalized, user.uid), {
      uid: user.uid,
      likes: [],
      dislikes: [],
      joinedAt: serverTimestamp(),
      ...(name ? { name } : {}),
    });
  });

  console.log('[session] joined', normalized, 'as', user.uid);
}

/**
 * Records one swipe on the caller's member doc, immediately.
 *
 * Deliberately unbatched and undebounced: the second phone reacting inside a
 * second is the demo beat, and arrayUnion writes are small. (#18 debounces the
 * *taste vector*, which is a different document and a different concern.)
 *
 * Swiping the other way on a title moves it between the arrays instead of
 * leaving it in both — a stale dislike is a veto that would quietly sink a
 * title in #17's Average-without-Misery ranking.
 */
export async function recordSwipe(
  code: string,
  movieId: number,
  dir: SwipeDirection,
): Promise<void> {
  const user = await ensureAnonymousUser();
  const normalized = normalizeCode(code);
  const update =
    dir === 'right'
      ? { likes: arrayUnion(movieId), dislikes: arrayRemove(movieId) }
      : { dislikes: arrayUnion(movieId), likes: arrayRemove(movieId) };

  try {
    await updateDoc(memberRef(normalized, user.uid), update);
  } catch (error) {
    // updateDoc on a missing doc fails with 'not-found'. That happens if the
    // deck outruns the join, or after a rejoin against a wiped emulator —
    // recover instead of dropping the swipe on the floor.
    if (!isNotFound(error)) throw error;
    await joinSession(normalized);
    await updateDoc(memberRef(normalized, user.uid), update);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'not-found'
  );
}

/**
 * Leaves a session for everyone, not just this device (#101): the member doc
 * is flagged `left`, which drops it from every other phone's subscribe() list
 * and from #17's ranking on the next snapshot.
 *
 * Flagged, not deleted, so the swipes survive: joining the same code again is
 * still a rejoin that picks up where the member left off (see joinSession).
 * A member doc that is already gone is not an error — there is nothing left
 * to leave.
 */
export async function leaveSession(code: string): Promise<void> {
  const user = await ensureAnonymousUser();
  const normalized = normalizeCode(code);
  try {
    await updateDoc(memberRef(normalized, user.uid), { left: true });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  console.log('[session] left', normalized, 'as', user.uid);
}

/**
 * Live member list for a session. #17 consumes this to rank the group; the
 * group screen renders it so both phones can see each other. Members who left
 * (#101) are not in it.
 *
 * Members arrive sorted by join time so the list doesn't reshuffle under the
 * judge's eyes on every snapshot.
 *
 * @returns the Firestore unsubscribe — call it on unmount or listeners leak
 *          across rehearsal runs.
 */
export function subscribe(code: string, cb: (members: Member[]) => void): Unsubscribe {
  const normalized = normalizeCode(code);

  return onSnapshot(
    membersRef(normalized),
    (snapshot) => {
      const members = snapshot.docs
        .filter((docSnap) => docSnap.data().left !== true)
        .map((docSnap) => toMember(docSnap.id, docSnap.data()))
        .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.uid.localeCompare(b.uid));
      cb(members);
    },
    (error) => {
      console.warn('[session] member listener failed:', error.message);
    },
  );
}

/** Reads the session document once. Returns null if the code is unused. */
export async function getSession(code: string): Promise<Session | null> {
  const snapshot = await getDoc(sessionRef(normalizeCode(code)));
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  return {
    code: snapshot.id,
    hostUid: typeof data.hostUid === 'string' ? data.hostUid : '',
    createdAt: toMillis(data.createdAt, 0),
  };
}
