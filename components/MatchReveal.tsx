// components/MatchReveal.tsx — the full celebratory screen for issue #10.
//
// Step 5 of the demo path: this is what judges remember. MatchOverlay (#17)
// owns the data — subscribing to the match document, resolving the poster,
// dismiss/dedupe state — and mounts this component once it has something to
// show. This file only knows how to present a verdict; it has no Firestore or
// TMDB calls of its own.

import { useEffect, useState } from 'react';
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

/** Shown while Gemini's line is still in flight. */
const WHY_PLACEHOLDER = 'Reel is weighing your tastes…';

/**
 * Shown once we stop expecting a line at all — offline, over quota, or a
 * response that failed validation. Deliberately finished-looking rather than a
 * permanent ellipsis: the reveal is the last thing judges look at, and copy
 * that reads as a hung spinner is worse than copy that reads as an ending.
 *
 * It is not a compromise explanation and does not pretend to be one. Naming a
 * trade-off here would mean inventing one, which is the thing #21 exists to
 * prevent.
 */
const WHY_FALLBACK = 'Your group landed on this one.';

/**
 * How long to hold the placeholder before giving up on the line.
 *
 * A device cannot tell "still coming" from "never coming" by looking at the
 * match document: the `why` is patched in later by whichever device claimed
 * the match (#17), and a device that is not that one never learns the call
 * failed. So this is a timer rather than a signal. 15s clears a healthy call
 * (12s request timeout, usually answered in two or three) with room to spare,
 * and a line that lands after the deadline still replaces the fallback.
 */
const WHY_TIMEOUT_MS = 15_000;

export interface MatchRevealProps {
  match: Match;
  movie: Movie | null;
  onDismiss: () => void;
  /**
   * "Keep swiping" (#97): the group passes on this verdict. Shared, unlike
   * onDismiss — it writes to the match document, so one press clears the
   * reveal on every phone in the session and the group carries on swiping.
   *
   * Required rather than optional: an overlay that quietly lost the shared
   * action would dead-end a group on a film they don't want, in front of
   * judges, with no way back.
   */
  onKeepSwiping: () => void;
  /** True while the clear is in flight, so the button can't be spammed. */
  clearing?: boolean;
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
export function MatchReveal({
  match,
  movie,
  onDismiss,
  onKeepSwiping,
  clearing = false,
}: MatchRevealProps) {
  const [gaveUpOnWhy, setGaveUpOnWhy] = useState(false);
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

  // Stop waiting on the why line once the deadline passes. Cleared as soon as
  // one arrives, so a normal match never starts the timer's second life.
  useEffect(() => {
    if (match.why) {
      setGaveUpOnWhy(false);
      return;
    }
    const timer = setTimeout(() => setGaveUpOnWhy(true), WHY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [match.why]);

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

        {/* The payoff line (#21), and the reveal's only where-to-watch: the
            validated line ends with the film's providers, so a badge row here
            would say the same thing twice on the one screen judges read
            closely. Gemini's text is validated against the catalog before it
            can reach the match document, so what lands here is a trade-off
            about a real film — never a hallucination.

            Dimmed only while genuinely waiting: the fallback is a finished
            line, and greying it out would put it back to looking like
            something still loading. */}
        <Animated.Text
          style={[styles.why, whyStyle, !match.why && !gaveUpOnWhy && styles.whyPending]}
        >
          {match.why ?? (gaveUpOnWhy ? WHY_FALLBACK : WHY_PLACEHOLDER)}
        </Animated.Text>

        {/* Both actions share the one footer animation. Giving "Keep swiping"
            its own shared value and delay would have the two buttons arrive on
            different frames, on the one screen judges watch closely.

            "Nice" keeps the only filled CTA: accepting the match is the happy
            path and should read as the ending. "Keep swiping" is the quieter
            way out, so it is a ghost button underneath. */}
        <Animated.View style={footerStyle}>
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonLabel}>Nice</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: clearing }}
            disabled={clearing}
            onPress={onKeepSwiping}
            style={({ pressed }) => [
              styles.ghostButton,
              pressed && styles.pressed,
              clearing && styles.ghostButtonDisabled,
            ]}
          >
            {/* The write takes a beat on venue Wi-Fi. The transaction behind
                it is round-guarded, so extra taps are harmless — but without
                a visible pending state it *looks* broken and gets tapped
                anyway. */}
            <Text style={styles.ghostButtonLabel}>
              {clearing ? 'Finding another…' : 'Keep swiping'}
            </Text>
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
  button: {
    // Trimmed from 20 to make room for the second action below it: the
    // content column is already poster + title + year + why on one screen.
    marginTop: 14,
    backgroundColor: '#e50914',
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  ghostButton: {
    marginTop: 6,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  ghostButtonDisabled: {
    opacity: 0.45,
  },
  ghostButtonLabel: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
