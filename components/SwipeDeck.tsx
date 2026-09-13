import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
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
import { seedCandidates } from '@/src/lib/candidates';
import { exploreRank } from '@/src/lib/explore';
import { SEED_MOVIES } from '@/data/seedMovies';

export interface SwipeDeckProps {
  movies?: Movie[];
  /**
   * Seeds the taste vector from a previous run (#18), so the first cards on
   * screen are already ranked against what this user liked last time.
   *
   * Must be referentially stable — it drives the deck-reset effect. Pass a
   * value held in state, not a fresh object per render.
   */
  initialTaste?: TasteVector;
  /** Fires after every swipe with the new vector. #18 persists it, debounced. */
  onTasteChange?: (taste: TasteVector) => void;
  onSwipeLeft?: (index: number, movie: Movie) => void;
  onSwipeRight?: (index: number, movie: Movie) => void;
  onSwipedAll?: () => void;
  renderCard?: (movie: Movie, index: number, active: boolean) => React.JSX.Element;
  whyFor?: (movie: Movie) => string | undefined;
  /**
   * Pull related titles from TMDB (#13) as the deck runs low, so it does not
   * dead-end on "DECK COMPLETED" mid-demo. Off makes the deck exactly `movies`
   * and issues no network calls — useful for rehearsing the end-of-deck state.
   */
  autoSeed?: boolean;
}

export interface SwipeDeckRef {
  swipeLeft: () => void;
  swipeRight: () => void;
  resetDeck: () => void;
}

const VELOCITY_THRESHOLD = 380;
const EXIT_DURATION = 200;
/** Like/Pass buttons throw the card the way a flick does: a touch slower, with a little lift. */
const THROW_DURATION = 340;
const THROW_LIFT = -28;
/** Vertical drag (with little sideways drift) that opens or closes the description. */
const DETAILS_SWIPE_DISTANCE = 80;
const DETAILS_SWIPE_MAX_DRIFT = 60;

/** Module-level so the default prop keeps a stable identity across renders. */
const COLD_TASTE: TasteVector = {};

/**
 * Unseen cards left before we ask #13 for more. Low enough that a full deck
 * never triggers a network call, high enough that the request has several
 * swipes to land first: seedCandidates() can take up to 8s on venue Wi-Fi, and
 * if the deck empties before it returns the user sees "DECK COMPLETED" flash
 * and then get replaced — which would be a bad beat to hit in front of judges.
 */
const LOW_WATER = 5;

export const SwipeDeck = forwardRef<SwipeDeckRef, SwipeDeckProps>(function SwipeDeck(
  {
    movies = SEED_MOVIES,
    initialTaste = COLD_TASTE,
    onTasteChange,
    onSwipeLeft,
    onSwipeRight,
    onSwipedAll,
    renderCard,
    whyFor,
    autoSeed = true,
  },
  ref
) {
  const { width, height } = useWindowDimensions();
  const cardW = width;
  const cardH = height;

  // Ranked up front, not after mount: a deck that re-sorts itself once the
  // stored vector lands would shuffle under the judge's thumb (#18).
  const [deck, setDeck] = useState<Movie[]>(() => rank(initialTaste, movies));
  const taste = useRef<TasteVector>(initialTaste);

  // #13's inputs. Liked movies in swipe order — seedCandidates re-ranks them
  // by the current taste vector, so the order here is not load-bearing.
  const likedRef = useRef<Movie[]>([]);
  const seedingRef = useRef(false);
  /**
   * Likes at the last seeding attempt. An attempt that came back empty (every
   * suggestion already in the deck, or the Wi-Fi is down) would otherwise retry
   * on every subsequent swipe; without a new like there is nothing new to ask.
   */
  const seededAtLikeCount = useRef(-1);
  const mounted = useRef(true);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [previousMovie, setPreviousMovie] = useState<Movie | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  // Swipe up on the card: the title block gives way to the TMDB synopsis.
  // Mirrored into a shared value so the gesture worklets can read it.
  const [showDetails, setShowDetails] = useState(false);
  const detailsOpen = useSharedValue(false);
  const setDetails = useCallback(
    (open: boolean) => {
      detailsOpen.value = open;
      setShowDetails(open);
    },
    [detailsOpen]
  );

  const isDone = currentIndex >= deck.length;

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isAnimating = useSharedValue(false);
  const nextCardOpacity = useSharedValue(1);

  const topMovie = deck[currentIndex];

  // Cards to keep mounted underneath the top card so their trailers are
  // already buffered (see TrailerVideoPlayer warm-up) by the time they are
  // promoted. The rest of the deck is re-ranked after every swipe, so the
  // next card depends on the direction: predict both outcomes (usually the
  // same movie) and pre-mount each. Promotion keeps the instance because
  // cards are keyed by movie id within one parent.
  const nextCandidates = useMemo(() => {
    if (!topMovie) return [];
    const rest = deck.slice(currentIndex + 1);
    if (rest.length === 0) return [];
    const seen = new Set<number>();
    const out: Movie[] = [];
    for (const direction of ['right', 'left'] as const) {
      const head = rank(applySwipe(taste.current, topMovie, direction), rest)[0];
      if (head && !seen.has(head.id)) {
        seen.add(head.id);
        out.push(head);
      }
    }
    return out;
    // taste.current changes together with deck/currentIndex in handleSwipeComplete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, currentIndex, topMovie]);

  const currentAccent = topMovie?.negativeColor || previousMovie?.negativeColor || '#fbbf24';
  const currentTheme = topMovie?.themeColor || previousMovie?.themeColor || '#1a233a';

  // Preload upcoming movie posters and trailer backdrops
  useEffect(() => {
    const preloadPool = deck.slice(currentIndex, currentIndex + 5);
    preloadPool.forEach((m) => {
      if (m.poster) {
        Promise.resolve(Image.prefetch(m.poster)).catch(() => {});
      }
      if (m.video?.key) {
        Promise.resolve(
          Image.prefetch(`https://i.ytimg.com/vi/${m.video.key}/maxresdefault.jpg`)
        ).catch(() => {});
      }
    });
  }, [deck, currentIndex]);

  // Sync internal deck when the movies or the seeded taste vector change.
  // Those are the only real dependencies: shared values are stable refs (and
  // under the Reanimated Jest mock they are not, which would make this reset
  // the deck every render).
  useEffect(() => {
    setDeck(rank(initialTaste, movies));
    taste.current = initialTaste;
    likedRef.current = [];
    seededAtLikeCount.current = -1;
    setCurrentIndex(0);
    setPreviousMovie(null);
    setIsTransitioning(false);
    setDetails(false);
    translateX.value = 0;
    translateY.value = 0;
    nextCardOpacity.value = 1;
    isAnimating.value = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movies, initialTaste]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Top up the deck from TMDB once it runs low (#13). Fire-and-forget: it runs
   * alongside the swipe animation rather than blocking it, appends whatever
   * lands, and does nothing at all offline — seedCandidates() resolves to an
   * empty array rather than throwing, so there is no failure path to show.
   */
  const maybeSeedMore = useCallback(
    (currentDeck: Movie[], nextIndex: number) => {
      const liked = likedRef.current;
      if (!autoSeed || liked.length === 0) return;
      if (currentDeck.length - nextIndex > LOW_WATER) return;
      if (seedingRef.current || seededAtLikeCount.current === liked.length) return;

      seedingRef.current = true;
      seededAtLikeCount.current = liked.length;

      seedCandidates(taste.current, liked, {
        deck: currentDeck.map((m) => m.id),
        // The consumed prefix. SwipeDeck keeps swiped cards in `deck` and moves
        // an index instead of shifting, so #13 has to be told which of those
        // ids are behind the user or its pool cap counts them as live cards.
        swiped: currentDeck.slice(0, nextIndex).map((m) => m.id),
      })
        .then((fresh) => {
          if (fresh.length > 0 && mounted.current) setDeck((d) => [...d, ...fresh]);
        })
        .catch(() => {
          // seedCandidates() is documented not to reject. If that ever changes,
          // a dry deck is the correct outcome, not an unhandled rejection.
        })
        .finally(() => {
          seedingRef.current = false;
        });
    },
    [autoSeed]
  );

  // Sequence: Old Deck Out -> index.gif Dynamic Hue Shift & Bloom Glow -> Next Deck In
  const handleSwipeComplete = useCallback(
    (direction: 'left' | 'right') => {
      const swipedIndex = currentIndex;
      const movie = deck[swipedIndex];
      const nextIndex = swipedIndex + 1;

      if (movie) {
        taste.current = applySwipe(taste.current, movie, direction);
        if (direction === 'right') likedRef.current = [...likedRef.current, movie];
        // Retain the consumed prefix so callback indices and end-of-deck
        // behavior stay intact. Only unseen cards may move.
        const nextDeck = [
          ...deck.slice(0, nextIndex),
          ...exploreRank(taste.current, deck.slice(nextIndex)),
        ];
        setDeck(nextDeck);
        maybeSeedMore(nextDeck, nextIndex);
        onTasteChange?.(taste.current);
        setPreviousMovie(movie);
        if (direction === 'left') {
          onSwipeLeft?.(swipedIndex, movie);
        } else {
          onSwipeRight?.(swipedIndex, movie);
        }
      }

      // 1. Enter intermediate transition state
      setIsTransitioning(true);
      setDetails(false);

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
    [currentIndex, deck, maybeSeedMore, onTasteChange, onSwipeLeft, onSwipeRight, onSwipedAll, translateX, translateY, nextCardOpacity, isAnimating, setDetails]
  );

  // Programmatic swipe (Like / Pass buttons): the same off-screen throw a
  // flick produces — rotation follows translateX, plus a small lift.
  const triggerProgrammaticSwipe = useCallback(
    (direction: 'left' | 'right') => {
      if (isDone || isAnimating.value || isTransitioning) return;

      isAnimating.value = true;
      const targetX = direction === 'right' ? width * 1.55 : -width * 1.55;

      translateX.value = withTiming(
        targetX,
        {
          duration: THROW_DURATION,
          easing: Easing.bezier(0.18, 0.9, 0.22, 1),
        },
        (finished) => {
          if (finished) {
            runOnJS(handleSwipeComplete)(direction);
          }
        }
      );
      translateY.value = withTiming(THROW_LIFT, {
        duration: THROW_DURATION,
        easing: Easing.out(Easing.quad),
      });
    },
    [isDone, isAnimating, isTransitioning, width, translateX, translateY, handleSwipeComplete]
  );

  // "Start over" replays the deck, not the user, so the vector is kept as it
  // stands rather than rewound to what was loaded at boot. Rewinding it would
  // also rewind the *stored* vector: the next swipe writes taste.current, so
  // a replay after a long session would overwrite what that session learned.
  const handleReset = useCallback(() => {
    // #13's seeding bookkeeping does reset: the topped-up cards are gone with
    // the deck, so the next like should be free to ask for more.
    likedRef.current = [];
    seededAtLikeCount.current = -1;
    setDeck(rank(taste.current, movies));
    setCurrentIndex(0);
    setPreviousMovie(null);
    setIsTransitioning(false);
    setDetails(false);
    translateX.value = 0;
    translateY.value = 0;
    nextCardOpacity.value = 1;
    isAnimating.value = false;
  }, [movies, translateX, translateY, nextCardOpacity, isAnimating, setDetails]);

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

      // Mostly-vertical drags toggle the description instead of deciding.
      const drift = Math.abs(event.translationX);
      if (drift < DETAILS_SWIPE_MAX_DRIFT) {
        if (event.translationY < -DETAILS_SWIPE_DISTANCE && !detailsOpen.value) {
          runOnJS(setDetails)(true);
          translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
          translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
          return;
        }
        if (event.translationY > DETAILS_SWIPE_DISTANCE && detailsOpen.value) {
          runOnJS(setDetails)(false);
          translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
          translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
          return;
        }
      }

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

  // A plain tap closes the description. Exclusive with the pan: the tap only
  // wins when the finger never moved enough for the pan to activate.
  const tapGesture = Gesture.Tap().onEnd(() => {
    'worklet';
    if (detailsOpen.value) runOnJS(setDetails)(false);
  });
  const cardGesture = Gesture.Exclusive(panGesture, tapGesture);

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
          showDetails={active && showDetails}
          whyLine={whyFor ? whyFor(movie) : undefined}
          // A deck with a whyFor will produce a line for this card sooner or
          // later, so the card holds the slot open from the start rather than
          // growing when it lands (#8, #20).
          expectWhyLine={!!whyFor}
        />
      );
    },
    [renderCard, cardW, cardH, whyFor, showDetails]
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
          <GestureDetector gesture={cardGesture}>
            <View style={[styles.stackContainer, { width: cardW, height: cardH }]}>
              {/* One flat list: pre-mounted next cards first (always invisible:
                  they exist only to buffer their trailer, and must never peek
                  out while the top card is dragged or thrown), then the top
                  card. React matches keys
                  within a single sibling list, so keying every card by movie
                  id here is what lets a promoted card keep its instance and
                  its buffered trailer. The top card stays mounted through the
                  transition; nextCardOpacity keeps it invisible until the hue
                  shift hands off. */}
              {[
                ...nextCandidates.map((movie) => ({ movie, isTop: false })),
                ...(topMovie ? [{ movie: topMovie, isTop: true }] : []),
              ].map(({ movie, isTop }) =>
                isTop ? (
                  <Animated.View
                    key={`card-${movie.id}`}
                    style={[
                      styles.cardWrapper,
                      { width: cardW, height: cardH, zIndex: 2 },
                      topCardAnimatedStyle,
                    ]}
                  >
                    {renderMovieContent(movie, currentIndex, true)}

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
                ) : (
                  <Animated.View
                    key={`card-${movie.id}`}
                    style={[styles.cardWrapper, { width: cardW, height: cardH, zIndex: 1, opacity: 0 }]}
                  >
                    {renderMovieContent(movie, currentIndex + 1, false)}
                  </Animated.View>
                )
              )}
            </View>
          </GestureDetector>
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
