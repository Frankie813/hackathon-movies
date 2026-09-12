import { SEED_MOVIES } from '../data/seedMovies';
import type { Movie } from '../types';

describe('Seed Movies Data & Types', () => {
  it('contains valid curated movies', () => {
    expect(SEED_MOVIES.length).toBeGreaterThan(0);
  });

  it('validates each movie has required properties', () => {
    SEED_MOVIES.forEach((movie: Movie) => {
      expect(movie.id).toBeDefined();
      expect(typeof movie.id).toBe('number');
      expect(movie.title).toBeTruthy();
      expect(typeof movie.year).toBe('number');
      expect(Array.isArray(movie.genreIds)).toBe(true);
      expect(Array.isArray(movie.genreNames)).toBe(true);
      expect(Array.isArray(movie.keywords)).toBe(true);
      expect(typeof movie.poster).toBe('string');
      expect(Array.isArray(movie.providers)).toBe(true);

      if (movie.video) {
        expect(typeof movie.video.key).toBe('string');
        expect(typeof movie.video.start).toBe('number');
        expect(typeof movie.video.end).toBe('number');
        expect(['tmdb-clip', 'movieclips', 'trailer']).toContain(movie.video.source);
      }
    });
  });
});
