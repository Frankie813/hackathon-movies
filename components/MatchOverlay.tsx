// components/MatchOverlay.tsx — steps 4 and 5 of the demo path, wired.
//
// Mounted once over the tab navigator. Whenever this device is in a session
// it watches the group (#17): the first device to detect a match claims the
// match document, asks Gemini for the compromise line (#21) and patches it
// on; every device — this one included — reveals off that document, so both
// phones say the same thing at the same time.
//
// This is the minimal on-screen reveal. #10 replaces the card below with the
// full celebratory screen; the watching/wiring here is what it mounts on.

import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useActiveCode } from '@/lib/active-session';
import { useAnonymousAuth } from '@/lib/auth';
import { getMovie, knownMovies } from '@/lib/tmdb';
import { explainPick } from '@/src/lib/gemini';
import { watchForMatch } from '@/src/lib/match';
import type { Match, Movie } from '@/types';

/** Shown until Gemini's line lands, or forever if it never does (offline). */
const WHY_PLACEHOLDER = 'Reel is weighing your tastes…';

function matchKey(match: Match): string {
  return `${match.sessionCode}-${match.tmdbId}`;
}

export function MatchOverlay() {
  const { code } = useActiveCode();
  const { uid } = useAnonymousAuth();
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
    <View style={styles.backdrop} pointerEvents="box-none">
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.eyebrow}>IT&apos;S A MATCH!</Text>

        {movie?.poster ? (
          <Image source={{ uri: movie.poster }} style={styles.poster} resizeMode="cover" />
        ) : null}

        <Text style={styles.title} numberOfLines={2}>
          {movie?.title ?? 'Your group has a pick'}
        </Text>
        {movie?.year ? <Text style={styles.year}>{movie.year}</Text> : null}

        {/* The payoff line (#21). Gemini's text is validated against the
            catalog before it can reach the match document, so what lands
            here is a trade-off about a real film. */}
        <Text style={[styles.why, !match.why && styles.whyPending]}>
          {match.why ?? WHY_PLACEHOLDER}
        </Text>

        {movie && movie.providers.length > 0 ? (
          <View style={styles.providerRow}>
            {movie.providers.slice(0, 4).map((provider) => (
              <View key={provider} style={styles.providerBadge}>
                <Text style={styles.providerName}>{provider}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => setDismissed(matchKey(match))}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>Nice</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    elevation: 100,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 10,
    padding: 24,
    borderRadius: 24,
    backgroundColor: '#101014',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  eyebrow: {
    color: '#fbbf24',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
  },
  poster: {
    width: 140,
    height: 210,
    borderRadius: 12,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  year: {
    color: '#9a9aa2',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
  why: {
    color: '#f3f4f6',
    fontSize: 15,
    fontStyle: 'italic',
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 4,
  },
  whyPending: {
    color: '#6a6a74',
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  providerBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  providerName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ffffff',
  },
  button: {
    marginTop: 8,
    backgroundColor: '#e50914',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
});
