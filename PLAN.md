# MovieMatch: Research Report & 24-Hour Hackathon Battle Plan (v2.1)

> Repo: https://github.com/Frankie813/hackathon-movies · Issues are generated from `.github/issues.json` by `scripts/create-issues.mjs`. Issue numbers below match GitHub once created on the empty repo.

**v2 changes:** integrates the three HackWesTX 26 prize targets — **Best Use of Gemini API**, **Best Use of ElevenLabs**, and **Best .Tech Domain Name** — into the architecture, timeline, and GitHub issues. New material is marked **(v2)**. Everything else carries over from v1.

---

## A. Executive Summary

**Build a clip-first, group-decision movie picker in Expo (React Native) with Firebase as the backend, Gemini 3.5 Flash for AI-explained recommendations, and an ElevenLabs "film concierge" voice that narrates the match.** The core loop — swipe through autoplaying YouTube trailers (sourced via TMDB) to like/dislike, then join a friend group by code and get a "group match" — is achievable in 24 hours by a disciplined 3-person team. The differentiators grounded in our research are (1) **clips instead of posters**, (2) a **"why you'd like this" AI explanation and natural-language mood filter** via Gemini, (3) **no-account join codes** for instant group sessions, and **(v2)** (4) a **spoken verdict** at the match moment.

The competitive graveyard is instructive: dozens of "Tinder for movies" apps exist (Movie Swiper, StreamPick, Matched, MatchWatch, Match-a-Movie, Cineswipe) and most are solo-dev projects that go quiet within roughly eighteen months. Netflix itself killed its TikTok-style "Fast Laughs" clip feed due to low use. The lessons: onboarding friction and the cold-start problem kill retention; "endless scroll without deciding" is the trap; streaming-availability data is table stakes; and monetization/licensing pressure sinks most. For a hackathon you don't need to solve monetization — you need a demo that produces a decisive, delightful "It's a Match!" moment in under a minute.

The single most important scoping decision: **trailers via YouTube embeds are the pragmatic content path.** Do not attempt to source, download, or clip actual movie footage — that is a legal and technical trap. TMDB's `/videos` endpoint returns YouTube keys for official trailers for free (non-commercial use), and `react-native-youtube-iframe` plays them reliably.

**(v2) Prize strategy in one line:** all three targets reinforce the *same* 10-second demo moment — a friend scans a QR at `yourname.tech`, both swipe, "It's a Match!" fires, and a voice explains the compromise Gemini negotiated. One moment, three prize categories, ~11 added engineering hours spread across the team.

---

## B. (v2) Prize Strategy — HackWesTX 26

Source: mlh.com/events/hackwestx-26/prizes. Eight sponsor categories are offered; we target three and deliberately skip five.

| Prize | Reward | How we qualify | Added effort | Owner |
|---|---|---|---|---|
| **Best Use of Gemini API** | Google swag kits | Three *distinct, non-generic* Gemini uses: (1) per-card "why you'd like this," (2) natural-language mood → TMDB filters via structured output, (3) multi-user compromise negotiation with reasoning. Optional multimodal poster "vibe tags." | ~0h (already core) + 1.5h optional | C |
| **Best Use of ElevenLabs** | Wireless earbuds | "Reel," the AI film concierge, *speaks* the match verdict and can voice the "why" line on any card. Text-to-speech on text Gemini already generates. | ~6h total (C: 4.5h, A: 1.5h) | C + A |
| **Best .Tech Domain Name** | Desktop mics + .tech domain for up to 10 years | Register a creative `.tech` domain (free 1-year via MLH coupon) and make it *functional*: the join link and QR code point at it. Judged on name creativity. | ~2h | B |

**Skipped and why:** Auth0 (login friction undercuts our zero-account join flow), Tiger Data (would replace Firebase for no benefit), Solana (blockchain in a movie picker hurts main-track judging), Backboard (unfamiliar API under time pressure; duplicates our taste vector), Vultr (only relevant if we run a proxy server — see the Cloud Functions note in Section E; if you do, deploy it on Vultr with the free credits and you qualify at zero extra cost).

**Judging realities:**
- **Gemini is the most crowded category** at any MLH event. "We called Gemini" loses. Show judges the JSON schema on a slide, and *narrate* the group negotiation: "Gemini read four people's likes and dislikes and explained the trade-off it made." That framing is rare.
- **ElevenLabs judges look for voice that's integral, not bolted on.** A concierge that reacts to *your group's* specific tastes is integral; a generic welcome message is bolted on.
- **.Tech is judged almost entirely on the name.** A pun beats a description. Spend ten real minutes brainstorming.
- **Submission hygiene matters:** on Devpost, select each prize category explicitly, name each sponsor technology in the writeup with one sentence on what it *did*, and make sure the demo video shows each one on screen. Issue #40 covers this.

**.tech domain candidates** (verify availability at checkout; creativity wins): `whatdowewatch.tech`, `itsamatch.tech`, `swipenight.tech`, `pickaflick.tech`, `nomorescrolling.tech`, `reelmatch.tech`, `popcornvote.tech`, `unscroll.tech`. The MLH coupon code arrives in the day-of hacker email / hack.mlh.io software page; redeem at get.tech/mlh. Register in **hour 0** so DNS has time to propagate.

---

## C. Competitor Analysis

### Similar apps (status as of September 2026)

| App | Status 2026 | Core mechanic | What worked | What failed / complaints |
|---|---|---|---|---|
| **Movie Swiper / Movie Finder** | Active (App Store + Google Play) | Swipe like/dislike, match with partner/group, smart filters, shared watchlist | Clean "dating app for movies" positioning; couples/roommates use case; streaming-platform filters | Poster-based (no clips); crowded generic category |
| **MatchWatch** (matchwatch.tv) | Active, web-based; free, no account required to try | Swipe & match, couples + groups up to 6, multi-region streaming | No app install; active dev; multi-country streaming data | Web-only; poster-based |
| **Movie Night: Film & TV Picker** | Active (heavily marketed on TikTok) | Swipe to match for movie night | Strong influencer marketing | Subscription reported by reviewers at ~$7.99/**week** — widely criticized as disproportionate |
| **Match a Movie** | Active, browser/all devices | Swipe titles on streaming services; invite via link/QR/group id | Zero-friction group join; runs everywhere | Web-only; poster-based |
| **StreamPick** | Active (App Store) | Swipe right/left, find common ground | Free; simple | Poster-based; limited differentiation |
| **Matched** | Active (couples focus) | Swipe titles, collaborative filtering vs. similar users, YouTube preview | Uses collaborative filtering; shows cast/reviews/preview | Requires both to download; couples-only framing |
| **Cineswipe** | Effectively defunct | Swipe with friends, powered by TMDB + JustWatch | Good data-sourcing model to copy | Went quiet — typical solo-dev fate |
| **Likewise** | Active; AI companion "Pix" | Rate a few items → personalized recs; groups | AI assistant; multi-media; social | Not swipe/clip-first; list UX |
| **Taste.io** | Active | Rate to get personalized matches | "Accurate after rating a few"; streaming availability | Availability data "sometimes outdated" |
| **Reelgood** | Active | Streaming guide / universal search | Deep where-to-watch | Guide, not a decision game |
| **Netflix "Fast Laughs"** | **Discontinued** (low use) | TikTok-style vertical clip feed | Proved clip-based discovery UX | Killed for low use; discovery ≠ decision |

The Netflix takeaway is not that clips fail — it's that clips **without a forced decision** fail.

### Key lessons and "what to avoid"

- **The cold-start problem is the #1 killer.** Mitigation: a 6–8 item polarizing onboarding deck to seed the taste vector fast.
- **Onboarding friction kills groups.** The surviving group apps require *no download / no account* to join. Copy this exactly — and **(v2)** put the join link on your .tech domain so it's memorable and scannable.
- **Avoid the "endless scroll without deciding" trap.** Time-boxed sessions and a forced "match" moment.
- **Streaming availability is table stakes** but a complaint source when stale. Show it via TMDB watch providers as a badge, and caveat it.
- **Why most died:** solo-dev, aggressive subscriptions, no legal way to show real clips, low retention. Lean into the *decision* and *social* moments.
- **Poster fatigue:** almost every competitor is poster-based. Clips are your visible wedge.

---

## D. Content Sourcing Recommendation

### The concrete pipeline

```
TMDB /discover/movie  (filter by genre, year, region, watch_provider, vote_count)
    → for each movie: /movie/{id}?append_to_response=videos,watch/providers
        → pick video where type == "Trailer" AND site == "YouTube" → get `key`
        → render via react-native-youtube-iframe (autoplay + mute, `start` param)
        → overlay poster (image.tmdb.org) as skeleton while iframe loads
        → show watch-provider logos (JustWatch data) as "where to watch" badge
```

### TMDB specifics

- **Free for non-commercial use** behind a free API key. Commercial license is ~$149/mo for small companies; a hackathon project is non-commercial.
- **Rate limit:** IP-based, roughly 40–50 req/s — ample.
- **Attribution required:** *"This product uses the TMDB API but is not endorsed or certified by TMDB."* plus an approved TMDB logo, on an About screen (issue #27).
- **Key endpoints:** `/discover/movie`, `/movie/{id}/videos`, `/movie/{id}/similar`, `/movie/{id}/recommendations`, `/movie/{id}/watch/providers`, `/genre/movie/list`, `/search/movie`, `/trending`.

### YouTube trailer embedding

- **Legal path:** embed the official IFrame player via `react-native-youtube-iframe`. **Never download, rehost, or clip video.**
- **Autoplay works only when muted** on mobile; add tap-to-unmute. Use `start` to skip studio logos. You can't reliably force-stop at a timestamp.
- **Gotchas:** embedding-disabled, region-blocked, age-restricted, removed videos. Validate the key, poster fallback, skip card. Test on **physical devices**.

### Fallback plan

**Pre-cache `seed.json` of ~60 movies** (id, title, poster URL, genres, keywords, trailer key, providers) in the repo. If TMDB or Wi-Fi fails, the app reads locally. **(v2)** Extend this to **pre-generated narration audio** for the seed movies (issue #38) so the ElevenLabs demo also survives an outage.

---

## E. Recommended Tech Stack & Architecture

### Client: Expo / React Native (SDK 52+)
- Fastest for a JS team; EAS Build needs no Mac; Expo Go demos via QR.
- **Swipe:** `rn-swiper-list` or `react-native-swipeable-card-stack` (reanimated + gesture-handler, Expo-Go compatible).
- **Video:** `react-native-youtube-iframe` + `react-native-webview`.
- **(v2) Audio playback:** `expo-audio` (the replacement for the deprecated `expo-av`). Call `setAudioModeAsync({ playsInSilentMode: true })` so narration plays even with the iPhone mute switch on — a classic demo-day failure.
- **Navigation:** `expo-router`.

Choose Flutter only if all three already write Dart.

### Backend: Firebase
- **Firestore realtime listeners** for group sessions (`sessions/{code}`), **Anonymous Auth** for no-account joins, **(v2) Firebase Hosting** for the .tech landing/join page.
- **Gemini via Firebase AI Logic** (GA; keeps the key off the client; App Check enforcement becomes mandatory Nov 2, 2026 — optional but recommended now). Works on the free Spark plan with the Gemini Developer API backend.
- **(v2) Cloud Functions gotcha:** Cloud Functions require the **Blaze (pay-as-you-go) plan** — still free within quota, but someone must add a card. You need *one* server-side function to hide the **ElevenLabs** key (`tts`). If nobody wants to add a card, run a 40-line Express proxy on a free host instead — **Vultr's free credits** work and incidentally qualify you for that prize too.

### Architecture (text diagram)

```
┌────────────────────────────────────────────────────────────┐
│  Expo React Native app                                     │
│  • Onboarding deck (cold-start seeding)                     │
│  • Swipe deck: YouTube trailer cards + "why" line           │
│  • Group session: join code / QR → "It's a Match!" reveal   │
│      └─ (v2) concierge voice plays the verdict (expo-audio) │
└──────┬──────────────┬──────────────────┬───────────────────┘
       │              │                  │
  (catalog)     (realtime state)     (AI calls)
       │              │                  │
┌──────▼──────┐ ┌─────▼──────────┐ ┌─────▼──────────────────────┐
│  TMDB API   │ │  Firebase      │ │  Firebase AI Logic ──► Gemini 3.5 Flash
│  discover/  │ │  • Anon Auth   │ │     (why / mood / compromise, JSON)
│  videos/    │ │  • Firestore   │ │                            │
│  providers  │ │  • Hosting ◄───┼─┼── (v2) yourname.tech        │
└─────────────┘ │  • Functions   │ │     landing + /j/{code}    │
 (fallback:     │    `tts` ──────┼─┼──► (v2) ElevenLabs TTS      │
  seed.json +   └────────────────┘ │     eleven_flash_v2_5 → mp3 │
  cached mp3)                      └────────────────────────────┘
```

---

## F. Gemini Integration Plan

### Current API facts (verified September 2026)
- **JS/TS SDK:** `@google/genai` (unified SDK; replaces `@google/generative-ai`). Node 22+ for SDK ≥ 3.0.
- **Models:** `gemini-3.5-flash` / `gemini-3.5-flash-lite` recommended (fast, cheap, structured JSON). Pro models are paid-only. Pin an explicit version string; `gemini-2.0-flash` is shut down and 1.x returns 404. Re-verify the model name at build time.
- **Free tier:** ~1,500 requests/day, 15 RPM (Flash-Lite 30 RPM), no card. Free-tier prompts may be used for training. Use exponential backoff on 429.
- **Structured output:** set `responseMimeType: "application/json"` **and** `responseSchema` in `config` for guaranteed valid JSON.
- **Embeddings:** `gemini-embedding-001` is not available through Firebase AI Logic — server-side only if used.

### Features ranked by impact vs. effort

**#1 — "Why you'd like this" (HIGH impact, LOW effort). P0/P1.**
System prompt: *"You are Reel, a witty film concierge. Given a user's liked movies and one candidate, explain in ONE sentence (max 20 words) why they'd like it. No spoilers."*
```json
{ "type": "object",
  "properties": { "reason": {"type": "string"}, "confidence": {"type": "number"} },
  "required": ["reason"] }
```

**#2 — Natural-language mood filter (HIGH impact, MEDIUM effort). P1.**
"Something funny but not dumb" → structured filters → TMDB `/discover`.
```json
{ "type": "object",
  "properties": {
    "genres": {"type": "array", "items": {"type": "string"}},
    "exclude_genres": {"type": "array", "items": {"type": "string"}},
    "keywords": {"type": "array", "items": {"type": "string"}},
    "min_rating": {"type": "number"},
    "tone": {"type": "string"} },
  "required": ["genres"] }
```

**#3 — Group compromise pick with reasoning (HIGH impact, MEDIUM effort). P1 — the money shot.**
**(v2)** The schema now includes a `narration` field: a spoken-word script, ≤35 words, written in Reel's voice, addressed to the group by name. This is what ElevenLabs reads aloud. Keeping `why` (on-screen) and `narration` (spoken) separate lets each be tuned — text can be denser; speech should be punchy.
```json
{ "type": "object",
  "properties": {
    "pick": {"type": "string"},
    "tmdb_id": {"type": "integer"},
    "why": {"type": "string"},
    "narration": {"type": "string"},
    "runner_up": {"type": "string"} },
  "required": ["pick", "why", "narration"] }
```
Prompt addition: *"`narration` is read aloud by a voice actor. Max 35 words. Address the group directly, name who compromised on what, end with where to watch. Example: 'You three finally agree on something. Everyone gets the action, Sam gets the jokes. It's on Netflix — go.'"*

**#4 — Ranked next-candidates recommender (MEDIUM/MEDIUM). P2.** Validate every returned title against TMDB — it will hallucinate.

**(v2) #5 — Multimodal poster "vibe tags" (MEDIUM impact, LOW-MEDIUM effort). P2 — Gemini-prize insurance.**
Send the poster image (inline base64) + title and ask for three vibe tags (`"neon-noir"`, `"slow burn"`, `"popcorn"`), shown as chips on the card. It's cheap, visibly multimodal, and gives judges a second "whoa" beyond text. Only build it if #1–#3 are done by hour 16.

### (v2) Winning the Gemini category
Ship **#1 + #3** as the core AI story, add **#2** if ahead, keep **#5** as insurance. In the pitch, put the compromise JSON schema on a slide and say the sentence: *"Gemini read three people's swipes, picked a film nobody vetoed, and wrote — then spoke — the reason."* Structured output + multi-user reasoning + voice hand-off is a combination judges won't have seen ten times that day.

---

## G. (v2) ElevenLabs Integration Plan — "Reel," the Film Concierge

### Current API facts (verified September 2026)
- **Free tier:** 10,000 credits/month (~10 minutes of audio), no credit card, **API access included**, premade voices only (the community voice library isn't available via API on free tier). Per-request cap on free tier is ~2,500 characters — irrelevant at our lengths. Free plan requires **attribution** ("Voice by ElevenLabs" on the About screen and Devpost).
- **Models:** `eleven_flash_v2_5` (~75 ms model latency, half the credit cost — **use this**), `eleven_multilingual_v2` (highest quality), `eleven_v3` (most expressive; supports audio tags like `[excited]`, `[whispers]`, `[laughs]` — tempting for the reveal line, but costs 2× credits and has higher latency; stretch only).
- **SDK:** `@elevenlabs/elevenlabs-js` — `client.textToSpeech.convert(voiceId, { text, modelId: "eleven_flash_v2_5", outputFormat: "mp3_44100_128" })`. REST equivalent: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` with header `xi-api-key`. Streaming is supported but unnecessary for 35-word clips.
- **Voice:** pick one premade voice with personality and commit to it (the docs' example id `JBFqnCBsd6RMkjVDRZzb` is a good warm narrator; browse the premade list in the dashboard). Consistency across the demo matters more than the exact choice.

### Where the voice appears
1. **Match reveal (P1, the core use):** "It's a Match!" animation starts → app calls `tts` with Gemini's `narration` → mp3 plays ~1 second into the animation. Pre-warm: fire the Gemini + TTS calls the instant the match is *detected*, before the animation screen mounts, so audio is ready when the poster lands.
2. **Tap-to-hear on any card (P1, cheap):** a small speaker icon on the card reads the "why" line. One line of code once the util exists; gives judges a second touchpoint.
3. **Session kickoff (P2):** "Three of you, sixty seconds, no chickening out." Fun, but skip if behind.

### Pipeline
```
Gemini JSON (narration) → Cloud Function `tts` (holds ELEVENLABS_API_KEY)
   → ElevenLabs convert → mp3 bytes → returned as base64
   → client: hash(text) → check cache dir (expo-file-system)
       → miss: write base64 to cache file → play via expo-audio
       → hit: play cached file (rehearsals + offline demo never spend credits)
```

### Credit math
~150 chars per "why," ~250 per verdict. 10,000 credits ≈ 40–60 narrations — comfortably enough, **but only with caching.** Issue #38 pre-generates audio for every seed movie's "why" line plus three canned group verdicts during the polish phase, so the live demo and all five rehearsals hit cache. Keep a second team member's free ElevenLabs account as a spare key.

### Demo moment (what judges hear)
Phone 2 scans the QR at `whatdowewatch.tech`. Both swipe. Poster slams in with "IT'S A MATCH!" and Reel says: *"You two finally agree on something. Alex gets the heist, Jordan gets the laughs. It's on Netflix — go."* Ten seconds; Gemini, ElevenLabs, and the .tech domain all on screen at once.

---

## H. Recommendation Algorithm Spec

### Data model
```
tasteVector = { "genre:28": +3, "genre:35": -2, "keyword:superhero": +2, "cast:3223": +1, ... }
```
Stored under `users/{uid}/taste`. Each movie is a sparse binary feature vector (genres/keywords/cast).

### Scoring (content-based, milliseconds)
```
score(m) = Σ tasteVector[f] for each feature f in m   (optionally normalized by |features(m)|)
```
Like → +weight on the movie's features; dislike → −weight; re-rank remaining deck.
**Cheap collaborative substitute:** seed candidates from TMDB `/similar` + `/recommendations` for top likes.
**Cold start:** fixed onboarding deck of 6–8 polarizing titles; usable after ~5 swipes.
**Exploration:** ε-greedy, ε≈0.2, inject a trending/random title.

### Group consensus
Compute each member's per-title score, rank by **Average-without-Misery** (drop any title a member swiped left or scored below threshold), tie-break by mutual-like count. Surface the winner with a Tinder-style **"It's a Match!"** the instant a title crosses the mutual threshold. **(v2)** Gemini narrates *why*; ElevenLabs speaks it.

---

## I. Differentiation Strategy

1. **Clips, not posters.** Every surviving competitor is poster-based. We fuse clip engagement *with* a forced decision loop — the thing Fast Laughs lacked.
2. **AI that explains itself — out loud.** "Why you'd like this" plus a *spoken* group compromise is a category first for a swipe app.
3. **Natural-language mood search** inside the swipe loop.
4. **Zero-friction group sessions** — anonymous auth + a memorable `.tech` join link/QR, no downloads for guests.
5. **Time-boxed, converging sessions + streaming badge.**

Pitch line: *"Netflix's Fast Laughs made you scroll; we make you decide — together, in 60 seconds, with an AI that tells you why and says it to your face."*

---

## J. 24-Hour Plan

| Phase | Hours | Focus |
|---|---|---|
| **0. Setup & align** | 0–2 | Repo, Expo scaffold, Firebase project, TMDB + Gemini keys, seed JSON schema, assign issues. **(v2)** Register the `.tech` domain (15 min, B) and create the ElevenLabs account + pick Reel's voice (10 min, C) — both in hour 0. Skeleton demo path: one hardcoded card on screen. |
| **1. Parallel core build** | 2–10 | A: swipe deck + trailer playback. B: TMDB fetch + seed cache + Firestore session/join code. C: scoring model + Gemini "why" + prompts; **(v2)** `tts` function + playback util (#34, #36) once Gemini "why" works. |
| **2. First integration** | 10–14 | Deck → TMDB → scoring, end-to-end on a real device. Seed data works offline. **(v2)** B: landing/join page live on the `.tech` domain (#33). |
| **3. Group + AI** | 14–18 | Realtime session, "It's a Match!" reveal, Gemini compromise (#21 with `narration`). **(v2)** A wires Reel's voice into the reveal (#37). Mood filter if ahead. |
| **4. Polish** | 18–20 | Onboarding deck, animations, error states, About screen with TMDB **and ElevenLabs** attribution, poster fallbacks. **(v2)** Pre-generate + bundle cached narration audio (#38). Multimodal vibe tags (#39) only if everything above is green. |
| **5. FEATURE FREEZE + demo prep** | 20–24 | No new features. Record demo video ×2 (audio on!). Rehearse ×5 on the actual devices/network, silent switch on, Wi-Fi off once. **(v2)** Devpost writeup naming Gemini / ElevenLabs / .tech, select all three prize categories (#40). Submit early. |

**MVP (P0):** swipe deck of trailer cards · like/dislike updates taste vector and re-ranks · join group by code → mutual match · one Gemini feature ("why") · **(v2)** `.tech` domain registered, ElevenLabs key + `tts` function working, prize submission checklist. Watch-later: likes and group matches persist and show in a Saved tab (#41).

**Stretch (P1/P2):** Gemini compromise reveal with narration (aim to include) · **(v2)** Reel's voice in the reveal + tap-to-hear (aim to include) · landing/join page on `.tech` · mood filter · streaming badges · ε-greedy · vibe tags · Gemini ranked recommender.

**Demo script (≈2 min):** (closing beat: after the voice line, one tap to the Saved tab shows the pick on both phones — #42)
1. **Hook (15s):** "What should we watch?" — and the domain on screen: *"we made whatdowewatch.tech."*
2. **Solo swipe (30s):** 3–4 autoplaying trailers; tap the speaker icon → Reel reads Gemini's "why."
3. **Group (45s):** second phone scans the QR from the `.tech` page (no signup); both swipe; **"It's a Match!"** → Reel speaks the compromise; where-to-watch badge visible.
4. **Close (20s):** show the compromise JSON schema on one slide; "built in 24h on Expo + Firebase + Gemini + ElevenLabs." Recorded video on standby.

---

## K. GitHub Issues (mirrors `issues.json` — numbers match the GitHub issue numbers when created on an empty repo)

**Roles:** **A = Mobile UI / swipe / video / audio playback** · **B = Backend / data / TMDB / group sessions / domain** · **C = Recommendation algorithm + Gemini + ElevenLabs + demo/pitch.**

Labels: `P0/P1/P2`, `owner:*`, `area:*`, `prize-track`. Milestones: one per phase.


### Setup / infra
1. **[P0] Scaffold Expo app + navigation** — Create the Expo app (SDK 52+) with expo-router and three route stubs: Onboarding, Swipe, Group. Wrap the root layout in GestureHandlerRootView. *AC:* Runs in Expo Go on a physical device. Tabs/routes navigate between the three stubs. *Est:* 1h. *Dep:* none. *Owner:* A. *Phase:* 0.
2. **[P0] Create Firebase project + Anonymous Auth + Hosting** — Create the Firebase project. Enable Firestore, Anonymous Auth, and Hosting (Hosting will serve the .tech landing/join page). Add the client config to the app. *AC:* App signs in anonymously on launch and logs a uid. Firestore is reachable from the app. Hosting is enabled (default URL loads a placeholder). *Est:* 1h. *Dep:* none. *Owner:* B. *Phase:* 0.
3. **[P0] TMDB, Gemini, and ElevenLabs keys + secrets** — Obtain a TMDB API key. Set up Gemini via Firebase AI Logic (Gemini Developer API backend, works on the free Spark plan). Store the ElevenLabs key as a Cloud Function / proxy secret — never in the app bundle. Decide in this hour whether someone adds a card for the Blaze plan (Cloud Functions) or whether the `tts` proxy runs as a tiny Express server on Vultr free credits. *AC:* A test TMDB call succeeds from the app. A test Gemini call succeeds via Firebase AI Logic. A test ElevenLabs call succeeds from the function/proxy. No raw API key appears in the client bundle. *Est:* 1h. *Dep:* #2. *Owner:* C. *Phase:* 0.
4. **[P0] Shared data model + seed.json with curated clip keys** — Agree the Movie, tasteVector, and Session schemas (see PLAN.md §H and types.ts). Write `scripts/curate.js`: for ~60 movies, pull TMDB `/movie/{id}?append_to_response=videos,watch/providers`, prefer official `type == "Clip"` videos, then Teaser, then Trailer; fall back to a YouTube Data API v3 search restricted to the Movieclips channel; validate each key with `videos.list` (embeddable, not region-blocked for US, not age-restricted); write `key`, `start`, `end`, `source` into `seed.json`. Commit the output. Person C reviews the schema. *AC:* seed.json has ~60 movies with poster, genres, keywords, providers, and a validated video key (or `video: null`). App loads seed.json with Wi-Fi off. Schema reviewed by C. *Est:* 3h. *Dep:* none. *Owner:* B. *Phase:* 0.
5. **[P1] Shared TypeScript types** — One `types.ts` exporting Movie, MovieVideo, TasteVector, Session, Member. *AC:* Imported by all screens and the fetch layer with no `any`. *Est:* 0.5h. *Dep:* #4. *Owner:* C. *Phase:* 0.

### Mobile UI / swipe / video (A)
6. **[P0] Swipe card stack** — Integrate `rn-swiper-list` (reanimated + gesture-handler). Like/Nope stamps positioned in the card chrome (bottom of card), never over the video. Programmatic swipeLeft/swipeRight via ref for the buttons. *AC:* Smooth 60fps swipe on a physical device. onSwipeLeft/Right fire with the card index. Stamps render in the chrome region only. Buttons trigger the same swipe as a gesture. *Est:* 3h. *Dep:* #1. *Owner:* A. *Phase:* 1.
7. **[P0] YouTube trailer/clip card** — `react-native-youtube-iframe` inside a `pointerEvents="none"` wrapper. Muted autoplay, `initialPlayerParams: { start, end, controls: false, rel: false }`, `forceAndroidAutoplay`. Poster shows until onReady and on any error (embed_not_allowed / video_not_found). On `ended`, seekTo(start) to loop the segment. Tap-to-unmute button in the chrome. See TrailerCard.tsx in the examples folder. *AC:* Clip autoplays muted from `start` on iOS and Android devices. Embed-disabled/removed videos fall back to poster without crashing. Unmute works after a tap. No UI is drawn over the player. *Est:* 3h. *Dep:* #1. *Owner:* A. *Phase:* 1.
8. **[P0] Card content overlay (chrome)** — Below the player: title + year, genres, where-to-watch badge(s), Gemini "why" slot, mute toggle, and a speaker-icon placeholder for the ElevenLabs read-aloud. *AC:* Renders entirely from a Movie object. Layout holds for long titles and 3+ providers. *Est:* 2h. *Dep:* #6, #7. *Owner:* A. *Phase:* 1.
9. **[P1] Onboarding polarizing deck (cold start)** — 6–8 fixed titles spanning blockbuster/arthouse, horror/feel-good, old/new. Swipes seed the taste vector, then route to the main deck. *AC:* After onboarding the main deck is visibly personalized. Skippable. *Est:* 1.5h. *Dep:* #6, #12. *Owner:* A. *Phase:* 4.
10. **[P1] "It's a Match!" reveal screen** — Full-screen celebratory reveal on the group match event: poster, title, where-to-watch, Gemini `why`. Expose an onMounted hook so narration audio can start ~1s in. *AC:* Triggers on match event on every member's device. Shows poster + why + providers. Hook fires for audio. *Est:* 2h. *Dep:* #17, #21. *Owner:* A. *Phase:* 3.
11. **[P2] Mood filter input UI** — Text box + suggestion chips ("funny but not dumb", "something to cry to"). Calls the mood-filter function and reloads the deck. *AC:* Typed mood produces a visibly different deck. *Est:* 1.5h. *Dep:* #22. *Owner:* A. *Phase:* 3.
27. **[P1] About screen with attributions** — TMDB notice ("This product uses the TMDB API but is not endorsed or certified by TMDB.") + approved TMDB logo, "Voice by ElevenLabs" (required on the free plan), "Powered by Gemini". *AC:* All three attributions visible in About. *Est:* 0.5h. *Dep:* #1. *Owner:* A. *Phase:* 4.
31. **[P2] EAS build / TestFlight backup** — Installable build in case Expo Go misbehaves on the demo device. *AC:* Build installs and runs the demo path. *Est:* 1.5h. *Dep:* #24. *Owner:* B. *Phase:* 4.
41. **[P1] Saved tab (watch later)** — List of liked movies and group matches from Firestore (`users/{uid}/likes`, `users/{uid}/matches`): poster, title, where-to-watch badge. Long-press to remove. A like is a save — no third swipe direction. *AC:* A like appears in the tab within a second. A group match appears for every member after the reveal. *Est:* 1.5h. *Dep:* #18, #17. *Owner:* A. *Phase:* 3.

### Recommendation algorithm (C)
12. **[P0] Taste vector + scoring model** — Weighted feature dict over TMDB genre ids + keywords + top cast. Like → +w on the movie's features, dislike → −w. score(m) = Σ tasteVector[f] for f in features(m), normalized by feature count. Re-rank remaining deck after each swipe. *AC:* Liking two action movies moves action titles up the deck. Disliking demotes. Runs in < 5 ms for 60 movies. *Est:* 3h. *Dep:* #4. *Owner:* C. *Phase:* 1.
13. **[P1] Similar/recommendations candidate seeding** — For the user's top-3 liked titles, pull TMDB `/similar` and `/recommendations` into the candidate pool (deduped, with video keys resolved by the fetch layer). *AC:* Pool grows with related titles after 5 likes. No duplicates. *Est:* 1.5h. *Dep:* #12, #15. *Owner:* C. *Phase:* 2.
14. **[P2] ε-greedy exploration** — With ε = 0.2, inject a trending/random title instead of the top-scored one so the deck doesn't collapse into one genre. *AC:* Roughly 1 in 5 cards is off-profile. *Est:* 1h. *Dep:* #12. *Owner:* C. *Phase:* 3.

### Backend / data / TMDB / group sessions (B)
15. **[P0] TMDB fetch layer with seed fallback** — `/discover/movie` + `/movie/{id}?append_to_response=videos,watch/providers` mapped to the Movie type. Prefer Clip > Teaser > Trailer for the video key. On any error or offline, return seed.json. *AC:* Returns ≥ 20 movies with video keys when online. Wi-Fi off → seed data, no error surfaced to the user. *Est:* 3h. *Dep:* #3, #4. *Owner:* B. *Phase:* 1.
16. **[P0] Group session + join code (Firestore realtime)** — Create `sessions/{code}` (4-letter code). Members write to `sessions/{code}/members/{uid}` with their likes/dislikes. Every device subscribes with onSnapshot. *AC:* Two devices join the same code and see the member list update live. Swipes appear in Firestore within ~1s. *Est:* 3h. *Dep:* #2. *Owner:* B. *Phase:* 1.
17. **[P0] Match detection (Average-without-Misery) + persist match** — Compute each member's per-title score; rank by Average-without-Misery (exclude any title a member swiped left / scored below threshold); tie-break by mutual-like count. Emit a match event when a title crosses the mutual threshold. On match, write `{tmdbId, sessionCode, matchedAt}` to every member's `users/{uid}/matches` so it shows in the Saved tab. *AC:* A mutual like triggers the match event on all devices. A vetoed title never wins. Match document exists for every member after the reveal. *Est:* 2.5h. *Dep:* #16, #12. *Owner:* B. *Phase:* 3.
18. **[P1] Persist taste vector to Firestore** — Save/load `users/{uid}/taste` and `users/{uid}/likes` (movie ids + timestamps). *AC:* Taste and likes survive an app reload. *Est:* 1h. *Dep:* #12. *Owner:* B. *Phase:* 2.
19. **[P1] QR / shareable join link on the .tech domain** — QR encodes `https://<domain>.tech/j/{code}`. App handles a `moviematch://join/{code}` scheme link. Universal https links need an EAS build + AASA file, so in Expo Go fall back to the scheme link or manual code entry. *AC:* Scanning the QR reaches a page that opens the app or shows the code big. *Est:* 1.5h. *Dep:* #16, #32. *Owner:* B. *Phase:* 3.

### Gemini integration (C)
20. **[P1] Gemini: "why you'd like this" one-liner** — `gemini-3.5-flash` with responseMimeType application/json + responseSchema `{reason: string, confidence: number}`. Input: the user's recent likes + the candidate. Max 20 words, no spoilers, in "Reel" the concierge's voice. Cache per movie id. Exponential backoff on 429. *AC:* Returns a ≤ 20-word reason. Second request for the same movie hits cache. 429 does not crash the deck. *Est:* 2h. *Dep:* #3, #12. *Owner:* C. *Phase:* 1.
21. **[P1] Gemini: group compromise pick + narration script** — Send each member's liked/disliked titles. Schema `{pick, tmdb_id, why, narration, runner_up}`. `narration` is a ≤ 35-word spoken script in Reel's voice addressing the group by name and ending with where to watch (this is what ElevenLabs reads). Validate `tmdb_id` against the catalog before display. *AC:* Returns a title that exists in the session's catalog. why is on-screen text; narration is speakable and ≤ 35 words. *Est:* 2h. *Dep:* #16, #3. *Owner:* C. *Phase:* 3.
22. **[P2] Gemini: natural-language mood → TMDB filters** — Structured output `{genres[], exclude_genres[], keywords[], min_rating, tone}` mapped to TMDB genre ids and fed to `/discover`. *AC:* "funny but not dumb" yields comedy with a rating floor and no slapstick keywords. *Est:* 2h. *Dep:* #15, #3. *Owner:* C. *Phase:* 3.
23. **[P2] Gemini: ranked recommender fallback** — Ask Gemini for a ranked list of next candidates as JSON; validate every title via TMDB search before showing. *AC:* Every returned title resolves to a TMDB id. *Est:* 2h. *Dep:* #20. *Owner:* C. *Phase:* 4.

### Integration & demo prep (all)
24. **[P0] End-to-end single-player loop** — Deck → TMDB/seed → scoring → re-rank, on a real device. A + B pair on this. *AC:* Full solo flow works online and with Wi-Fi off. *Est:* 2h. *Dep:* #6, #7, #12, #15. *Owner:* all. *Phase:* 2.
25. **[P0] End-to-end group flow** — Two devices: join by code, swipe, match reveal, Gemini why, Reel's voice. *AC:* Runs start-to-finish twice in a row without intervention. *Est:* 2h. *Dep:* #16, #17, #10, #21, #37. *Owner:* all. *Phase:* 5.
26. **[P0] Offline fallback verification** — Kill Wi-Fi. Confirm seed data, cached Gemini text, and cached narration mp3 all render/play. *AC:* Demo path works with no network. *Est:* 1h. *Dep:* #24, #38. *Owner:* B. *Phase:* 5.
28. **[P0] Record demo video ×2 (with audio)** — Two clean screen recordings of the full flow including the voice line. Save locally and to Drive. *AC:* Two backups exist and play back with audio. *Est:* 1h. *Dep:* #25. *Owner:* C. *Phase:* 5.
29. **[P0] Pitch deck + 2-minute script** — 5 slides. One slide shows the compromise JSON schema. Script per PLAN.md §J: hook with the domain → solo swipe with Reel reading the why → QR join, match, voice verdict → close naming Expo + Firebase + Gemini + ElevenLabs. *AC:* Deliverable in ≤ 2 minutes when rehearsed. *Est:* 2h. *Dep:* #25. *Owner:* C. *Phase:* 5.
30. **[P1] Demo rehearsal ×5** — Run the live demo five times on the actual devices and venue network. Silent switch ON. One run with Wi-Fi OFF. Log every break point and fix. *AC:* 5 clean runs logged. *Est:* 1.5h. *Dep:* #25. *Owner:* all. *Phase:* 5.
42. **[P2] Closing demo beat: Saved tab on both phones** — After Reel's verdict, one tap to the Saved tab on both devices shows the pick sitting there. Add to the pitch script (#29). *AC:* Beat included in the 2-minute script and rehearsed. *Est:* 0.25h. *Dep:* #41, #25. *Owner:* all. *Phase:* 5.

### Prize track — .Tech domain (B)
32. **[P0] Register the .tech domain (hour 0)** — 10-minute name brainstorm (candidates in PLAN.md §B — a pun beats a description; judged on creativity). Redeem the MLH coupon at get.tech/mlh (code is in the day-of MLH hacker email). Point DNS at Firebase Hosting. Register under a team member's MLH-registered email. *AC:* Domain resolves to Firebase Hosting (allow up to a few hours for DNS). *Est:* 0.5h. *Dep:* #2. *Owner:* B. *Phase:* 0.
33. **[P1] Landing + join page on the .tech domain** — Single static page on Firebase Hosting: app name, one-line pitch, and a `/j/{code}` route that shows the code big, an "Open in app" scheme link, and the Expo Go QR. *AC:* `https://<domain>.tech/j/ABCD` loads on a phone and gets a guest into the session. *Est:* 1.5h. *Dep:* #32, #16. *Owner:* B. *Phase:* 2.

### Prize track — ElevenLabs (C + A)
34. **[P0] ElevenLabs account, voice pick, and `tts` function** — Free account (no card; 10,000 credits/month). Pick Reel's premade voice and commit to it. Cloud Function (or Express proxy) `tts({text}) → {audioBase64}` using `eleven_flash_v2_5`, output `mp3_44100_128`. Key in a secret. Create a spare free account on a second teammate's email. *AC:* curl the function → playable mp3. Key not in the client bundle. *Est:* 1h. *Dep:* #3. *Owner:* C. *Phase:* 0.
35. **[P1] Narration field in Gemini prompts** — Add `narration` to the compromise schema/prompt (#21) with the example line from PLAN.md §F. Optionally a `spoken` variant of the "why" reason (#20). *AC:* narration ≤ 35 words, names who compromised on what, ends with where to watch. *Est:* 0.5h. *Dep:* #21. *Owner:* C. *Phase:* 3.
36. **[P1] TTS playback util with cache (expo-audio)** — `speak(text)`: hash(text) → check expo-file-system cache → miss: call `tts`, write mp3 → play with `expo-audio`. `setAudioModeAsync({ playsInSilentMode: true })` so the iPhone mute switch doesn't kill the demo. *AC:* Second call for the same text makes zero network requests. Plays with the mute switch on. *Est:* 2h. *Dep:* #34. *Owner:* C. *Phase:* 1.
37. **[P1] Wire Reel's voice into the UI** — (a) Match reveal: pre-warm Gemini + TTS the instant the match is detected; play ~1s after the reveal mounts. (b) Speaker icon on the card reads the "why" line. *AC:* Voice plays in both places on a physical device. *Est:* 1.5h. *Dep:* #10, #36. *Owner:* A. *Phase:* 3.
38. **[P1] Pre-generate cached narration audio (offline safety)** — Script that runs `speak()` for every seed movie's "why" line plus three canned group verdicts; bundle the mp3s (or warm the cache dir) so the live demo and all rehearsals never hit ElevenLabs live. B takes this if C is behind. *AC:* Wi-Fi off → reveal still talks. Credit balance unchanged across 5 rehearsals. *Est:* 1h. *Dep:* #36, #4. *Owner:* C. *Phase:* 4.

### Prize track — Gemini hardening + submission (C)
39. **[P2] Gemini multimodal poster "vibe tags"** — Send the poster (inline base64) + title to `gemini-3.5-flash`; JSON `{tags: string[3]}`; render as chips on the card. Gemini-prize insurance — only if #20, #21 are done by hour 16. *AC:* Three sensible tags on ≥ 5 seed movies. Cached per movie. *Est:* 1.5h. *Dep:* #20. *Owner:* C. *Phase:* 4.
40. **[P0] Prize submission checklist** — Devpost: select Best Use of Gemini API, Best Use of ElevenLabs, and Best .Tech Domain Name. Writeup names each sponsor tech with one sentence on what it did. Demo video shows the domain, the JSON schema, and the voice. Attributions present (#27). Submit early, not at the deadline. *AC:* Checklist complete ≥ 30 min before the submission deadline. *Est:* 1h. *Dep:* #28, #29. *Owner:* C. *Phase:* 5.

**Load check (P0 + P1 only):** A ≈ 16h · B ≈ 18h · C ≈ 18.5h · shared ≈ 5.5h. All P2 issues are stretch and can be dropped without touching the demo path. If C is behind at hour 14, B takes #38 and A takes #39 (or drop #39).

---

## L. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Venue Wi-Fi fails / TMDB down | High | High | `seed.json` + cached Gemini text + **(v2)** cached mp3; recorded video ×2. |
| Over-scoping | High | High | Hard P0 list; feature-freeze at hour 20; integrate from hour 10. |
| YouTube trailer won't embed | Medium | Medium | Validate keys; poster fallback; skip card; pre-vet seed trailers. |
| Gemini free-tier 429 | Medium | Medium | Cache per movie; backoff; keep LLM out of the tight swipe loop. |
| API key leaked in client bundle | Medium | High | Firebase AI Logic + App Check for Gemini; `tts` function/proxy for ElevenLabs; never bundle raw keys. |
| Gemini hallucinates titles | Medium | Medium | Validate every `tmdb_id`/title against TMDB. |
| Realtime group sync flaky | Medium | High | Firestore snapshot listeners; test with 2 devices early (#16). |
| Model name changes | Low | Medium | Pin explicit strings; re-verify at build time. |
| **(v2) ElevenLabs credits exhausted** | Medium | High (loses a prize) | Cache by text hash (#36); pre-generate (#38); spare free account on a teammate's email. |
| **(v2) Audio silent on demo iPhone** | High (if unhandled) | High | `playsInSilentMode: true`; rehearse with mute switch on; volume up before walking to judges. |
| **(v2) Cloud Functions need Blaze plan** | Medium | Medium | Decide in hour 0; fallback is a 40-line Express proxy on Vultr free credits (bonus prize eligibility). |
| **(v2) .tech DNS not propagated by demo** | Low–Medium | Low | Register in hour 0; fallback to the Firebase Hosting default URL with the .tech name shown on the slide. |
| **(v2) Gemini category too crowded** | High | Medium | Three distinct uses; JSON schema on a slide; multi-user negotiation framing; optional multimodal tags. |
| Expo Go breaks on a native module | Low | Medium | EAS build backup (#31); chosen libs are Expo-Go compatible. |

---

## M. Sources

- **HackWesTX 26 prizes:** mlh.com/events/hackwestx-26/prizes (Gemini API, ElevenLabs, .Tech, Solana, Tiger Data, Vultr, Backboard, Auth0 categories).
- **.Tech domain offer:** get.tech/mlh (complimentary 1-year Standard .tech with MLH coupon; most-creative-domain prize); hack.mlh.io/software; mlh.com/event-membership.
- **ElevenLabs:** elevenlabs.io/docs (Text to Speech capability, models, free-tier voice-library limits); elevenlabs.io/text-to-speech-api (model list, character limits, audio tags); join.elevenlabs.io developer page (`@elevenlabs/elevenlabs-js`, `eleven_flash_v2_5` example); BIGVU, Cekura, Voice.ai pricing breakdowns (free tier 10,000 credits/month, attribution requirement, per-request caps, pay-as-you-go rates).
- **TMDB API:** developer.themoviedb.org; themoviedb.org forums; api.market "5 Best Movie APIs in 2026."
- **Competitor apps:** App Store / Google Play listings; matchwatch.tv; match-a-movie.com; alternativeto.net; local news coverage of Matched.
- **Netflix Fast Laughs:** TechCrunch; Shortlist; Gulf News.
- **Gemini API:** ai.google.dev (models, pricing, structured output, changelog); firebase.google.com (AI Logic, App Check enforcement date); npmjs.com/@google/genai.
- **Expo / Firebase / libraries:** docs.expo.dev (`expo-audio`, `expo-router`, EAS); firebase.google.com (Hosting, Functions pricing/Blaze); npm/GitHub for `rn-swiper-list`, `react-native-swipeable-card-stack`, `react-native-youtube-iframe`.
- **Recommendation & group-consensus algorithms:** content-based filtering literature; group recommender aggregation strategies (Least Misery, Average-without-Misery, Borda).
- **Hackathon execution:** hackerearth.com; angelhack.com; ainna.ai.

*Verification note:* Gemini model names, ElevenLabs credit costs, and the MLH coupon mechanics were checked against sources dated 2026 but all move quickly — confirm the exact Flash model string, your ElevenLabs credit balance, and the coupon code in the day-of MLH email at build time.
