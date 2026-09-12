// types/session.ts — group session shapes (PLAN.md §H, issues #16, #17).
//
// Timestamps are epoch milliseconds, not Firestore Timestamps, so that #12 and
// #17 stay pure and testable with no firebase import. Convert at the Firestore
// boundary in #16 (`.toMillis()` on read, `serverTimestamp()` on write).

import type { TasteVector } from './taste';

/**
 * One person in a group session, at sessions/{code}/members/{uid}.
 * #16 writes it, #17 reads a Member[] to rank the group.
 */
export interface Member {
  uid: string;
  /** Display label for the member list. Falls back to a uid prefix if unset. */
  name?: string;
  /** TMDB ids swiped right. */
  likes: number[];
  /** TMDB ids swiped left — the veto set Average-without-Misery drops on. */
  dislikes: number[];
  joinedAt: number;
  /**
   * Optional: #17 can either read this or rebuild it from likes/dislikes with
   * applySwipe(). Carrying it avoids replaying every swipe on every snapshot.
   */
  taste?: TasteVector;
}

/** The session document at sessions/{code}. Created by #16. */
export interface Session {
  /** 4 uppercase consonants — no vowels, so a code can't spell a word. */
  code: string;
  hostUid: string;
  createdAt: number;
}

/**
 * The group's decision. Written by #17 to the session AND to every member's
 * users/{uid}/matches so #41's Saved tab shows it for everyone. The document is
 * the single source of truth — devices react to it, never to a local swipe.
 */
export interface Match {
  /** TMDB id. Must resolve against the catalog before anything renders it. */
  tmdbId: number;
  sessionCode: string;
  matchedAt: number;
  /**
   * Gemini's one-liner and the script Reel speaks (#21, #35). Optional because
   * the reveal must render before — and without — the LLM round trip.
   */
  why?: string;
  narration?: string;
}
