// components/MatchReveal.tsx — the full celebratory screen for issue #10.
//
// Step 5 of the demo path: this is what judges remember. MatchOverlay (#17)
// owns the data — subscribing to the match document, resolving the poster,
// dismiss/dedupe state — and mounts this component once it has something to
// show. This file only knows how to present a verdict; it has no Firestore or
// TMDB calls of its own.

import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { Match, Movie } from '@/types';

/** Shown until Gemini's line lands, or forever if it never does (offline). */
const WHY_PLACEHOLDER = 'Reel is weighing your tastes…';
const MAX_PROVIDERS = 4;

export interface MatchRevealProps {
  match: Match;
  movie: Movie | null;
  onDismiss: () => void;
}

/**
 * Full-screen "It's a Match!" reveal.
 *
 * Poster and title animate in immediately — never gated on the why line,
 * which is still in flight from Gemini when the match document first lands
 * (#21 resolves after #17 claims the match). The why line is given its own
 * beat: it fades in about a second into the animation so it reads as the
 * payoff rather than arriving with everything else at once.
 */
export function MatchReveal({ match, movie, onDismiss }: MatchRevealProps) {
  const backdrop = useSharedValue(0);
  const ambient = useSharedValue(0);
  const eyebrow = useSharedValue(0);
  const poster = useSharedValue(0);
  const why = useSharedValue(0);
  const footer = useSharedValue(0);

  // Runs once per mount. The parent keys this component by match id, so a
  // new match always remounts it and replays the entrance; the why line
  // arriving later (the same match document, patched) does not.
  useEffect(() => {
    backdrop.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) });
    // Slower than the backdrop so the ambient color bloom reads as it settling in,
    // not popping on with everything else.
    ambient.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) });
    eyebrow.value = withDelay(80, withSpring(1, { damping: 11, stiffness: 140 }));
    poster.value = withDelay(160, withSpring(1, { damping: 13, stiffness: 120 }));
    why.value = withDelay(1000, withTiming(1, { duration: 450, easing: Easing.out(Easing.quad) }));
    footer.value = withDelay(1300, withTiming(1, { duration: 300 }));
    // Intentionally empty: this is a mount-once entrance, not a data effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const ambientStyle = useAnimatedStyle(() => ({ opacity: ambient.value * 0.85 }));
  const eyebrowStyle = useAnimatedStyle(() => ({
    opacity: eyebrow.value,
    transform: [{ scale: 0.6 + eyebrow.value * 0.4 }],
  }));
  const posterStyle = useAnimatedStyle(() => ({
    opacity: poster.value,
    transform: [{ scale: 0.85 + poster.value * 0.15 }, { translateY: (1 - poster.value) * 24 }],
  }));
  const whyStyle = useAnimatedStyle(() => ({
    opacity: why.value,
    transform: [{ translateY: (1 - why.value) * 10 }],
  }));
  const footerStyle = useAnimatedStyle(() => ({ opacity: footer.value }));

  const providers = movie?.providers.slice(0, MAX_PROVIDERS) ?? [];

  return (
    <Animated.View
      style={[styles.backdrop, backdropStyle]}
      pointerEvents="box-none"
      accessibilityViewIsModal
    >
      {/* Ambient bleed: the poster itself, blown up and heavily blurred, so the
          screen reads as "this film's colors, in the dark" rather than a flat
          black card. Scrim + edge gradients keep it moody instead of a bright
          photo, and keep the title/why block on near-solid black for contrast. */}
      {movie?.poster ? (
        <Animated.Image
          source={{ uri: movie.poster }}
          style={[styles.ambientImage, ambientStyle]}
          resizeMode="cover"
          blurRadius={55}
        />
      ) : null}
      <View style={styles.ambientScrim} pointerEvents="none" />
      <LinearGradient
        colors={['rgba(5,5,7,0.95)', 'rgba(5,5,7,0)']}
        style={styles.topScrim}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(5,5,7,0)', 'rgba(5,5,7,0.98)']}
        locations={[0, 0.75]}
        style={styles.bottomScrim}
        pointerEvents="none"
      />

      <View style={styles.content} accessibilityRole="alert">
        <Animated.Text style={[styles.eyebrow, eyebrowStyle]}>IT&apos;S A MATCH!</Animated.Text>

        <Animated.View style={posterStyle}>
          {movie?.poster ? (
            <Image source={{ uri: movie.poster }} style={styles.poster} resizeMode="cover" />
          ) : (
            <View style={[styles.poster, styles.posterFallback]} />
          )}
        </Animated.View>

        <Text style={styles.title} numberOfLines={2}>
          {movie?.title ?? 'Your group has a pick'}
        </Text>
        {movie?.year ? <Text style={styles.year}>{movie.year}</Text> : null}

        {/* The payoff line (#21). Gemini's text is validated against the
            catalog before it can reach the match document, so what lands
            here is a trade-off about a real film — never a hallucination. */}
        <Animated.Text style={[styles.why, whyStyle, !match.why && styles.whyPending]}>
          {match.why ?? WHY_PLACEHOLDER}
        </Animated.Text>

        {providers.length > 0 ? (
          <Animated.View style={[styles.providerBlock, whyStyle]}>
            <Text style={styles.providerLabel}>WHERE TO WATCH</Text>
            <View style={styles.providerRow}>
              {providers.map((provider) => (
                <View key={provider} style={styles.providerBadge}>
                  <Text style={styles.providerName}>{provider}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
        ) : null}

        <Animated.View style={footerStyle}>
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonLabel}>Nice</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
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
    backgroundColor: '#050507',
    overflow: 'hidden',
  },
  ambientImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Scaled well past the frame: blurRadius softens the source but never
    // reaches its edges, and a naive absoluteFill would show a sharp rim.
    transform: [{ scale: 1.6 }],
  },
  ambientScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5, 5, 7, 0.3)',
  },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '22%',
  },
  bottomScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '48%',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  eyebrow: {
    color: '#fbbf24',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 3,
  },
  poster: {
    width: 220,
    height: 330,
    borderRadius: 16,
    marginTop: 8,
  },
  posterFallback: {
    backgroundColor: '#1b1b22',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  title: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 12,
  },
  year: {
    color: '#9a9aa2',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
  why: {
    color: '#f3f4f6',
    fontSize: 17,
    fontStyle: 'italic',
    lineHeight: 24,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 340,
  },
  whyPending: {
    color: '#6a6a74',
  },
  providerBlock: {
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  providerLabel: {
    color: '#6a6a74',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  providerBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  providerName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  button: {
    marginTop: 20,
    backgroundColor: '#e50914',
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
});
