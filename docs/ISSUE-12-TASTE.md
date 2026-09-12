# Taste vector and scoring (#12)

Import `features`, `applySwipe`, `score`, and `rank` from `src/lib/taste.ts`.
The module is synchronous, pure, and has no network, Firebase, or React imports.

- `features(movie)` returns unique `genre:<id>`, `keyword:<name>`, and
  `cast:<id>` keys. Keywords are trimmed and lowercased; blank keywords are
  omitted. Optional `Movie.castIds` are in billing order; only the first three
  are used. Existing seed data has no cast IDs, so genres and keywords work
  without changing the catalog or fetching credits.
- `applySwipe(vector, movie, 'right' | 'left')` returns a new vector, adding
  +1 for a like or -1 for a dislike to each feature.
- `score(vector, movie)` averages weights across the movie's unique features.
  Missing weights and movies without features score zero.
- `rank(vector, movies)` returns a new array, descending by score. Equal scores
  retain input order. Movie objects and the original array are not modified.

`SwipeDeck` updates its in-memory vector when a swipe completes, then ranks
only the unconsumed suffix. Previously swiped cards cannot reappear. The
existing callbacks, transition, and end-of-deck handling remain in place.
Resetting the deck or replacing its catalog clears the vector and restores the
supplied order. Persistence belongs to #18.

## Validation

Run `npm run typecheck` and `node node_modules/jest/bin/jest.js --runInBand`.
The taste tests cover promotion after two action likes, demotion, normalization,
cast and keyword features, empty input, immutability, stable ties, and a
60-movie benchmark using the bundled catalog.

Desktop measurement: swipe update plus ranking took 0.352 ms median and
0.536 ms p95 over 101 samples after warmup. This is not a phone benchmark.
The full physical-device demo, gesture timing, and visual transition still
need device verification. ESLint is not configured in this repository.
