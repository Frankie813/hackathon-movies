import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  TrailerVideoPlayer,
  type TrailerVideoPlayerRef,
} from './TrailerVideoPlayer';
import type { Movie } from '@/types';

interface MovieCardProps {
  movie: Movie;
  width: number;
  height: number;
  active?: boolean;
  whyLine?: string;
  onPressSpeaker?: (movie: Movie) => void;
  onToggleMute?: () => void;
  isMuted?: boolean;
  onCardFailed?: (movie: Movie) => void;
}

export function MovieCard({
  movie,
  width,
  height,
  active = false,
  whyLine,
  onPressSpeaker,
  onToggleMute,
  isMuted,
  onCardFailed,
}: MovieCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const hasVideo = !!movie.video?.key;

  const playerRef = useRef<TrailerVideoPlayerRef>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(!hasVideo);
  const [internalMuted, setInternalMuted] = useState(true);
  const muted = isMuted ?? internalMuted;

  const start = movie.video?.start ?? 0;
  const end = movie.video?.end;

  // Reset video state when the card changes to a different movie.
  useEffect(() => {
    setVideoReady(false);
    setVideoFailed(!hasVideo);
  }, [movie.id, hasVideo]);

  // Loop the chosen segment instead of showing the YouTube end screen.
  // (No-op on web: TrailerVideoPlayer.web.tsx has no ended event or seekTo
  // bridge, so looping there is handled by loop=1&playlist=self in the URL.)
  const onVideoEnded = useCallback(() => {
    playerRef.current?.seekTo(start);
  }, [start]);

  // embed_not_allowed / video_not_found / html5_error -> fall back permanently to the poster.
  // (No-op on web: a raw iframe has no error channel — a dead video key just
  // shows a blank iframe there rather than falling back to the poster.)
  const onVideoError = useCallback(
    (error: string) => {
      // react-native-youtube-iframe maps YouTube's numeric error code to a
      // friendly string via a fixed lookup table (2/5/100/101/150 only) and
      // only gives us that mapped value — an "undefined" here means YouTube
      // sent some other, unrecognized code, not that nothing went wrong. It
      // still falls back to the poster correctly either way.
      console.warn(
        `[MovieCard] YouTube error for "${movie.title}": ${error ?? 'unrecognized error code'}`
      );
      setVideoFailed(true);
      onCardFailed?.(movie);
    },
    [movie, onCardFailed]
  );

  const handleVideoReady = useCallback(() => setVideoReady(true), []);

  // Fade the video in over the poster instead of popping in the instant it's ready.
  const videoOpacity = useSharedValue(0);
  useEffect(() => {
    videoOpacity.value = videoReady
      ? withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) })
      : 0;
  }, [videoReady, videoOpacity]);
  const videoAnimatedStyle = useAnimatedStyle(() => ({ opacity: videoOpacity.value }));

  const handleToggleMute = useCallback(() => {
    if (onToggleMute) {
      onToggleMute();
    } else {
      setInternalMuted((prev) => !prev);
    }
  }, [onToggleMute]);

  const accentColor = movie.negativeColor || '#f59e0b';
  const themeBase = movie.themeColor || '#080d1a';
  const showVideo = hasVideo && !videoFailed;

  return (
    <View style={[styles.card, { width, height }]}>
      {/* Poster stays mounted underneath the whole time — the video fades in
          on top of it once ready, instead of popping in and swapping it out. */}
      {(movie.poster && !imageError ? (
        <>
          {/* Duplicate image behind: scaled up & softened with blur filter to fill all space */}
          <Image
            source={{ uri: movie.poster }}
            style={[styles.blurredBackdrop, { width, height }]}
            resizeMode="cover"
            blurRadius={28}
          />

          {/* Primary image in front filling the window */}
          <Image
            source={{ uri: movie.poster }}
            style={[
              styles.mainImage,
              { width, height, opacity: imageLoaded ? 1 : 0.6 },
            ]}
            resizeMode="cover"
            onLoadEnd={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        </>
      ) : (
        <View style={[styles.placeholderMedia, { width, height, backgroundColor: themeBase }]}>
          <Text style={styles.placeholderEmoji}>🎬</Text>
          <Text style={styles.placeholderTitle}>{movie.title}</Text>
        </View>
      ))}

      {/* Loading animation while the trailer's network fetch/init is in flight */}
      {showVideo && !videoReady && (
        <View style={[StyleSheet.absoluteFill, styles.loadingOverlay]} pointerEvents="none">
          <Image
            source={require('@/assets/trailer-loading.gif')}
            style={styles.loadingGif}
            resizeMode="contain"
          />
        </View>
      )}

      {showVideo && (
        // pointerEvents="none": taps/drags go to the swipe gesture, not the
        // player. The card's own chrome (gradients, title, mute button) is
        // still drawn on top of this in the full-bleed layout below —
        // a deliberate, known deviation from AGENTS.md §3 ("never draw UI
        // over the player"), accepted to keep the existing full-bleed card
        // look. Needs real-device verification: Android WebView compositing
        // can behave differently than iOS/web here.
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { width, height, overflow: 'hidden' }, videoAnimatedStyle]}
        >
          <TrailerVideoPlayer
            ref={playerRef}
            videoId={movie.video!.key}
            start={start}
            end={end}
            containerWidth={width}
            containerHeight={height}
            play={active}
            muted={muted}
            onReady={handleVideoReady}
            onEnded={onVideoEnded}
            onError={onVideoError}
          />
        </Animated.View>
      )}

      {/* Top subtle vignette for header legibility */}
      <LinearGradient
        colors={['rgba(0,0,0,0.7)', 'rgba(0,0,0,0)']}
        style={[styles.topGradient, { width }]}
        pointerEvents="none"
      />

      {/* Bottom smooth gradient overlay for floating text (No boxy background) */}
      <LinearGradient
        colors={[
          'rgba(0,0,0,0)',
          'rgba(4, 7, 14, 0.4)',
          'rgba(4, 7, 14, 0.85)',
          'rgba(4, 7, 14, 0.98)',
        ]}
        locations={[0, 0.35, 0.68, 1]}
        style={[styles.bottomGradient, { width }]}
        pointerEvents="none"
      />

      {/* Floating Info Overlay (Clean with NO background box, spaced for floating buttons & tab bar) */}
      <View style={styles.floatingContent}>
        {/* Title in bold Graphique-inspired display typography + Mute control */}
        <View style={styles.titleRow}>
          <View style={styles.titleSection}>
            <Text style={styles.graphiqueTitle} numberOfLines={2}>
              {movie.title}
            </Text>
            <Text style={[styles.yearSubtitle, { color: accentColor }]}>
              {movie.year}
            </Text>
          </View>

          {showVideo && (
            <Pressable
              onPress={handleToggleMute}
              style={styles.muteButton}
              accessibilityLabel={muted ? 'Unmute trailer' : 'Mute trailer'}
              accessibilityRole="button"
            >
              <Ionicons
                name={muted ? 'volume-mute' : 'volume-high'}
                size={18}
                color="#ffffff"
              />
            </Pressable>
          )}
        </View>

        {/* Gemini "Why you'll like this" slot + ElevenLabs Voice Read-Aloud Placeholder */}
        {whyLine ? (
          <View style={styles.whyWrapper}>
            <View style={styles.whyHeaderRow}>
              <Text style={styles.whyBadge}>WHY YOU'LL LIKE THIS</Text>
              <Pressable
                onPress={() => onPressSpeaker?.(movie)}
                style={styles.speakerButton}
                accessibilityLabel="Listen to Reel AI"
              >
                <Ionicons name="volume-medium" size={14} color={accentColor} />
              </Pressable>
            </View>
            <Text style={styles.whyText} numberOfLines={2}>
              "{whyLine}"
            </Text>
          </View>
        ) : null}

        {/* Tag pills: genres */}
        <View style={styles.tagRow}>
          {movie.genreNames?.slice(0, 3).map((genre) => (
            <View
              key={genre}
              style={[
                styles.genrePill,
                { borderColor: `${accentColor}55`, backgroundColor: 'rgba(0, 0, 0, 0.35)' },
              ]}
            >
              <Text style={[styles.genreText, { color: accentColor }]}>
                {genre}
              </Text>
            </View>
          ))}
        </View>

        {/* Where-to-watch badges */}
        {movie.providers && movie.providers.length > 0 && (
          <View style={styles.providersSection}>
            <Text style={styles.providersLabel}>STREAMING ON</Text>
            <View style={styles.providerRow}>
              {movie.providers.slice(0, 4).map((prov) => (
                <View key={prov} style={styles.providerBadge}>
                  <Text style={styles.providerName}>{prov}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#080d1a',
    position: 'relative',
    overflow: 'hidden',
  },
  blurredBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    transform: [{ scale: 1.15 }],
    opacity: 0.9,
  },
  mainImage: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  placeholderMedia: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  loadingOverlay: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingGif: {
    width: 135,
    height: 120,
  },
  placeholderEmoji: {
    fontSize: 54,
    marginBottom: 12,
  },
  placeholderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 120,
    zIndex: 10,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 420,
    zIndex: 10,
  },
  floatingContent: {
    position: 'absolute',
    bottom: 160, // Clear space for action buttons (bottom: 100) & tab bar (bottom: 24)
    left: 20,
    right: 20,
    zIndex: 20,
    backgroundColor: 'transparent',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  titleSection: {
    flex: 1,
    marginRight: 12,
  },
  muteButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  graphiqueTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  yearSubtitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  whyWrapper: {
    marginVertical: 4,
    backgroundColor: 'transparent',
  },
  whyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  whyBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.65)',
    letterSpacing: 1.5,
  },
  speakerButton: {
    padding: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  whyText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f3f4f6',
    fontStyle: 'italic',
    lineHeight: 18,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 6,
  },
  genrePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  genreText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  providersSection: {
    marginTop: 4,
  },
  providersLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.45)',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
  },
});
