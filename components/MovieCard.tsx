import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import YoutubePlayer, {
  PLAYER_STATES,
  type YoutubeIframeRef,
} from 'react-native-youtube-iframe';
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

  // react-native-youtube-iframe's web player can't message back to RN on web
  // (react-native-web-webview loads it as a plain cross-origin <iframe> with
  // no window.ReactNativeWebView bridge), so onReady/onChangeState never fire
  // there. Skip the player and show the poster immediately on web.
  const isWeb = Platform.OS === 'web';
  const hasVideo = !!movie.video?.key && !isWeb;

  const playerRef = useRef<YoutubeIframeRef>(null);
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
  const onVideoStateChange = useCallback(
    (state: string) => {
      if (state === PLAYER_STATES.ENDED || state === 'ended') {
        playerRef.current?.seekTo(start, true);
      }
    },
    [start]
  );

  // embed_not_allowed / video_not_found / html5_error -> fall back permanently to the poster.
  const onVideoError = useCallback(
    (error: string) => {
      console.warn(`[MovieCard] YouTube error for "${movie.title}":`, error);
      setVideoFailed(true);
      onCardFailed?.(movie);
    },
    [movie, onCardFailed]
  );

  const handleVideoReady = useCallback(() => setVideoReady(true), []);

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
  const showPoster = !showVideo || !videoReady;

  return (
    <View style={[styles.card, { width, height }]}>
      {showVideo && (
        // pointerEvents="none": taps/drags go to the swipe gesture, not the
        // WebView. The card's own chrome (gradients, title, mute button) is
        // still drawn on top of this in the full-bleed layout below —
        // a deliberate, known deviation from AGENTS.md §3 ("never draw UI
        // over the player"), accepted to keep the existing full-bleed card
        // look. Needs real-device verification: Android WebView compositing
        // can behave differently than iOS/web here.
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
          <YoutubePlayer
            ref={playerRef}
            height={height}
            width={width}
            videoId={movie.video!.key}
            play={active && videoReady}
            mute={muted}
            forceAndroidAutoplay
            initialPlayerParams={{
              start,
              end,
              controls: false,
              rel: false,
              modestbranding: true,
              loop: false,
              preventFullScreen: true,
            }}
            onReady={handleVideoReady}
            onChangeState={onVideoStateChange}
            onError={onVideoError}
            webViewProps={{
              androidLayerType: 'hardware',
              allowsInlineMediaPlayback: true,
              mediaPlaybackRequiresUserAction: false,
            }}
          />
        </View>
      )}

      {showPoster && (movie.poster && !imageError ? (
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
