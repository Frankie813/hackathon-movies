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

import { useEffect, useState } from 'react';

import { useRouter } from 'expo-router';

import { useActiveCode } from '@/lib/active-session';
import { useAnonymousAuth } from '@/lib/auth';
import { getMovie, knownMovies } from '@/lib/tmdb';
import { explainPick } from '@/src/lib/gemini';
import { watchForMatch } from '@/src/lib/match';
import type { Match, Movie } from '@/types';

import { MatchReveal } from './MatchReveal';

function matchKey(match: Match): string {
  return `${match.sessionCode}-${match.tmdbId}`;
}

export function MatchOverlay() {
  const { code } = useActiveCode();
  const { uid } = useAnonymousAuth();
  const router = useRouter();
  const [match, setMatch] = useState<Match | null>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!code || !uid) {
      setMatch(null);
      return;
    }
    // knownMovies is passed as a function: the live deck and #13's seeding
    // keep growing the catalog after this subscribes.
    return watchForMatch(code, knownMovies, setMatch, {
      onDetect: async (winner, members) =>
        (await explainPick(members, knownMovies(), winner)) ?? undefined,
    });
  }, [code, uid]);

  const tmdbId = match?.tmdbId ?? null;
  useEffect(() => {
    if (tmdbId === null) {
      setMovie(null);
      return;
    }
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

  if (!match || dismissed === matchKey(match)) return null;

  return (
    <MatchReveal
      key={matchKey(match)}
      match={match}
      movie={movie}
      onDismiss={() => {
        setDismissed(matchKey(match));
        // The closing beat (#42): every member lands on their own Saved tab,
        // which by then has this verdict in it via saveMatchForCurrentUser.
        router.push('/saved');
      }}
    />
  );
}
