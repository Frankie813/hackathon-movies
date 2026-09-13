import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';

import { MoodInput, type AppliedMood } from '@/components/MoodInput';
import { SwipeDeck } from '@/components/SwipeDeck';
import { TopPicks } from '@/components/TopPicks';
import { SEED_MOVIES } from '@/data/seedMovies';
import { useActiveCode } from '@/lib/active-session';
import { useAnonymousAuth } from '@/lib/auth';
import { recordSwipe } from '@/lib/session';
import { getSeen, loadSeen, markSeen } from '@/lib/seen';
import { DECK_MAX, getDeck, isSeedDeck } from '@/lib/tmdb';
import { useWhyLines } from '@/lib/use-why-lines';
// Bundled tags only (#39): the swipe loop never spends an image request.
import { cachedVibeTags, type MoodFilters } from '@/src/lib/gemini';
import { buildNextRound } from '@/src/lib/picks';
import {
  flushTaste,
  loadTaste,
  LOAD_TIMEOUT_MS,
  removeLike,
  saveLike,
  saveTaste,
  saveWatchLater,
} from '@/src/lib/persist';
import type { Movie, TasteVector } from '@/types';

// The catalog has no per-title theme colours yet, so the hue backdrop's
// colours are carried over from data/seedMovies.ts where the ids overlap and
// fall back to the deck's defaults elsewhere.
const colorsById = new Map(SEED_MOVIES.map((m) => [m.id, m]));
const withColors = (m: Movie): Movie => {
  const styled = colorsById.get(m.id);
  return styled ? { ...m, themeColor: styled.themeColor, negativeColor: styled.negativeColor } : m;
};

/**
 * The movies this device already swiped in earlier sessions, so the first deck
 * skips them. Bounded like the taste read: a storage read that never answers
 * must not keep the Swipe tab on a spinner, it just means repeats are allowed.
 */
function seenForDeck(): Promise<ReadonlySet<number>> {
  return Promise.race([
    loadSeen(),
    new Promise<ReadonlySet<number>>((resolve) => setTimeout(() => resolve(getSeen()), LOAD_TIMEOUT_MS)),
  ]);
}

/**
 * The deck comes from #15's fetch layer: TMDB /discover when online, the
 * curated seed catalog (lib/seed.json, 68 titles) when the token is unset or
 * the network is down — the caller can't tell which. Titles with a vertical
 * Short come first so the full-screen cards lead; the rest play their 16:9
 * clip. (The taste vector re-ranks all of this anyway, and since #96 a
 * per-session random tie-break in SwipeDeck decides near-ties, so this order
 * rarely survives past the deal.)
 */
function orderDeck(movies: Movie[]): Movie[] {
  return [...movies.filter((m) => m.video?.short), ...movies.filter((m) => !m.video?.short)].map(
    withColors,
  );
}

export default function SwipeScreen() {
  const { uid, isSigningIn } = useAnonymousAuth();
  // Bottom tabs keep this screen mounted while another tab is open, so the
  // deck is told directly when it is off screen: the trailer pauses there and
  // plays again on return (#100).
  const isFocused = useIsFocused();
  useEffect(() => {
    if (__DEV__) console.log(`[Swipe] tab ${isFocused ? 'focused: trailer plays' : 'blurred: trailer paused'}`);
  }, [isFocused]);
  // The group this device is in, if any (#16). Every swipe below is also
  // recorded there so #17 can rank the group.
  const { code } = useActiveCode();

  // null means "still loading". getDeck() never rejects and is bounded by its
  // own 8s operation budget; offline it answers with seed in ~3s.
  const [deck, setDeck] = useState<Movie[] | null>(null);
  // The mood filtering the deck, if any (#11). null is the default deck.
  const [mood, setMood] = useState<AppliedMood | null>(null);
  /**
   * The end-of-round recommendations (#91, #97). `null` means "still swiping";
   * `'loading'` is the picks screen covering the next round's fetch.
   *
   * Solo only. In a group the deck has no round boundary at all — everyone
   * swipes until the group matches — so this stays null there.
   */
  const [picks, setPicks] = useState<Movie[] | 'loading' | null>(null);
  /**
   * The rest of the round the picks were skimmed off. "Keep swiping" hands
   * this straight to the deck, so the press costs no network at all.
   */
  const nextDeckRef = useRef<Movie[]>([]);
  /** The mood filters as last applied, so round two stays filtered too. */
  const filtersRef = useRef<MoodFilters | undefined>(undefined);
  /**
   * Bumped by every mood-driven reload. The boot fetch below checks it before
   * it commits, so a slow first /discover can never land on top of a deck the
   * user has since re-asked for.
   */
  const deckSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void seenForDeck()
      .then((seen) => getDeck(undefined, { seen }))
      .then((movies) => {
        if (!cancelled && deckSeq.current === 0) setDeck(orderDeck(movies));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // null means "still hydrating" — the deck must not mount before this lands
  // or the first cards a judge sees were ranked against an empty vector (#18).
  const [taste, setTaste] = useState<TasteVector | null>(null);
  /**
   * The live vector, which `taste` deliberately is not: `taste` feeds
   * SwipeDeck's `initialTaste`, and that prop resets the deck when it changes,
   * so it must not move on every swipe. A mood reload re-seeds the deck from
   * this instead, or the swap would silently roll the session's learning back
   * to whatever was on disk at boot.
   */
  const tasteRef = useRef<TasteVector>({});
  // Sign-in has no deadline of its own: loadTaste() gives up after
  // LOAD_TIMEOUT_MS, but nothing bounds signInAnonymously(). On the venue
  // Wi-Fi that accepts a connection and then swallows it, it can stay pending
  // for as long as the demo lasts — and the deck is gated behind it, so the
  // Swipe tab would be a spinner and nothing else (PLAN.md §L).
  const [authTimedOut, setAuthTimedOut] = useState(false);

  useEffect(() => {
    if (!isSigningIn) return;
    const timer = setTimeout(() => setAuthTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isSigningIn]);

  useEffect(() => {
    // Wait for the uid, but only for as long as sign-in takes — and not past
    // the deadline above. Without a uid, loadTaste('') returns {} and the deck
    // starts cold rather than never starting at all; a uid that lands later
    // still persists, and writes merge, so nothing built earlier is lost.
    //
    // Once. A uid that lands late would otherwise re-seed the vector and reset
    // the deck under the user's thumb mid-swipe.
    if ((isSigningIn && !authTimedOut) || taste !== null) return;

    let cancelled = false;
    void loadTaste(uid ?? '').then((stored) => {
      if (cancelled) return;
      tasteRef.current = stored;
      setTaste(stored);
    });

    return () => {
      cancelled = true;
    };
  }, [uid, isSigningIn, authTimedOut, taste]);

  // Tearing the screen down must not strand the last few swipes in the
  // debounce timer. Note that bottom-tab screens stay mounted when you switch
  // tabs, so in practice it is the 2s debounce that covers a tab change and
  // this that covers the navigator going away.
  useEffect(() => {
    if (!uid) return;
    return () => {
      void flushTaste(uid);
    };
  }, [uid]);

  const handleTasteChange = useCallback(
    (vector: TasteVector) => {
      tasteRef.current = vector;
      if (uid) void saveTaste(uid, vector);
    },
    [uid],
  );

  /**
   * Swap the deck for a freshly fetched one (#11). `taste` is re-seeded in the
   * same commit as `deck` because SwipeDeck resets its internal vector to
   * `initialTaste` whenever `movies` changes — handing it the stale boot value
   * would throw away everything this session's swipes taught it.
   */
  const swapDeck = useCallback((movies: Movie[]) => {
    setTaste(tasteRef.current);
    setDeck(orderDeck(movies));
    // Whatever put a new deck on screen — a new round, a mood, clearing one —
    // ends the picks screen. Leaving it up would hide a live deck behind it.
    setPicks(null);
  }, []);

  /**
   * A mood from #22, turned into a deck. Returns false when the filters never
   * reached /discover — showing the same catalog under a new label would be a
   * worse answer than admitting the mood didn't take.
   */
  const applyMood = useCallback(
    async (filters: MoodFilters, text: string) => {
      const seq = (deckSeq.current += 1);
      const movies = await getDeck(filters, { seen: getSeen() });
      if (seq !== deckSeq.current) return true;
      // The offline catalog cannot honour /discover parameters, so a mood that
      // lands there has not been applied to anything, and #11 must say so
      // rather than relabel a deck. isOffline() can't tell: it stays false on
      // the empty-page path, since TMDB did answer. Checked before orderDeck(),
      // which returns a new array.
      if (isSeedDeck(movies)) return false;
      // Held so the next round is filtered the same way — a mood that only
      // survived 30 cards would silently lapse mid-session.
      filtersRef.current = filters;
      swapDeck(movies);
      setMood({ text, tone: filters.tone });
      return true;
    },
    [swapDeck],
  );

  const clearMood = useCallback(async () => {
    const seq = (deckSeq.current += 1);
    const movies = await getDeck(undefined, { seen: getSeen() });
    if (seq !== deckSeq.current) return;
    filtersRef.current = undefined;
    swapDeck(movies);
    setMood(null);
  }, [swapDeck]);

  // One small write per swipe onto this member's session document (#16).
  // Undebounced on purpose: the other phone reacting within a second is the
  // demo beat. Offline the SDK queues it; the promise is never awaited, so a
  // dead network costs nothing on the gesture.
  const recordInSession = useCallback(
    (movie: Movie, dir: 'left' | 'right') => {
      if (!code) return;
      recordSwipe(code, movie.id, dir).catch((cause: unknown) => {
        console.warn('[Swipe] could not record the swipe in the session:', cause);
      });
    },
    [code],
  );

  const handleSwipeLeft = useCallback(
    (index: number, movie: Movie) => {
      console.log(`[Swipe] Swiped LEFT (Nope) on #${index}: ${movie.title}`);
      // Passes count as seen too: the next launch should not deal it again.
      markSeen(movie.id);
      // A title liked in an earlier run and passed on now must leave the
      // Saved tab, or #41 shows the user a film they explicitly rejected.
      if (uid) void removeLike(uid, movie.id);
      recordInSession(movie, 'left');
    },
    [uid, recordInSession],
  );

  // Reel's one-liner under the card (#20). The lines are warmed from the deck's
  // own view of what is coming up, because only it knows the ranking.
  const { whyFor, expectWhyLine, prefetch } = useWhyLines();
  // What the prompt is built from. A ref, not state: this is read when a card
  // changes, never rendered, and re-rendering the deck on every like would
  // remount the pre-warmed trailers.
  const likesRef = useRef<Movie[]>([]);

  const handleUpcoming = useCallback(
    (movies: Movie[]) => prefetch(movies, likesRef.current),
    [prefetch],
  );

  const handleSwipeRight = useCallback(
    (index: number, movie: Movie) => {
      console.log(`[Swipe] Swiped RIGHT (Like) on #${index}: ${movie.title}`);
      markSeen(movie.id);
      likesRef.current = [...likesRef.current, movie];
      // Undebounced: one small write per right swipe, and #41 reads these.
      if (uid) void saveLike(uid, movie.id);
      recordInSession(movie, 'right');
    },
    [uid, recordInSession],
  );

  /**
   * The Watch Later button (#87). The deck also throws the card to the right,
   * so handleSwipeRight runs too: the tap is a save *and* a like, and the taste
   * vector learns from it exactly as it would from the swipe.
   *
   * Nothing removes the row on a later left swipe, unlike removeLike() above.
   * That asymmetry is the point — a pass retracts a signal, but it should not
   * silently throw away a title the user deliberately saved. Removal is the
   * long-press on the Saved tab.
   */
  const handleWatchLater = useCallback(
    (movie: Movie) => {
      console.log(`[Swipe] Watch later: ${movie.title}`);
      if (uid) void saveWatchLater(uid, movie.id);
    },
    [uid],
  );

  /**
   * The round is over (#97). Build the next one — and in a solo session show
   * its top few titles as recommendations first (#91).
   *
   * The picks and the deck behind them come from the same build, which is what
   * lets the picks screen double as cover for a fetch that can take most of
   * eight seconds on venue Wi-Fi. It also means the three titles the user has
   * just declined are not dealt back to them as cards one to three.
   *
   * In a group there is no round boundary: everyone swipes until the group
   * matches (#17), so the next deck is swapped in silently and the user never
   * sees a break.
   */
  const handleSwipedAll = useCallback(() => {
    console.log('[Swipe] Swiped all cards in deck');
    const seq = (deckSeq.current += 1);
    const inGroup = code !== null;
    if (!inGroup) setPicks('loading');

    void buildNextRound(tasteRef.current, likesRef.current, {
      seen: getSeen(),
      filters: filtersRef.current,
    }).then((round) => {
      // The same guard applyMood uses: a mood applied while this was in flight
      // owns the screen now, and a round landing on top of it would throw away
      // the deck the user just asked for.
      if (seq !== deckSeq.current) return;

      if (inGroup) {
        // No picks skimmed off — the group needs every title it can get.
        swapDeck([...round.picks, ...round.deck]);
        return;
      }
      nextDeckRef.current = round.deck;
      setPicks(round.picks);
    });
  }, [code, swapDeck]);

  /** "Keep swiping": the next round is already in hand, so this is instant. */
  const handleKeepSwiping = useCallback(() => {
    const next = nextDeckRef.current;
    nextDeckRef.current = [];
    // An empty next deck would leave the user staring at a deck that is
    // already spent, so re-run the round build instead of swapping nothing in.
    if (next.length === 0) {
      handleSwipedAll();
      return;
    }
    swapDeck(next);
  }, [handleSwipedAll, swapDeck]);

  /**
   * Titles saved from the picks screen, so the bookmark reads as done. Local
   * to this screen: #41's Saved tab is the source of truth, but a round-trip
   * through Firestore to grey out an icon the user just tapped is not worth
   * the latency on a demo network.
   */
  const [savedPicks, setSavedPicks] = useState<ReadonlySet<number>>(new Set());
  const handleSavePick = useCallback(
    (movie: Movie) => {
      console.log(`[Swipe] Saved from top picks: ${movie.title}`);
      setSavedPicks((prev) => new Set(prev).add(movie.id));
      if (uid) void saveWatchLater(uid, movie.id);
    },
    [uid],
  );

  // The picks are worth a why line each — three requests at a natural pause,
  // not in the swipe loop, which is where the 15 RPM budget actually matters.
  useEffect(() => {
    if (picks === null || picks === 'loading' || picks.length === 0) return;
    prefetch(picks, likesRef.current);
  }, [picks, prefetch]);

  if (!taste || !deck) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#fbbf24" />
      </View>
    );
  }

  // In a group the cap comes off entirely and there is no picks screen: the
  // group swipes until it matches (#17), and a deck that stopped at 30 would
  // strand whoever ran out first while the others were still going.
  const inGroup = code !== null;

  return (
    <View style={styles.screen}>
      <SwipeDeck
        movies={deck}
        initialTaste={taste}
        onTasteChange={handleTasteChange}
        onSwipeLeft={handleSwipeLeft}
        onSwipeRight={handleSwipeRight}
        onWatchLater={handleWatchLater}
        onSwipedAll={handleSwipedAll}
        onUpcoming={handleUpcoming}
        whyFor={whyFor}
        expectWhyLine={expectWhyLine}
        vibeFor={cachedVibeTags}
        maxCards={inGroup ? undefined : DECK_MAX}
        seenIds={getSeen}
        renderEmpty={
          inGroup
            ? // A group never stops for picks, but the next deck still takes a
              // moment to land. Without this the built-in "DECK COMPLETED /
              // START OVER" flashes up mid-session and reads like the group
              // hit a dead end while everyone else is still swiping.
              () => (
                <View style={styles.groupRefill}>
                  <ActivityIndicator color="#fbbf24" />
                  <Text style={styles.groupRefillText}>Finding more movies…</Text>
                </View>
              )
            : () => (
                <TopPicks
                  picks={picks === 'loading' ? null : picks}
                  onKeepSwiping={handleKeepSwiping}
                  onSave={handleSavePick}
                  savedIds={savedPicks}
                  whyFor={whyFor}
                />
              )
        }
        paused={!isFocused}
      />
      {/* Sits beside the deck rather than inside it: the sheet is a Modal, so
          nothing here is ever composited over the card's YouTube player. */}
      <MoodInput active={mood} onApply={applyMood} onClear={clearMood} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  loading: {
    flex: 1,
    backgroundColor: '#080d1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupRefill: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  groupRefillText: {
    color: '#9aa1b4',
    fontSize: 15,
  },
});
