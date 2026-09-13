import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  LANDSCAPE_ASPECT,
  SHORT_ASPECT,
  TrailerVideoPlayer,
  type TrailerVideoPlayerRef,
} from './TrailerVideoPlayer';
import type { Movie } from '@/types';

/** Top of the sharp video window: clears the status bar and the deck header. */
const HEADER_INSET = 104;
/** Gap between the bottom of the video window and the title block. */
const FRAME_GAP = 12;
/** Never let the window collapse below this on short screens, even if it then meets the title. */
const MIN_FRAME_HEIGHT = 180;
/** Where the bottom chrome starts before its layout has been measured (matches bottomGradient). */
const DEFAULT_CHROME_TOP_FROM_BOTTOM = 420;
/** Bottom inset of the floating content: clears the action buttons and the tab bar. */
const CHROME_BOTTOM = 160;
const OVERVIEW_LINE_HEIGHT = 21;
/**
 * The Gemini "why" line (#20) arrives long after the card has been laid out, so
 * its slot is reserved up front at a fixed height: badge line + two lines of
 * quote. An absent slot would grow the chrome when the line lands, and the
 * chrome's measured top is what sizes the video window above it.
 */
const WHY_BADGE_LINE_HEIGHT = 13;
const WHY_BADGE_GAP = 2;
const WHY_LINE_HEIGHT = 18;
const WHY_SLOT_HEIGHT = WHY_BADGE_LINE_HEIGHT + WHY_BADGE_GAP + WHY_LINE_HEIGHT * 2;
/**
 * Provider badges are fitted to one line by name length rather than by a fixed
 * count: TMDB mixes "Max" with "Paramount+ Roku Premium Channel", so a fixed
 * count either wastes the row or — with flexShrink sharing the overflow — leaves
 * the short names ellipsized down to "N…". A name is shown whole or not at all;
 * the rest collapse into "+N". The estimate only has to be close, since every
 * badge still clips to one line if it comes out narrow.
 */
const CHROME_SIDE_INSET = 20;
const PROVIDER_GAP = 6;
/** paddingHorizontal 8 + 1pt border, both sides. */
const PROVIDER_BADGE_PADDING = 18;
/** Rough advance of the 10pt semibold provider name, per character. */
const PROVIDER_CHAR_WIDTH = 6;
/** Enough for "+12". */
const PROVIDER_OVERFLOW_WIDTH = 40;

function providerBadgeWidth(name: string): number {
  return PROVIDER_BADGE_PADDING + name.length * PROVIDER_CHAR_WIDTH;
}

/**
 * Split providers into the names that fit on one row and a count for the rest.
 * Always shows at least one, even if that single name has to ellipsize.
 */
export function fitProviders(
  providers: string[],
  cardWidth: number
): { shown: string[]; hidden: number } {
  const budget = cardWidth - CHROME_SIDE_INSET * 2;
  const shown: string[] = [];
  let used = 0;

  for (const name of providers) {
    const next = providerBadgeWidth(name) + (shown.length ? PROVIDER_GAP : 0);
    if (shown.length > 0 && used + next > budget) break;
    used += next;
    shown.push(name);
  }

  // Give back whatever the "+N" badge needs, but never the last name.
  while (
    shown.length > 1 &&
    shown.length < providers.length &&
    used + PROVIDER_GAP + PROVIDER_OVERFLOW_WIDTH > budget
  ) {
    used -= providerBadgeWidth(shown.pop()!) + PROVIDER_GAP;
  }

  return { shown, hidden: providers.length - shown.length };
}

/**
 * Backdrop candidates for a trailer, tried in order. YouTube serves every
 * video's poster frame at a fixed URL with no API key: maxresdefault is
 * 1280x720 but missing for some uploads, mqdefault (320x180, also 16:9)
 * always exists. The movie poster is the last resort.
 */
function trailerBackdropUrls(key: string, poster?: string): string[] {
  const urls = [
    `https://i.ytimg.com/vi/${key}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${key}/mqdefault.jpg`,
  ];
  if (poster) urls.push(poster);
  return urls;
}

interface MovieCardProps {
  movie: Movie;
  width: number;
  height: number;
  active?: boolean;
  /** Swipe-up state: replace the title block with the TMDB synopsis. */
  showDetails?: boolean;
  whyLine?: string;
  /**
   * True when a why line is on its way but has not arrived yet, so the slot is
   * held open at its final height (#20). False — the deck has no Gemini line to
   * give — drops the slot entirely rather than leaving a permanent gap above
   * the genres, since without a line there is nothing to jump.
   */
  expectWhyLine?: boolean;
  /** Three vibe tags Gemini read off the poster (#39). Absent: no chip row. */
  vibeTags?: string[];
  onToggleMute?: () => void;
  isMuted?: boolean;
  onCardFailed?: (movie: Movie) => void;
}

export function MovieCard({
  movie,
  width,
  height,
  active = false,
  showDetails = false,
  whyLine,
  expectWhyLine = false,
  vibeTags,
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

  // A vertical Short (found by scripts/find-shorts.mjs) plays full-screen in
  // place of the landscape clip. If it fails to embed, drop back to the clip
  // rather than the poster.
  const [shortFailed, setShortFailed] = useState(false);
  const short = movie.video?.short;
  const usingShort = !!short && !shortFailed;
  const videoId = usingShort ? short.key : movie.video?.key;
  const start = usingShort ? 0 : (movie.video?.start ?? 0);
  const end = usingShort ? undefined : movie.video?.end;

  // Blurred still behind the letterboxed video; walks the candidate list on load errors.
  const [backdropIndex, setBackdropIndex] = useState(0);
  const backdropUrls = hasVideo ? trailerBackdropUrls(movie.video!.key, movie.poster) : [];
  const backdropUrl = backdropUrls[backdropIndex];

  // Reset video state when the card changes to a different movie.
  useEffect(() => {
    setVideoReady(false);
    setVideoFailed(!hasVideo);
    setShortFailed(false);
    setBackdropIndex(0);
  }, [movie.id, hasVideo]);

  // The sharp video fills a full-width window from just below the header to
  // just above the title block (the block's top is measured, so a two-line
  // title shrinks the window rather than sitting under the video). The player
  // zooms the 16:9 frame inside that window; the sides overspill.
  // A Short instead covers the whole card at its native 9:16 (the chrome sits
  // over it, as on any vertical-video feed).
  const [chromeTop, setChromeTop] = useState<number | null>(null);
  const chromeY = chromeTop ?? height - DEFAULT_CHROME_TOP_FROM_BOTTOM;
  const frameTop = usingShort ? 0 : HEADER_INSET;
  const frameHeight = usingShort
    ? height
    : Math.max(MIN_FRAME_HEIGHT, Math.round(chromeY - FRAME_GAP - HEADER_INSET));

  // Loop the chosen segment instead of showing the YouTube end screen.
  // (No-op on web: TrailerVideoPlayer.web.tsx has no ended event or seekTo
  // bridge, so looping there is handled by loop=1&playlist=self in the URL.)
  const onVideoEnded = useCallback(() => {
    playerRef.current?.seekTo(start);
  }, [start]);

  // embed_not_allowed / video_not_found / html5_error / missing_referrer, plus
  // the player's own network / timeout signals -> fall back permanently to the poster.
  // (No-op on web: a raw iframe has no error channel — a dead video key just
  // shows a blank iframe there rather than falling back to the poster.)
  const onVideoError = useCallback(
    (error: string) => {
      if (usingShort) {
        console.warn(`[MovieCard] Short failed for "${movie.title}": ${error}; using the landscape clip`);
        setShortFailed(true);
        setVideoReady(false);
        return;
      }
      console.warn(`[MovieCard] Trailer failed for "${movie.title}": ${error}`);
      setVideoFailed(true);
      onCardFailed?.(movie);
    },
    [movie, onCardFailed, usingShort]
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

  const providerFit = useMemo(
    () => fitProviders(movie.providers ?? [], width),
    [movie.providers, width]
  );

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
        // player. Only the blurred backdrop extends under the card chrome;
        // the sharp video window sits above the title block, so no UI is
        // drawn over the video (AGENTS.md §3).
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { width, height, overflow: 'hidden' }, videoAnimatedStyle]}
        >
          {/* Blurred trailer still: shows through the transparent player until
              its live backdrop renders, and is all there is on web. The player
              draws its own dim layer over it. */}
          {backdropUrl && (
            <Image
              testID="trailer-backdrop"
              source={{ uri: backdropUrl }}
              style={[StyleSheet.absoluteFill, styles.videoBackdrop]}
              resizeMode="cover"
              blurRadius={30}
              onError={() => setBackdropIndex((i) => i + 1)}
            />
          )}
          <TrailerVideoPlayer
            ref={playerRef}
            videoId={videoId!}
            start={start}
            end={end}
            width={width}
            height={height}
            frameTop={frameTop}
            frameHeight={frameHeight}
            aspect={usingShort ? SHORT_ASPECT : LANDSCAPE_ASPECT}
            zoom={usingShort ? 1 : undefined}
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

      {/* Swipe-up view: the synopsis in place of the title block. In the
          landscape layout it starts under the video window; over a
          full-screen Short it sits where the title block was. The video
          window keeps the geometry measured from the title block, so it
          doesn't jump when the block is swapped out. */}
      {showDetails && (
        <View
          testID="card-details"
          style={[
            styles.floatingContent,
            usingShort ? null : { top: frameTop + frameHeight + FRAME_GAP },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.overviewBadge}>ABOUT THIS MOVIE</Text>
          <Text
            style={styles.overviewText}
            numberOfLines={
              usingShort
                ? 9
                : Math.max(
                    3,
                    Math.floor(
                      (height - CHROME_BOTTOM - (frameTop + frameHeight + FRAME_GAP) - 48) /
                        OVERVIEW_LINE_HEIGHT
                    )
                  )
            }
          >
            {movie.overview?.trim() || 'No description available for this title.'}
          </Text>
          <Text style={styles.overviewHint}>Swipe down or tap to go back</Text>
        </View>
      )}

      {/* Floating Info Overlay (Clean with NO background box, spaced for floating buttons & tab bar) */}
      {!showDetails && (
      <View
        testID="card-chrome"
        style={styles.floatingContent}
        onLayout={(e) => setChromeTop(e.nativeEvent.layout.y)}
      >
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

        {/* Gemini "Why you'll like this" slot (#20). Held open at its final
            height while the line is in flight — see WHY_SLOT_HEIGHT. */}
        {(whyLine || expectWhyLine) && (
          <View testID="why-slot" style={styles.whySlot}>
            {whyLine ? (
              <>
                <Text style={styles.whyBadge}>WHY YOU'LL LIKE THIS</Text>
                <Text style={styles.whyText} numberOfLines={2}>
                  "{whyLine}"
                </Text>
              </>
            ) : null}
          </View>
        )}

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

        {/* Vibe chips (#39): Gemini's read of the poster. One line, clipped
            rather than wrapped, so they never add a second row of height. */}
        {vibeTags && vibeTags.length > 0 && (
          <View testID="vibe-tags" style={styles.vibeRow}>
            {vibeTags.map((tag) => (
              <View key={tag} style={styles.vibePill}>
                <Text style={styles.vibeText} numberOfLines={1}>
                  {tag}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Where-to-watch badges. Always a single row: TMDB hands back up to
            nine providers per title, and a wrapping row would change the
            chrome's height from card to card — which moves the video window
            above it. See fitProviders. */}
        {movie.providers && movie.providers.length > 0 && (
          <View style={styles.providersSection}>
            <Text style={styles.providersLabel}>STREAMING ON</Text>
            <View testID="provider-row" style={styles.providerRow}>
              {providerFit.shown.map((prov) => (
                <View key={prov} style={[styles.providerBadge, styles.providerBadgeShrink]}>
                  <Text style={styles.providerName} numberOfLines={1}>
                    {prov}
                  </Text>
                </View>
              ))}
              {providerFit.hidden > 0 && (
                <View testID="provider-overflow" style={styles.providerBadge}>
                  <Text style={styles.providerName}>{`+${providerFit.hidden}`}</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
      )}
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
  videoBackdrop: {
    // Slight overscale hides the blur's soft edges at the card border.
    transform: [{ scale: 1.1 }],
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
    bottom: CHROME_BOTTOM, // Clear space for action buttons (bottom: 100) & tab bar (bottom: 24)
    left: 20,
    right: 20,
    zIndex: 20,
    backgroundColor: 'transparent',
  },
  overviewBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.65)',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  overviewText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#f3f4f6',
    lineHeight: OVERVIEW_LINE_HEIGHT,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  overviewHint: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.45)',
    letterSpacing: 0.8,
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
  whySlot: {
    height: WHY_SLOT_HEIGHT,
    marginVertical: 4,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  whyBadge: {
    fontSize: 10,
    lineHeight: WHY_BADGE_LINE_HEIGHT,
    marginBottom: WHY_BADGE_GAP,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.65)',
    letterSpacing: 1.5,
  },
  whyText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f3f4f6',
    fontStyle: 'italic',
    lineHeight: WHY_LINE_HEIGHT,
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
  vibeRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    overflow: 'hidden',
    gap: 6,
    marginBottom: 6,
  },
  vibePill: {
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  vibeText: {
    fontSize: 10,
    fontWeight: '600',
    fontStyle: 'italic',
    color: 'rgba(255, 255, 255, 0.8)',
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
    flexWrap: 'nowrap',
    alignItems: 'center',
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
  providerBadgeShrink: {
    // Long names ellipsize to share one row instead of wrapping onto a second.
    flexShrink: 1,
  },
  providerName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
  },
});
