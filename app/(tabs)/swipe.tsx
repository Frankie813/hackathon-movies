import React, { useCallback } from 'react';
import { SwipeDeck } from '@/components/SwipeDeck';
import type { Movie } from '@/types';

export default function SwipeScreen() {
  const handleSwipeLeft = useCallback((index: number, movie: Movie) => {
    console.log(`[Swipe] Swiped LEFT (Nope) on #${index}: ${movie.title}`);
  }, []);

  const handleSwipeRight = useCallback((index: number, movie: Movie) => {
    console.log(`[Swipe] Swiped RIGHT (Like) on #${index}: ${movie.title}`);
  }, []);

  const handleSwipedAll = useCallback(() => {
    console.log('[Swipe] Swiped all cards in deck');
  }, []);

  return (
    <SwipeDeck
      onSwipeLeft={handleSwipeLeft}
      onSwipeRight={handleSwipeRight}
      onSwipedAll={handleSwipedAll}
    />
  );
}
