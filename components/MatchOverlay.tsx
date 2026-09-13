// components/MatchOverlay.tsx — steps 4 and 5 of the demo path, wired.
//
// Mounted once over the tab navigator. Whenever this device is in a session
// it watches the group (#17): the first device to detect a match claims the
// match document, asks Gemini for the compromise line (#21) and patches it
// on; every device — this one included — reveals off that document, so both
// phones say the same thing at the same time.
//
// The full celebratory screen (#10) lives in MatchReveal.tsx; this file only
// watches the group and resolves the data it needs.

import { useCallback, useEffect, useState } from 'react';

import { useRouter } from 'expo-router';

import { useActiveCode } from '@/lib/active-session';
import { useAnonymousAuth } from '@/lib/auth';
import { getMovie, knownMovies } from '@/lib/tmdb';
import { explainPick } from '@/src/lib/gemini';
import { clearMatch, watchForMatch } from '@/src/lib/match';
import type { Member, Movie, SessionMatch } from '@/types';

import { MatchReveal } from './MatchReveal';

/**
 * Keyed by round rather than by title (#97). A session can now produce several
 * verdicts, and the round is the honest identity of each: it also gives
 * MatchReveal a clean remount per round, which restarts the entrance animation
 * and the why-line timeout instead of reusing round 1's finished ones.
 */
function matchKey(match: SessionMatch): string {
  return `${match.sessionCode}-${match.round}`;
}

export function MatchOverlay() {
  const { code } = useActiveCode();
  const { uid } = useAnonymousAuth();
  const router = useRouter();
  const [match, setMatch] = useState<SessionMatch | null>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  // Fed by watchForMatch's own member subscription — see the effect below.
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    if (!code || !uid) {
      setMatch(null);
      setMembers([]);
      return;
    }
    // knownMovies is passed as a function: the live deck and #13's seeding
    // keep growing the catalog after this subscribes.
    // The member list comes from this subscription rather than a second one of
    // our own: clearMatch() needs it to work out the next swipe floor, and a
    // separate listener would race this one — a device that joins a session
    // which has already matched gets the match document before its own first
    // member snapshot, and a "Keep swiping" in that window would compute the
    // floor from an empty list.
    return watchForMatch(code, knownMovies, setMatch, {
      onDetect: async (winner, groupMembers) =>
        (await explainPick(groupMembers, knownMovies(), winner)) ?? undefined,
      onMembers: setMembers,
    });
  }, [code, uid]);

  const tmdbId = match?.tmdbId ?? null;
  useEffect(() => {
    // Cleared on every change, not just on null. With one match per session a
    // stale Movie here was invisible; with rounds it renders the previous
    // round's poster and title for the ~100ms until getMovie() answers — a
    // flash of the exact film the group just rejected.
    setMovie(null);
    if (tmdbId === null) return;

    let cancelled = false;
    // Seed or the session cache answers instantly; an unseen id costs one
    // TMDB call and falls back to null offline, which the card copes with.
    void getMovie(tmdbId).then((found) => {
      if (!cancelled) setMovie(found);
    });
    return () => {
      cancelled = true;
    };
  }, [tmdbId]);

  // The reveal is gone the moment the document says cleared, so the button
  // stops looking busy on its own; this only covers a failed write, which
  // leaves the reveal up and has to leave the button usable again.
  useEffect(() => {
    if (!match?.cleared) return;
    setClearing(false);
  }, [match?.cleared]);

  const handleKeepSwiping = useCallback(() => {
    if (!code || !match || clearing) return;
    setClearing(true);
    // Deliberately not optimistic: every device, this one included, hides off
    // the document. Firestore latency-compensates, so the presser's own
    // snapshot still arrives immediately — and a write that fails leaves the
    // reveal honestly on screen instead of silently masked.
    void clearMatch(code, match.round, match.tmdbId, members).finally(() => {
      setClearing(false);
    });
  }, [code, match, members, clearing]);

  // `cleared` means the group passed on this verdict: hidden everywhere at
  // once. `dismissed` is this device pressing "Nice" — purely local, because
  // one person being done looking must not clear anybody else's screen.
  if (!match || match.cleared || dismissed === matchKey(match)) return null;

  return (
    <MatchReveal
      key={matchKey(match)}
      match={match}
      movie={movie}
      clearing={clearing}
      onKeepSwiping={handleKeepSwiping}
      onDismiss={() => {
        setDismissed(matchKey(match));
        // The closing beat (#42): every member lands on their own Saved tab,
        // which by then has this verdict in it via saveMatchForCurrentUser.
        router.push('/saved');
      }}
    />
  );
}
