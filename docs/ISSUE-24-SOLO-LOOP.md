# End-to-end single-player loop (#24)

`getDeck()` (#15) → the taste vector (#12, #18) → `SwipeDeck` (#6) →
`MovieCard` / `TrailerVideoPlayer` (#7), driven from `app/(tabs)/swipe.tsx`,
online and with the Wi-Fi off.

The wiring itself landed with #25. This issue is the checkpoint on top of it:
does the loop actually run end to end, and what breaks when the venue Wi-Fi
does. Nothing here adds a module or an API.

## What is verified automatically

`__tests__/solo-loop.test.tsx` renders the real Swipe screen and drives it
through the Like/Pass buttons. Everything below the screen runs unmocked —
`lib/tmdb`'s mapper, `lib/seed.json`, `src/lib/taste`, `src/lib/explore`,
`components/SwipeDeck`. Only the four things Jest has no version of are
stubbed: the network (`fetch`), the WebView, Firebase, and the native
gradient/icon shims.

Online (fetch answers with TMDB payloads):

- the deck fills from `/discover` + hydration, and the top card is a live TMDB
  title with a playable video key — not the seed catalog wearing its clothes
  (the fixture ids and the seed ids are disjoint, so this is decidable)
- the screen shows a spinner until *both* the catalog and the stored taste
  vector have landed, so no card is ever ranked against a half-loaded vector
- a right swipe re-ranks the unseen tail: liking an action title promotes the
  action block past ten dramas that were physically next in the deck
- the next card is already mounted underneath, buffering its trailer

With the Wi-Fi off (fetch rejects, Firestore reads and writes never settle):

- `getDeck()` falls back to the seed catalog and every card still has a
  validated video key
- the deck starts cold after #18's `LOAD_TIMEOUT_MS` rather than waiting on a
  Firestore read that is never going to answer
- the deck also starts when `signInAnonymously()` never settles — the venue
  Wi-Fi that accepts a connection and then swallows it
- swipes keep re-ranking while every Firestore write sits unacknowledged
- the Wi-Fi can die *mid-deck*, with no restart, and the loop keeps advancing —
  swiped far enough to cross `SwipeDeck`'s `LOW_WATER`, so #13's top-up really
  does go out over the dead network and come back empty rather than the test
  claiming an offline path it never reaches

The tests were checked against two mutations, to confirm they fail for the
right reasons: replacing `exploreRank` with the raw deck order fails exactly
the two re-ranking tests, and making the seed fallback return `[]` fails
exactly the three offline tests.

## What still needs a physical device

Jest and the simulator both lie about all of this (AGENTS.md §6). None of it
is ticked by the test file above.

Online, on a phone:

1. The first card's trailer **autoplays, muted**, within a second or two of the
   deck appearing.
2. Tap-to-unmute produces audio — with the iPhone silent switch **on**.
3. Dragging a card is smooth at 60fps, and the LIKE/PASS stamps track the drag.
4. The card promoted after a swipe is already playing, not starting from its
   poster (see break point 1 — expect roughly one card in five to miss this).
5. The Saved tab (#41) shows what was liked after a reload.

Then, without restarting the app, turn the Wi-Fi off and keep swiping:

6. The deck keeps advancing and never shows an error.
7. Note how long a card sits on the loading GIF before it gives up on the
   trailer (see break point 2 — expect up to 20s).
8. Posters still render for upcoming cards (they were prefetched while online).

## Break points

Logged, not fixed — #24 is a checkpoint, and the fixes belong to the issues
named below.

**1. One card in five is never pre-buffered.** `SwipeDeck.nextCandidates`
predicts the next card with `rank()` and pre-mounts it so its trailer is
warm. `handleSwipeComplete` then picks the next card with `exploreRank()`,
which is ε-greedy: with probability `EPSILON` (0.2) it serves an off-profile
card that nothing predicted, so that card mounts cold and starts from the
poster. It also made `__tests__/SwipeDeck.test.tsx` flaky — its "promoted card
keeps its instance" assertion failed 4 of 20 isolated runs, which matches ε.
That suite pins `Math.random` to the exploit branch as of #8, the same way this
one does, which de-flakes CI but is **not** a fix: the product gap is still
there, and it is what a judge sees as one card in five starting from its
poster. Owner: #6 / #7. Cheapest fix is to have `handleSwipeComplete` and
`nextCandidates` share one pick rather than each making their own.

**2. Offline, a card waits 20 seconds before falling back to the poster.**
`TrailerVideoPlayer` loads a local HTML shell with a `baseUrl`, so the WebView
itself loads fine with no network and `onError` never fires; the only offline
signal is `READY_TIMEOUT_MS`, which is 20s. Until it expires the card shows
`assets/trailer-loading.gif`. Pre-mounted cards start their clock while hidden,
so cards after the first fall back faster. Owner: #26.

**3. The offline catalog is metadata only — posters and backdrops are remote.**
`image.tmdb.org` and `i.ytimg.com` are both unreachable with the Wi-Fi off, and
`MovieCard` falls back to a 🎬 placeholder with the title. Mid-demo this is
mostly hidden, because `SwipeDeck` prefetches five cards ahead while online; a
**cold boot** with no network is the bad case, and it is the one an airplane-mode
rehearsal will hit. Owner: #26.

**4. The hue backdrop is inert for almost every card.** `themeColor` /
`negativeColor` live in `data/seedMovies.ts`, which covers 6 of the 68 catalog
titles and no live TMDB title at all, so `DynamicHueBackdrop` falls back to its
defaults and the colour shift between cards is invisible for the rest.
`app/(tabs)/swipe.tsx` documents this as a known gap. Owner: #8.

**5. The vertical Short format effectively never appears online.**
`orderDeck` leads with titles that have `video.short`, but only 3 seed titles
have one and a live `/discover` deck is unlikely to contain them, so online
every card plays the letterboxed 16:9 clip. Worth knowing before the demo video
is recorded. Owner: #7 / #28.

**6. A session that boots offline stays on seed for its whole life.**
`getDeck()` runs once, on mount, and the Swipe tab stays mounted; if the Wi-Fi
comes back, nothing refetches the deck. #13's candidate seeding is the only way
live titles enter afterwards, and it needs likes first. Minor — the demo runs
online→offline, not the reverse. Owner: #26.

## Running it

```bash
npx tsc --noEmit
npx jest __tests__/solo-loop.test.tsx
```

`react-native-webview` must be installed for the typecheck and for this suite
(and `__tests__/SwipeDeck.test.tsx`, `__tests__/MovieCard.test.tsx`) to run —
`npm install` if a fresh worktree's cloned `node_modules` predates it. ESLint is
not configured in this repository.
