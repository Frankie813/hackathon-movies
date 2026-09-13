// src/lib/genre-pin.ts — keep serving the onboarding genre despite dislikes.
//
// applySwipe() (src/lib/taste.ts) treats a dislike as a vote against every
// feature the movie carries, genre included — so a run of dislikes on the
// genre picked at onboarding can push its score below everything else within
// a handful of swipes, and the deck moves on before the user has really seen
// what that genre has to offer. This pins the onboarding genre(s) to the
// front of the deck regardless of what the taste vector thinks of it, for the
// first GENRE_PIN_LIMIT titles drawn from it; after that the adaptive ranking
// (src/lib/taste.ts, src/lib/explore.ts) takes over on its own.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Movie, TasteVector } from '../types';
import { rank } from './taste';

const GENRE_PIN_KEY = 'moviematch.genrePin';

/** Titles from the pinned genre(s) the deck will force to the front before giving up on it. */
export const GENRE_PIN_LIMIT = 6;

export interface GenrePin {
  genreIds: number[];
  /** Pinned-genre titles swiped so far, either direction. */
  count: number;
}

function isGenrePin(value: unknown): value is GenrePin {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as GenrePin).genreIds) &&
    (value as GenrePin).genreIds.every((id) => typeof id === 'number') &&
    typeof (value as GenrePin).count === 'number'
  );
}

/** The active pin, or null if there isn't one (onboarding Skip, spent, or never set). Never throws. */
export async function getGenrePin(): Promise<GenrePin | null> {
  try {
    const raw = await AsyncStorage.getItem(GENRE_PIN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGenrePin(parsed) || parsed.genreIds.length === 0) return null;
    return parsed;
  } catch (cause) {
    console.warn('[genre-pin] could not read the pin:', cause);
    return null;
  }
}

/** Pass null to clear the pin — onboarding Skip, or a preferences reset. Never throws. */
export async function setGenrePin(pin: GenrePin | null): Promise<void> {
  try {
    if (pin && pin.genreIds.length > 0) {
      await AsyncStorage.setItem(GENRE_PIN_KEY, JSON.stringify(pin));
    } else {
      await AsyncStorage.removeItem(GENRE_PIN_KEY);
    }
  } catch (cause) {
    console.warn('[genre-pin] could not save the pin:', cause);
  }
}

function matchesPin(movie: Movie, genreIds: number[]): boolean {
  return movie.genreIds.some((id) => genreIds.includes(id));
}

/**
 * Ranks `deck` normally, except while the pin still has budget left it forces
 * the best-scoring pinned-genre title to the front — even one the taste
 * vector itself would rank low, which is exactly what a string of dislikes on
 * that genre produces.
 *
 * Falls through to a plain rank() once the pin is spent or the deck has
 * nothing left from that genre — from there the caller's own ranking (e.g.
 * exploreRank) is what decides what's next.
 */
export function pinnedRank(pin: GenrePin | null, v: TasteVector, deck: Movie[]): Movie[] {
  if (!pin || pin.count >= GENRE_PIN_LIMIT) return rank(v, deck);

  const pinnedUnseen = deck.filter((movie) => matchesPin(movie, pin.genreIds));
  if (pinnedUnseen.length === 0) return rank(v, deck);

  const [best] = rank(v, pinnedUnseen);
  return [best, ...rank(v, deck.filter((movie) => movie !== best))];
}

/** True when swiping `movie` should count against the pin's budget. */
export function countsTowardPin(pin: GenrePin | null, movie: Movie): boolean {
  return !!pin && pin.count < GENRE_PIN_LIMIT && matchesPin(movie, pin.genreIds);
}
