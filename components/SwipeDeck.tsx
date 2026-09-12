import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { MovieCard } from './MovieCard';
import { Stamp } from './Stamp';
import { DynamicHueBackdrop } from './DynamicHueBackdrop';
import type { Movie, TasteVector } from '@/types';
import { applySwipe, rank } from '@/src/lib/taste';
import { SEED_MOVIES } from '@/data/seedMovies';

export interface SwipeDeckProps {
  movies?: Movie[];
  onSwipeLeft?: (index: number, movie: Movie) => void;
  onSwipeRight?: (index: number, movie: Movie) => void;
  onSwipedAll?: () => void;
  renderCard?: (movie: Movie, index: number, active: boolean) => React.JSX.Element;
  whyFor?: (movie: Movie) => string | undefined;
}

export interface SwipeDeckRef {
  swipeLeft: () => void;
  swipeRight: () => void;
  resetDeck: () => void;
}

const VELOCITY_THRESHOLD = 380;
const EXIT_DURATION = 200;

export const SwipeDeck = forwardRef<SwipeDeckRef, SwipeDeckProps>(function SwipeDeck(
  {
    movies = SEED_MOVIES,
    onSwipeLeft,
    onSwipeRight,
    onSwipedAll,
    renderCard,
    whyFor,
  },
  ref
) {
  const { width, height } = useWindowDimensions();
  const cardW = width;
  const cardH = height;

  const [deck, setDeck] = useState<Movie[]>(movies);
  const taste = useRef<TasteVector>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [previousMovie, setPreviousMovie] = useState<Movie | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const isDone = currentIndex >= deck.length;

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isAnimating = useSharedValue(false);
  const nextCardOpacity = useSharedValue(1);

  const topMovie = deck[currentIndex];

  const currentAccent = topMovie?.negativeColor || previousMovie?.negativeColor || '#fbbf24';
  const currentTheme = topMovie?.themeColor || previousMovie?.themeColor || '#1a233a';

  // Preload upcoming movie posters and trailer backdrops
  useEffect(() => {
    const preloadPool = deck.slice(currentIndex, currentIndex + 5);
    preloadPool.forEach((m) => {
      if (m.poster) {
        Image.prefetch(m.poster).catch(() => {});
      }
      if (m.video?.key) {
        Image.prefetch(`https://i.ytimg.com/vi/${m.video.key}/maxresdefault.jpg`).catch(() => {});
      }
    });
  }, [deck, currentIndex]);

  // Sync internal deck when movies prop changes
  useEffect(() => {
    setDeck(movies);
    taste.current = {};
    setCurrentIndex(0);
    setPreviousMovie(null);
    setIsTransitioning(false);
    translateX.value = 0;
    translateY.value = 0;
    nextCardOpacity.value = 1;
    isAnimating.value = false;
  }, [movies, translateX, translateY, nextCardOpacity, isAnimating]);

  // Sequence: Old Deck Out -> index.gif Dynamic Hue Shift & Bloom Glow -> Next Deck In
  const handleSwipeComplete = useCallback(
    (direction: 'left' | 'right') => {
      const swipedIndex = currentIndex;
      const movie = deck[swipedIndex];
      const nextIndex = swipedIndex + 1;

      if (movie) {
        taste.current = applySwipe(taste.current, movie, direction);
        // Retain the consumed prefix so callback indices and end-of-deck
        // behavior stay intact. Only unseen cards may move.
        setDeck([
          ...deck.slice(0, nextIndex),
          ...rank(taste.current, deck.slice(nextIndex)),
        ]);
        setPreviousMovie(movie);
        if (direction === 'left') {
          onSwipeLeft?.(swipedIndex, movie);
        } else {
          onSwipeRight?.(swipedIndex, movie);
        }
      }

      // 1. Enter intermediate transition state
      setIsTransitioning(true);

      // 2. Advance index and reset gesture position
      translateX.value = 0;
      translateY.value = 0;
      nextCardOpacity.value = 0;

      setCurrentIndex(nextIndex);

      if (nextIndex >= deck.length) {
        setIsTransitioning(false);
        isAnimating.value = false;
        onSwipedAll?.();
        return;
      }

      // 3. Smoothly fade in next card after hue transition handoff
      setTimeout(() => {
        setIsTransitioning(false);
        isAnimating.value = false;
        nextCardOpacity.value = withTiming(1, {
          duration: 220,
          easing: Easing.out(Easing.cubic),
        });
      }, 100);
    },
    [currentIndex, deck, onSwipeLeft, onSwipeRight, onSwipedAll, translateX, translateY, nextCardOpacity, isAnimating]
  );

  // Programmatic swipe (Like / Pass buttons)
  const triggerProgrammaticSwipe = useCallback(
    (direction: 'left' | 'right') => {
      if (isDone || isAnimating.value || isTransitioning) return;

      isAnimating.value = true;
      const targetX = direction === 'right' ? width * 1.55 : -width * 1.55;

      translateX.value = withTiming(
        targetX,
        {
          duration: EXIT_DURATION,
          easing: Easing.bezier(0.18, 0.9, 0.22, 1),
        },
        (finished) => {
          if (finished) {
            runOnJS(handleSwipeComplete)(direction);
          }
        }
      );
    },
    [isDone, isAnimating, isTransitioning, width, translateX, handleSwipeComplete]
  );

  const handleReset = useCallback(() => {
    taste.current = {};
    setDeck([...movies]);
    setCurrentIndex(0);
    setPreviousMovie(null);
    setIsTransitioning(false);
    translateX.value = 0;
    translateY.value = 0;
    nextCardOpacity.value = 1;
    isAnimating.value = false;
  }, [movies, translateX, translateY, nextCardOpacity, isAnimating]);

  useImperativeHandle(
    ref,
    () => ({
      swipeLeft: () => triggerProgrammaticSwipe('left'),
      swipeRight: () => triggerProgrammaticSwipe('right'),
      resetDeck: handleReset,
    }),
    [triggerProgrammaticSwipe, handleReset]
  );

  // Worklet pan gesture running on UI thread
  const panGesture = Gesture.Pan()
    .enabled(!isDone && !isTransitioning)
    .onBegin(() => {
      'worklet';
      if (isAnimating.value) return;
      translateX.value = 0;
      translateY.value = 0;
    })
    .onUpdate((event) => {
      'worklet';
      if (isAnimating.value) return;
      translateX.value = event.translationX;
      translateY.value = event.translationY * 0.22;
    })
    .onEnd((event) => {
      'worklet';
      if (isAnimating.value) return;

      const swipeThreshold = width * 0.22;
      const isSwipeRight =
        event.translationX > swipeThreshold ||
        (event.translationX > 35 && event.velocityX > VELOCITY_THRESHOLD);
      const isSwipeLeft =
        event.translationX < -swipeThreshold ||
        (event.translationX < -35 && event.velocityX < -VELOCITY_THRESHOLD);

      if (isSwipeRight) {
        isAnimating.value = true;
        const targetX = width * 1.55;
        const targetY = event.translationY * 0.3;

        translateX.value = withTiming(
          targetX,
          {
            duration: EXIT_DURATION,
            easing: Easing.bezier(0.18, 0.9, 0.22, 1),
          },
          (finished) => {
            if (finished) {
              runOnJS(handleSwipeComplete)('right');
            }
          }
        );
        translateY.value = withTiming(targetY, { duration: EXIT_DURATION });
      } else if (isSwipeLeft) {
        isAnimating.value = true;
        const targetX = -width * 1.55;
        const targetY = event.translationY * 0.3;

        translateX.value = withTiming(
          targetX,
          {
            duration: EXIT_DURATION,
            easing: Easing.bezier(0.18, 0.9, 0.22, 1),
          },
          (finished) => {
            if (finished) {
              runOnJS(handleSwipeComplete)('left');
            }
          }
        );
        translateY.value = withTiming(targetY, { duration: EXIT_DURATION });
      } else {
        // Return to center smoothly
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  // Top card gesture animation
  const topCardAnimatedStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-width, 0, width],
      [-14, 0, 14],
      Extrapolation.CLAMP
    );

    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotate: `${rotate}deg` },
      ],
      opacity: nextCardOpacity.value,
    };
  });

  // Dynamic live stamps
  const likeStampStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [15, width * 0.2],
      [0, 1],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  const nopeStampStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [-width * 0.2, -15],
      [1, 0],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  const renderMovieContent = useCallback(
    (movie: Movie, index: number, active: boolean) => {
      if (renderCard) {
        return renderCard(movie, index, active);
      }
      return (
        <MovieCard
          movie={movie}
          width={cardW}
          height={cardH}
          active={active}
          whyLine={whyFor ? whyFor(movie) : undefined}
        />
      );
    },
    [renderCard, cardW, cardH, whyFor]
  );

  return (
    <View style={styles.container}>
      {/* Full-Screen 2% Gaussian Blurred index.gif, High-Luminance Bloom Glow & Smooth Hue Shift */}
      <DynamicHueBackdrop
        currentThemeColor={currentTheme}
        previousThemeColor={previousMovie?.themeColor}
        currentAccentColor={currentAccent}
        previousAccentColor={previousMovie?.negativeColor}
        width={cardW}
        height={cardH}
      />

      {/* Full-Screen Deck Viewport */}
      <View style={[styles.deckArea, { width: cardW, height: cardH }]}>
        {isDone ? (
          <View style={[styles.emptyCard, { width: cardW - 32, height: cardH * 0.6 }]}>
            <Text style={styles.emptyEmoji}>🎉</Text>
            <Text style={styles.emptyTitle}>DECK COMPLETED</Text>
            <Text style={styles.emptySubtitle}>
              You've swiped through all movies in this session!
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.resetButton,
                { backgroundColor: currentAccent, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={handleReset}
            >
              <Text style={styles.resetButtonText}>START OVER</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.stackContainer, { width: cardW, height: cardH }]}>
            {/* Top Active Card (Interactive Pan Gestures + Clean Off-Screen Exit) */}
            {topMovie && !isTransitioning && (
              <GestureDetector gesture={panGesture}>
                <Animated.View
                  key={`top-card-${topMovie.id}-${currentIndex}`}
                  style={[
                    styles.cardWrapper,
                    { width: cardW, height: cardH, zIndex: 2 },
                    topCardAnimatedStyle,
                  ]}
                >
                  {renderMovieContent(topMovie, currentIndex, true)}

                  {/* Dynamic Match Stamp */}
                  <Animated.View
                    style={[StyleSheet.absoluteFill, likeStampStyle]}
                    pointerEvents="none"
                  >
                    <Stamp
                      text="MATCH"
                      tint={currentAccent}
                      bg="rgba(0, 0, 0, 0.8)"
                      fg={currentAccent}
                      side="right"
                    />
                  </Animated.View>

                  {/* Nope Stamp */}
                  <Animated.View
                    style={[StyleSheet.absoluteFill, nopeStampStyle]}
                    pointerEvents="none"
                  >
                    <Stamp
                      text="PASS"
                      tint="#f43f5e"
                      bg="rgba(0, 0, 0, 0.8)"
                      fg="#fb7185"
                      side="left"
                    />
                  </Animated.View>
                </Animated.View>
              </GestureDetector>
            )}
          </View>
        )}
      </View>

      {/* Floating Top Header Bar */}
      <View style={styles.topBar} pointerEvents="box-none">
        <Text style={styles.brandTitle}>MOVIEMATCH</Text>
        <View style={[styles.counterPill, { borderColor: `${currentAccent}66` }]}>
          <Text style={[styles.counterText, { color: currentAccent }]}>
            {deck.length > 0 && !isDone
              ? `${currentIndex + 1} / ${deck.length}`
              : `${deck.length} / ${deck.length}`}
          </Text>
        </View>
      </View>

      {/* Floating Bottom Action Buttons (Scaled down 30%, bottom: 98 above floating tab bar) */}
      {!isDone && (
        <View style={styles.actions} pointerEvents="box-none">
          {/* Pass / Nope button */}
          <Pressable
            onPress={() => triggerProgrammaticSwipe('left')}
            accessibilityLabel="Pass"
            style={({ pressed }) => [
              styles.actionButton,
              styles.passButton,
              { transform: [{ scale: pressed ? 0.9 : 1 }] },
            ]}
          >
            <Text style={styles.passButtonText}>✕</Text>
          </Pressable>

          {/* Like button with local project asset & negative glow */}
          <Pressable
            onPress={() => triggerProgrammaticSwipe('right')}
            accessibilityLabel="Like"
            style={({ pressed }) => [
              styles.actionButton,
              styles.likeButton,
              {
                borderColor: currentAccent,
                shadowColor: currentAccent,
                transform: [{ scale: pressed ? 0.92 : 1 }],
              },
            ]}
          >
            <Image
              source={require('@/assets/logo-symbol-removebg-preview1.png')}
              style={styles.likeLogoImage}
              resizeMode="contain"
            />
          </Pressable>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#080d1a',
  },
  topBar: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 30,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 2,
  },
  counterPill: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  counterText: {
    fontSize: 12,
    fontWeight: '700',
  },
  deckArea: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  stackContainer: {
    flex: 1,
    position: 'relative',
  },
  cardWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
  },
  actions: {
    position: 'absolute',
    bottom: 98, // Spaced cleanly above the floating tab bar (bottom: 24, height: 64)
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    zIndex: 40,
  },
  actionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 5,
  },
  passButton: {
    backgroundColor: 'rgba(20, 20, 30, 0.85)',
    borderWidth: 1.5,
    borderColor: '#f43f5e',
    shadowColor: '#f43f5e',
  },
  passButtonText: {
    color: '#f43f5e',
    fontSize: 20,
    fontWeight: 'bold',
  },
  likeButton: {
    backgroundColor: 'rgba(20, 20, 30, 0.85)',
    borderWidth: 1.5,
    padding: 8,
  },
  likeLogoImage: {
    width: 26,
    height: 26,
  },
  emptyCard: {
    alignSelf: 'center',
    marginTop: 'auto',
    marginBottom: 'auto',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  emptySubtitle: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  resetButton: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 20,
  },
  resetButtonText: {
    color: '#080d1a',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
