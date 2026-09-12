---
description: Rehearse the demo path against reality and find what would break in front of judges
allowed-tools: Bash, Read, Grep, Glob, mcp__firebase, mcp__playwright
---

The whole hackathon is judged on one two-minute demo. Audit it.

Walk each step of the demo path (AGENTS.md §2) and, for each, determine whether
the code to support it actually exists, whether its issue is closed, and what its
failure mode is:

1. Trailer cards autoplay muted (#6, #7)
2. Swipes re-rank the deck (#12)
3. Second phone joins by code/QR (#16, #19)
4. "It's a Match!" fires on both devices (#17, #10)
5. Gemini's compromise `why` renders on both devices (#21, #10)
6. All of it survives Wi-Fi off (#15 seed fallback, cached Gemini text)

Then check the things that have actually killed hackathon demos, from `PLAN.md` §L:

- **Offline:** does `seed.json` exist with ~60 movies and validated video keys?
  Does the fetch layer fall back to it silently? Is Gemini's `why` text cached so
  it still renders with the network off?
- **Silent switch:** is `setAudioModeAsync({ playsInSilentMode: true })` actually
  called? Grep for it. Only trailer audio depends on it now, but a judge tapping
  unmute to silence is still a bad look.
- **Video keys:** any seed movie with a null or unvalidated key will show a bare
  poster. Count them.
- **Key leakage:** grep the client source for `AIza`, `sk_`, and any
  `EXPO_PUBLIC_*` holding a server-side secret.
- **Gemini hallucination:** is every returned `tmdb_id` validated against the
  catalog before it renders?
- **Rate limits:** is the Gemini "why" cached per movie id? Uncached rehearsals
  burn the Gemini free tier (~1,500 req/day, 15 RPM).
- **Landing page:** if the `.tech` domain is live, hit `/j/ABCD` with playwright
  and report console errors.
- **Attributions:** TMDB notice + logo, "Powered by
  Gemini" on the About screen (#27). Missing attribution can disqualify.
- **Backups:** do two recorded demo videos exist (#28)?

Report as a numbered list of concrete problems, worst first, each with the issue
number that fixes it. If the path is clean, say which parts you could not verify
without a physical device — don't imply more confidence than you have.
