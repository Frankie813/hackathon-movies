// src/lib/onboarding.ts — cold-start genre picker (issue #9).
//
// A one-screen preference form beats a second swipe surface for the very
// first thing a guest sees: pick the genres you like, hit Done, and the taste
// vector is already primed before the main deck ever renders (PLAN.md §H).
//
// The vector this produces is shaped exactly like applySwipe()'s output
// (`genre:<id>` keys), so rank()/score() in src/lib/taste.ts need no
// special-casing for how a vector came to be — a genre pick and a swipe are
// indistinguishable once they land in Firestore.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { seedMovies } from '@/lib/seed';
import type { TasteVector } from '../types';

/** Set the first time Start is shown; every later launch skips straight to Swipe. */
export const ONBOARDED_KEY = 'moviematch.onboarded';

/**
 * Clears the "has onboarded" flag so the next visit to Start shows the genre
 * picker again, as a preferences reset requires. Never throws.
 */
export async function clearOnboardedFlag(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ONBOARDED_KEY);
  } catch (cause) {
    console.warn('[onboarding] could not clear the onboarded flag:', cause);
  }
}

export interface GenreOption {
  id: number;
  name: string;
  /** A catalog poster for this genre, distinct from every other genre's. */
  poster?: string;
}

/**
 * Every genre present in the offline seed catalog, deduped, alphabetical,
 * each backed by a poster no other genre in the list uses.
 *
 * Most titles carry several genres (Inception is Action, Sci-Fi *and*
 * Adventure), so picking "the first match" independently per genre hands
 * several rows the same poster. Instead this assigns posters greedily in
 * name order: each genre takes the first still-unclaimed poster among its
 * own candidates, falling back to a reused one only if every candidate is
 * already spoken for (68 titles across 15 genres, so that never happens in
 * practice).
 */
export const ONBOARDING_GENRES: GenreOption[] = (() => {
  const names = new Map<number, string>();
  const postersByGenre = new Map<number, string[]>();

  for (const movie of seedMovies) {
    movie.genreIds.forEach((id, i) => {
      if (!names.has(id) && movie.genreNames[i]) names.set(id, movie.genreNames[i]);
      if (!postersByGenre.has(id)) postersByGenre.set(id, []);
      postersByGenre.get(id)?.push(movie.poster);
    });
  }

  const usedPosters = new Set<string>();
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name }) => {
      const candidates = postersByGenre.get(id) ?? [];
      const poster = candidates.find((p) => !usedPosters.has(p)) ?? candidates[0];
      if (poster) usedPosters.add(poster);
      return { id, name, poster };
    });
})();

/**
 * Weight applied per selected genre. Strong enough to visibly re-rank the
 * 68-title catalog after a handful of picks — the same "polarizing" bar the
 * original swipe-based cold start held itself to (PLAN.md §H), just applied
 * directly instead of inferred from swipes on fixed titles.
 */
const GENRE_BOOST = 4;

/** Selected genre ids -> a taste vector, ready for rank()/saveTaste(). */
export function tasteFromGenres(genreIds: readonly number[]): TasteVector {
  const vector: TasteVector = {};
  for (const id of genreIds) vector[`genre:${id}`] = GENRE_BOOST;
  return vector;
}
