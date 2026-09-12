import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { SwipeDeck } from '@/components/SwipeDeck';
import { useAnonymousAuth } from '@/lib/auth';
import { flushTaste, loadTaste, saveLike, saveTaste } from '@/src/lib/persist';
import type { Movie, TasteVector } from '@/types';

export default function SwipeScreen() {
  const { uid, isSigningIn } = useAnonymousAuth();
  // null means "still hydrating" — the deck must not mount before this lands
  // or the first cards a judge sees were ranked against an empty vector (#18).
  const [taste, setTaste] = useState<TasteVector | null>(null);

  useEffect(() => {
    // Wait for the uid, but only for as long as sign-in takes. If it fails —
    // no network on the first launch — loadTaste('') returns {} and the deck
    // starts cold rather than never starting at all.
    //
    // Once. A uid that lands late would otherwise re-seed the vector and reset
    // the deck under the user's thumb mid-swipe.
    if (isSigningIn || taste !== null) return;

    let cancelled = false;
    void loadTaste(uid ?? '').then((stored) => {
      if (!cancelled) setTaste(stored);
    });

    return () => {
      cancelled = true;
    };
  }, [uid, isSigningIn, taste]);

  // Leaving the tab must not strand the last few swipes in the debounce timer.
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

  const handleSwipeLeft = useCallback((index: number, movie: Movie) => {
    console.log(`[Swipe] Swiped LEFT (Nope) on #${index}: ${movie.title}`);
  }, []);

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
