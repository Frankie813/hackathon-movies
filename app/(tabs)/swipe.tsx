import React, { useCallback } from 'react';
import { SwipeDeck } from '@/components/SwipeDeck';
import { SEED_MOVIES } from '@/data/seedMovies';
import { seedMoviesWithVideo } from '@/lib/seed';
import type { Movie } from '@/types';

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
      movies={DECK}
      onSwipeLeft={handleSwipeLeft}
      onSwipeRight={handleSwipeRight}
      onSwipedAll={handleSwipedAll}
    />
  );
}
