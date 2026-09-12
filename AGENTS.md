# AGENTS.md — MovieMatch

Read this before touching anything. It is the single source of truth for both
Claude Code and Codex (`CLAUDE.md` is a symlink to this file — edit this one).

Deep background lives in `PLAN.md`. Read the section named here, not the whole
46KB file, unless you're asked to change the plan itself.

---

## 1. What this is

A clip-first, group-decision movie picker built for HackWesTX 26 in 24 hours by
three people. Swipe through autoplaying YouTube trailers to like/dislike, join a
friend group with a 4-letter code, get a "group match" that Gemini explains and
an ElevenLabs voice ("Reel," the film concierge) speaks aloud.

**Current state: planning repo. There is no application code yet.** `PLAN.md`,
`.github/issues.json`, `scripts/`, and `examples/` are all that exist. The Expo
app gets scaffolded by issue #1. If you're reading a rule below about `src/` or
`app/`, it applies from the moment those directories exist.

---

## 2. The demo path — the only thing that truly matters

Everything is judged on one two-minute demo. This sequence must work at all
times; anything that breaks it is a P0 emergency regardless of what issue you
were working on:

1. Swipe deck shows trailer cards that autoplay muted (#6, #7).
2. Like/dislike updates the taste vector and visibly re-ranks the deck (#12).
3. A second phone joins by code or QR (#16, #19).
4. Both swipe → **"It's a Match!"** fires on both devices (#17, #10).
5. Gemini's `why` renders on screen; Reel speaks the `narration` (#21, #37).
6. All of it survives Wi-Fi being switched off (#15 seed fallback, #38 cached mp3).

Before you claim any task is done, ask whether step 1–6 still runs. If you
can't verify it, say so rather than assuming.

---

## 3. Hard rules — violating these loses the hackathon

| Rule | Why |
|---|---|
| **Never download, rehost, clip, or proxy actual video files.** Embed the YouTube IFrame player only. | Legal trap. It is the single scoping decision the whole plan rests on (`PLAN.md` §D). |
| **No raw API keys in the client bundle.** ElevenLabs and TMDB write keys go in the Cloud Function / Express proxy. Gemini goes through Firebase AI Logic. | `EXPO_PUBLIC_*` vars ship to users' phones in plaintext. A `PostToolUse` hook blocks writes that look like leaked keys. |
| **Validate every `tmdb_id` and title Gemini returns against the catalog before displaying it.** | Gemini hallucinates film titles. A made-up movie on screen in front of judges is fatal. |
| **Pin explicit model version strings.** `gemini-3.5-flash`, `eleven_flash_v2_5`. Never a floating alias. | `gemini-2.0-flash` is shut down and 1.x returns 404. Re-verify at build time with `/verify-apis`. |
| **TMDB and ElevenLabs attribution must be on the About screen** (#27). "This product uses the TMDB API but is not endorsed or certified by TMDB." + "Voice by ElevenLabs". | Contractual. ElevenLabs free tier requires it; TMDB requires it plus the approved logo. |
| **Feature freeze at hour 20.** After that: no new features, only demo prep and bug fixes on the path above. | `PLAN.md` §J, phase 5. Over-scoping is the listed #1 risk. |
| **Never `git push` or close a GitHub issue without being asked.** | Three people share this repo. Land work through a PR that references the issue. |

---

## 4. Stack — decided, do not re-litigate

These were chosen deliberately in `PLAN.md` §E. If you think one is wrong, say
so in one sentence and then use it anyway unless a human overrules you.

- **Client:** Expo / React Native SDK 52+, `expo-router`, TypeScript strict.
- **Swipe:** `rn-swiper-list` (reanimated + gesture-handler). Expo-Go compatible.
- **Video:** `react-native-youtube-iframe` + `react-native-webview`.
- **Audio:** `expo-audio`. **`expo-av` is deprecated — never import it.**
- **Backend:** Firebase — Firestore realtime listeners, Anonymous Auth, Hosting.
- **AI:** Gemini via **Firebase AI Logic** (keeps the key server-side).
  The JS SDK is **`@google/genai`**. `@google/generative-ai` is the dead
  predecessor — never install it.
- **Voice:** ElevenLabs `eleven_flash_v2_5`, `mp3_44100_128`, behind a `tts`
  Cloud Function or Express proxy.
- **Catalog:** TMDB. Prefer video `type` **Clip > Teaser > Trailer**.

### Gotchas that have already been researched — don't rediscover them
- Autoplay only works **muted** on mobile. Add tap-to-unmute in the card chrome.
- Call `setAudioModeAsync({ playsInSilentMode: true })` or the iPhone mute
  switch silences your demo. This is listed as a high-likelihood risk.
- Never draw UI over the YouTube player. Use a `pointerEvents="none"` wrapper
  and put all chrome below it.
- Cloud Functions require the **Blaze** plan (a card, still free within quota).
  The documented fallback is a ~40-line Express proxy on Vultr free credits.
- Gemini free tier: ~1,500 req/day, 15 RPM. Cache per movie id, exponential
  backoff on 429, and keep LLM calls out of the tight swipe loop.
- ElevenLabs free tier: 10,000 credits/month ≈ 40–60 narrations. **Cache by
  text hash** (#36) and pre-generate (#38) or rehearsals will burn the budget.

---

## 5. How work flows here

The repo is issue-driven. All 42 issues are live on GitHub, numbered 1–42,
matching `PLAN.md` §K and `.github/issues.json` exactly.

```
/next                 → pick the next unblocked issue for an owner
/issue 7              → read it, branch, implement against its acceptance criteria
/ship 7               → commit, push, open a PR that closes it
/standup              → where the team is against the 24h phase plan
```

- **Branch:** `<owner>/<issue-number>-<slug>`, e.g. `a/7-youtube-trailer-card`.
- **Never commit to `main` directly.**
- **Commit subject:** `#7 short imperative summary`.
- **Every issue has explicit acceptance criteria.** They are the definition of
  done. Quote them in the PR body and mark each one honestly — if an AC needs a
  physical device and you don't have one, write "needs device verification",
  don't tick the box.
- `.github/issues.json` is the source of truth for issue *text*. If an issue's
  scope changes, edit that file too, so a re-run doesn't resurrect stale text.

### Owners
| | Area | Labels |
|---|---|---|
| **A** | Mobile UI, swipe, video, audio playback | `owner:A-mobile` |
| **B** | Backend, TMDB, Firestore sessions, domain | `owner:B-backend` |
| **C** | Recommendation algorithm, Gemini, ElevenLabs, demo/pitch | `owner:C-ai-demo` |

Priority labels: `P0` = demo path, must work. `P1` = aim to include. `P2` =
droppable stretch. **When time is short, P2 work stops. No exceptions.**

---

## 6. Verifying your work

Until the Expo app exists (#1), there is nothing to build and these will no-op.
After it exists, run them before opening a PR:

```bash
npx tsc --noEmit          # types — the bar is zero `any` in shared types (#5)
npx eslint .              # lint
npx expo start            # manual check on a physical device
```

**Simulators lie about this app.** Autoplay, muted video, the iPhone silent
switch, and 60fps swipe all behave differently on real hardware. Any AC
mentioning "physical device" cannot be closed from a simulator — say so.

---

## 7. MCP servers and when to reach for them

Configured in `.mcp.json`. Setup instructions: `docs/AI-SETUP.md`.

- **context7** — Live, version-accurate docs. **Use this instead of recalling
  API shapes from memory.** The plan explicitly warns that Gemini model names,
  the ElevenLabs SDK, and Expo APIs all move fast. Reach for it before writing
  any call against `@google/genai`, `expo-audio`, `expo-router`,
  `rn-swiper-list`, or `react-native-youtube-iframe`.
- **firebase** — Firestore documents and queries, security rules, Auth users,
  Hosting deploys, Functions logs. Use it to inspect real session documents when
  debugging the group flow rather than guessing at the shape.
- **github** — Issues, PRs, labels, milestones as structured tools. The `gh` CLI
  is also authenticated and is fine for quick reads.
- **playwright** — Drive a real browser against the `.tech` landing and
  `/j/{code}` join page (#33). Console and network output included.

---

## 8. Repo map

| Path | What |
|---|---|
| `PLAN.md` | Research report + 24h battle plan. §D content sourcing, §F Gemini, §G ElevenLabs, §H algorithm, §J timeline, §L risks. |
| `.github/issues.json` | Source of truth for all 42 issues. |
| `scripts/create-issues.mjs` | Creates labels, milestones, issues. `DRY_RUN=1` to preview. |
| `scripts/add-to-project.sh` | Optional kanban board via `gh`. |
| `scripts/setup-codex.sh` | Mirrors `.mcp.json` into `~/.codex/config.toml`. |
| `examples/types.ts` | Shared `Movie` / `MovieVideo` shape. Move to the app in #5. |
| `examples/TrailerCard.tsx`, `SwipeDeck.tsx` | Starting points for #6, #7. |
| `examples/seed.sample.json` | Shape of the offline seed catalog built in #4. |
| `docs/AI-SETUP.md` | One-time setup for a teammate's machine. |
| `.claude/commands/` | Slash commands. |
| `.claude/agents/` | Subagent definitions. |

---

## 9. Working style

- **Small, verifiable steps.** One issue per branch. Don't bundle.
- **Say what you didn't verify.** "Autoplay works" is a claim about hardware you
  probably don't have. "Code matches the documented API; needs device check" is
  honest and more useful at 3am.
- **Don't invent scope.** The issue's acceptance criteria are the boundary. If
  you spot an adjacent problem, mention it — don't fix it silently.
- **Prefer the plan's answer over your own.** It encodes research into
  competitors, licensing, and free-tier limits that you cannot re-derive from
  the code.
- **The offline path is not optional.** Venue Wi-Fi failing is rated the highest
  likelihood/highest impact risk in `PLAN.md` §L. Anything you build on the demo
  path needs a seed/cache fallback.
