# AGENTS.md — MovieMatch

Read this before touching anything. It is the single source of truth for both
Claude Code and Codex (`CLAUDE.md` is a symlink to this file — edit this one).

Deep background lives in `PLAN.md`. Read the section named here, not the whole
46KB file, unless you're asked to change the plan itself.

---

## 1. What this is

A clip-first, group-decision movie picker built for HackWesTX 26 in 24 hours by
three people. Swipe through autoplaying YouTube trailers to like/dislike, join a
friend group with a 4-letter code, and get a "group match" that Gemini explains
in one line — naming the trade-off it made between your tastes.

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
5. Gemini's compromise `why` renders on screen on both devices (#21, #10).
6. All of it survives Wi-Fi being switched off (#15 seed fallback, cached Gemini text).

Before you claim any task is done, ask whether step 1–6 still runs. If you
can't verify it, say so rather than assuming.

---

## 3. Hard rules — violating these loses the hackathon

| Rule | Why |
|---|---|
| **Never download, rehost, clip, or proxy actual video files.** Embed the YouTube IFrame player only. | Legal trap. It is the single scoping decision the whole plan rests on (`PLAN.md` §D). |
| **No raw API keys in the client bundle.** Gemini goes through Firebase AI Logic; the TMDB write key never ships. | `EXPO_PUBLIC_*` vars ship to users' phones in plaintext. A `PostToolUse` hook blocks writes that look like leaked keys. |
| **Validate every `tmdb_id` and title Gemini returns against the catalog before displaying it.** | Gemini hallucinates film titles. A made-up movie on screen in front of judges is fatal. |
| **Pin explicit model version strings.** `gemini-3.5-flash`. Never a floating alias. | `gemini-2.0-flash` is shut down and 1.x returns 404. Re-verify at build time with `/verify-apis`. |
| **TMDB attribution must be on the About screen** (#27). "This product uses the TMDB API but is not endorsed or certified by TMDB." | Contractual. TMDB requires the notice plus the approved logo. |
| **Feature freeze at hour 20.** After that: no new features, only demo prep and bug fixes on the path above. | `PLAN.md` §J, phase 5. Over-scoping is the listed #1 risk. |
| **Never `git push` or close a GitHub issue without being asked.** Assigning an issue to yourself is the one exception — see §5. | Three people share this repo. Land work through a PR that references the issue. |
| **Stay on the Firebase Spark (free) plan.** No Cloud Functions, no proxy server, no Blaze. Keep Firebase AI Logic on the **Gemini Developer API** backend. | The v2.2 scope cut removed the only server-side component. The Vertex AI backend would force Blaze back on. |

---

## 4. Stack — decided, do not re-litigate

These were chosen deliberately in `PLAN.md` §E. If you think one is wrong, say
so in one sentence and then use it anyway unless a human overrules you.

- **Client:** Expo / React Native SDK 52+, `expo-router`, TypeScript strict.
- **Swipe:** `rn-swiper-list` (reanimated + gesture-handler). Expo-Go compatible.
- **Video:** `react-native-youtube-iframe` + `react-native-webview`.
- **Audio:** `expo-audio`, used only to set the audio session so unmuted trailer
  audio isn't killed by the iPhone silent switch. **`expo-av` is deprecated —
  never import it.**
- **Backend:** Firebase — Firestore realtime listeners, Anonymous Auth, Hosting.
- **AI:** Gemini via **Firebase AI Logic** (keeps the key server-side).
  The JS SDK is **`@google/genai`**. `@google/generative-ai` is the dead
  predecessor — never install it.
- **Voice:** none. The ElevenLabs track was dropped in v2.2 — the match verdict
  is on-screen text. Don't reintroduce a TTS dependency.
- **Catalog:** TMDB. Prefer video `type` **Clip > Teaser > Trailer**.

### Gotchas that have already been researched — don't rediscover them
- Autoplay only works **muted** on mobile. Add tap-to-unmute in the card chrome.
- Call `setAudioModeAsync({ playsInSilentMode: true })` or the iPhone mute
  switch silences the trailer audio when a judge taps to unmute.
- Never draw UI over the YouTube player. Use a `pointerEvents="none"` wrapper
  and put all chrome below it.
- **`react-native-youtube-iframe` 2.4.x cannot start or mute playback on
  either platform**, so the native `TrailerVideoPlayer.tsx` drives the YouTube
  IFrame API through `react-native-webview` directly. Two independent breaks,
  both verified from installed source: (1) the library loads a remote shell
  page (`lonelycpp.github.io/…/iframe_v2.html`, deployed 2024-06-15) that
  switches on raw-string messages, while the JS wrapper has sent a JSON
  envelope since 2.4.0 — upstream LonelyCpp/react-native-youtube-iframe#376,
  #386, #393, all open; (2) `react-native-webview`'s `postMessage()` on
  Android dispatches to `document` while that page listens on `window`
  (react-native-webview#2980). Symptom: the clip loads to YouTube's cued
  state (poster + play button) and never autoplays. The replacement shell
  uses `autoplay=1&mute=1` player vars (YouTube starts muted playback itself,
  no RN→page command needed) and `injectJavaScript` for unmute/pause/seek.
  `source.baseUrl` must stay set: YouTube rejects API embeds with no HTTP
  Referer (player error 153), which is why `useLocalHTML` without a base URL
  "broke every video".
- There is **no server-side component**: no Cloud Functions, no proxy, no Blaze
  plan. Everything runs on Spark. If you find yourself needing a server, stop
  and raise it — that is a scope change, not an implementation detail.
- Gemini free tier: ~1,500 req/day, 15 RPM. Cache per movie id, exponential
  backoff on 429, and keep LLM calls out of the tight swipe loop.

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

- **Claim the issue before you start.** The moment you begin work on an issue —
  via `/issue N` or because someone asked you to — assign it on GitHub to the
  person you're working for:

  ```bash
  gh issue edit <N> --add-assignee @me
  ```

  `@me` is the authenticated `gh` user, i.e. whoever's machine you're running
  on, which is the human who asked. Do this without asking first; it's cheap and
  reversible, and it's what tells the other two that the issue is taken. Mention
  that you did it. If the issue already has a *different* assignee, stop and ask
  before taking it — someone else may already be mid-flight.
- **Branch:** `<owner>/<issue-number>-<slug>`, e.g. `a/7-youtube-trailer-card`.
- **Never commit to `main` directly.**
- **Commit subject:** `#7 short imperative summary`.
- **Every issue has explicit acceptance criteria.** They are the definition of
  done. Quote them in the PR body and mark each one honestly — if an AC needs a
  physical device and you don't have one, write "needs device verification",
  don't tick the box.
- `.github/issues.json` is the source of truth for issue *text*. If an issue's
  scope changes, edit that file too, so a re-run doesn't resurrect stale text.

### Worktrees

Three people and several agents share this repo, so parallel work belongs in
worktrees rather than in one checkout that everyone fights over.

Two ways in, and they behave differently:

| | Creates | Branch | Bootstrap fires via |
|---|---|---|---|
| `claude -w <name>` from the terminal | `.claude/worktrees/<name>` | `worktree-<name>` | `SessionStart` |
| `EnterWorktree` mid-session | `.claude/worktrees/<name>` | `worktree-<name>` | `CwdChanged` |

Either way the base is `origin/main` — `worktree.baseRef` is pinned to `fresh`
in `.claude/settings.json`, so a worktree never inherits whatever the parent
checkout happens to have open. `.claude/worktrees/` is gitignored; the parent
repo must never see it.

A worktree only gets *tracked* files, so it would otherwise land without `.env`
or `node_modules` and nothing would run. `.claude/hooks/worktree-bootstrap.sh`
fills that in, ~11s once:

- `.env` is **symlinked** to the main checkout. One source of truth for live
  keys — rotate a key once and every worktree follows. Don't replace it with a
  copy.
- `node_modules` is cloned with `cp -Rc` (APFS copy-on-write: measured 15MB real
  for the 606MB tree). Each worktree owns its tree, so `npm install` on a branch
  can't corrupt the parent's.
- `expo-env.d.ts`, which `tsconfig.json` lists and `.gitignore` excludes.

It does *not* copy `.claude/settings.local.json`, deliberately. A worktree here
is nested inside the main repo, so settings resolution already walks up and
finds the parent's — a copy would be a stale overlay that resurrects revoked
permission grants. Claude Code skips it natively for the same reason.

The hook is registered on both events because neither covers the other: `-w`
starts up already inside the worktree, so no cwd transition happens and
`CwdChanged` never fires. It's idempotent, exits in ~40ms when the cwd isn't a
worktree, and never blocks — a failed bootstrap leaves a usable worktree and a
manual fix, not a dead session.

**A worktree reads its own branch's `.claude/settings.json`, not the main
checkout's.** So the hook config only takes effect in worktrees once it is
merged to `main`. Until then, new worktrees land unprovisioned and you bootstrap
by hand:

```bash
# from inside the worktree — reaches back to the main checkout for the script
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
bash "$MAIN/.claude/hooks/worktree-bootstrap.sh" <<< "{\"cwd\":\"$PWD\"}"
```

Worth knowing:
- **The git stash stack is shared across worktrees.** Never bare
  `git stash` / `git stash pop` — you can pop a teammate's work. Make a WIP
  commit instead.
- **A branch can only be checked out in one worktree at a time.**
- Claude Code **locks** its worktrees. To delete one by hand you need
  `git worktree unlock <path>` first, and the branch is `worktree-<name>`.
- Bump a dependency in a worktree and the parent's `node_modules` stays stale
  until you `npm install` there too.
- Exiting with `remove` deletes the worktree *and its branch* — push or open the
  PR first.

### Owners
| | Area | Labels |
|---|---|---|
| **A** | Mobile UI, swipe, video, audio playback | `owner:A-mobile` |
| **B** | Backend, TMDB, Firestore sessions, domain | `owner:B-backend` |
| **C** | Recommendation algorithm, Gemini, demo/pitch | `owner:C-ai-demo` |

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
  and Expo APIs all move fast. Reach for it before writing
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
| `PLAN.md` | Research report + 24h battle plan. §D content sourcing, §F Gemini, §H algorithm, §J timeline, §L risks. §G is vacant (dropped ElevenLabs plan). |
| `.github/issues.json` | Source of truth for all 42 issues. |
| `scripts/create-issues.mjs` | Creates labels, milestones, issues. `DRY_RUN=1` to preview. |
| `scripts/add-to-project.sh` | Optional kanban board via `gh`. |
| `scripts/setup-codex.sh` | Mirrors `.mcp.json` into `~/.codex/config.toml`. |
| `scripts/find-shorts.mjs` | Annotates a seed file with a vertical YouTube Short per movie (`video.short`), official channels first, fan uploads as fallback (`--official-only` to refuse those). Uses YOUTUBE_API_KEY locally; output is committed. |
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
