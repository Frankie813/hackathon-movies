import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { SwipeDeck } from '@/components/SwipeDeck';
import { SEED_MOVIES } from '@/data/seedMovies';
import { useAnonymousAuth } from '@/lib/auth';
import { seedMoviesWithVideo } from '@/lib/seed';
import {
  flushTaste,
  loadTaste,
  LOAD_TIMEOUT_MS,
  removeLike,
  saveLike,
  saveTaste,
} from '@/src/lib/persist';
import type { Movie, TasteVector } from '@/types';

// The deck is the curated offline catalog (lib/seed.json, 68 titles), not
// the hand-written six in data/seedMovies.ts. Titles with a vertical Short
// come first so the full-screen cards lead; the rest play their 16:9 clip.
// The catalog has no per-title theme colours yet, so the hue backdrop's
// colours are carried over from data/seedMovies.ts where the ids overlap and
// fall back to the deck's defaults elsewhere.
const colorsById = new Map(SEED_MOVIES.map((m) => [m.id, m]));
const withColors = (m: Movie): Movie => {
  const styled = colorsById.get(m.id);
  return styled ? { ...m, themeColor: styled.themeColor, negativeColor: styled.negativeColor } : m;
};
const DECK: Movie[] = [
  ...seedMoviesWithVideo.filter((m) => m.video?.short),
  ...seedMoviesWithVideo.filter((m) => !m.video?.short),
].map(withColors);

export default function SwipeScreen() {
  const { uid, isSigningIn } = useAnonymousAuth();
  // null means "still hydrating" — the deck must not mount before this lands
  // or the first cards a judge sees were ranked against an empty vector (#18).
  const [taste, setTaste] = useState<TasteVector | null>(null);
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
      if (!cancelled) setTaste(stored);
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
      if (uid) void saveTaste(uid, vector);
    },
    [uid],
  );

  const handleSwipeLeft = useCallback(
    (index: number, movie: Movie) => {
      console.log(`[Swipe] Swiped LEFT (Nope) on #${index}: ${movie.title}`);
      // A title liked in an earlier run and passed on now must leave the
      // Saved tab, or #41 shows the user a film they explicitly rejected.
      if (uid) void removeLike(uid, movie.id);
    },
    [uid],
  );

  const handleSwipeRight = useCallback(
    (index: number, movie: Movie) => {
      console.log(`[Swipe] Swiped RIGHT (Like) on #${index}: ${movie.title}`);
      // Undebounced: one small write per right swipe, and #41 reads these.
      if (uid) void saveLike(uid, movie.id);
    },
    [uid],
  );

  const handleSwipedAll = useCallback(() => {
    console.log('[Swipe] Swiped all cards in deck');
  }, []);

  if (!taste) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#fbbf24" />
      </View>
    );
  }

  return (
    <SwipeDeck
      movies={DECK}
      initialTaste={taste}
      onTasteChange={handleTasteChange}
      onSwipeLeft={handleSwipeLeft}
      onSwipeRight={handleSwipeRight}
      onSwipedAll={handleSwipedAll}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#080d1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
