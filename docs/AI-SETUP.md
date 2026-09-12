# AI setup — one pass, ~10 minutes

Do this once per machine, before the clock starts. Everything here is per-person;
nothing in this file needs coordinating with the rest of the team.

## 1. Prerequisites

```bash
node -v      # 22+ (the @google/genai SDK ≥3.0 requires it)
gh auth status
npm i -g firebase-tools && firebase login   # for the Firebase MCP server
```

## 2. Secrets

```bash
cp .env.example .env
```

Fill it in. Read the comments — the split between `EXPO_PUBLIC_*` (ships to the
phone, not secret) and server-only keys is the whole point of the file.

`.env` is gitignored, and agents are blocked from reading it by
`.claude/settings.json`. A `PostToolUse` hook additionally refuses to write a
file containing something that looks like a real key.

Treat `.env` as visible to anything that runs in this repo, agents included —
the deny rule stops casual reads, not code that loads the file on purpose
(`scripts/curate.mjs` has to). Keys you would actually mind leaking belong in
the Cloud Function secret store (#34), per AGENTS.md §3.

### `YOUTUBE_API_KEY` — not yet in `.env.example`

Only `scripts/curate.mjs` (issue #4) uses it, to prove every embed key is
embeddable, public, not age-restricted and not US-region-blocked before it ships
in `lib/seed.json`. It never reaches the app. You only need it to regenerate the
seed — the committed `lib/seed.json` works without it.

1. Enable the API in the same Google Cloud project as Firebase:
   <https://console.cloud.google.com/apis/library/youtube.googleapis.com?project=moviematch-hackwestx>
2. Create an API key:
   <https://console.cloud.google.com/apis/credentials?project=moviematch-hackwestx>
3. Add to `.env` (the restriction dropdown only lists APIs already enabled, so
   enable first, then hard-reload the credentials page):

```bash
YOUTUBE_API_KEY=
MOVIECLIPS_CHANNEL_ID=   # optional; only if the @MOVIECLIPS handle lookup fails
```

## 3. Claude Code

Nothing to install. Open the repo and it picks up:

- `CLAUDE.md` → symlink to `AGENTS.md` (the rules)
- `.mcp.json` → four MCP servers, pre-approved in settings
- `.claude/commands/` → the slash commands below
- `.claude/agents/` → `api-researcher`, `ac-reviewer`
- `.claude/settings.json` → permissions and hooks

On first run, `/mcp` will ask you to authenticate the **github** server via
OAuth. The others need no auth beyond `firebase login`.

## 4. Codex

```bash
bash scripts/setup-codex.sh
```

Codex reads `AGENTS.md` from the repo root on its own. The script only adds the
MCP servers, since Codex keeps those globally in `~/.codex/config.toml` rather
than per-repo.

**What Codex does not get:** slash commands, subagents, the permission allowlist,
and the hooks. Those are Claude Code features. Every rule that actually matters
lives in `AGENTS.md`, which both tools read — so the two stay aligned on
behaviour, just not on convenience.

---

## Slash commands

| Command | What it does |
|---|---|
| `/next A` | Picks the next unblocked issue for owner A, B, or C. Skips anything with an open dependency, ranks P0 → P1 → P2. |
| `/issue 7` | Works issue #7 end to end: reads the issue and the relevant `PLAN.md` section, checks deps, branches, builds against the acceptance criteria, reports each AC honestly. |
| `/ship 7` | Reviews the diff for secrets, commits, pushes, opens a PR with the AC checklist and `Closes #7`. |
| `/standup` | Status against the 24h phase plan: counts by priority and owner, what's blocked, whether the demo path is intact. |
| `/verify-apis` | Re-checks the volatile facts — Gemini model string, ElevenLabs model, SDK versions, free-tier limits — against live docs. Run at the start and again before the demo. |
| `/demo-check` | Audits the six-step demo path against the code that exists, plus the offline fallback, silent-switch handling, key leakage, and attributions. |

## Subagents

| Agent | When |
|---|---|
| `api-researcher` | Before writing any call against Gemini, ElevenLabs, Expo, TMDB, or Firebase. Returns a verified snippet instead of a remembered one. |
| `ac-reviewer` | After finishing an issue, before `/ship`. Checks the diff against the acceptance criteria and the hard rules. |

## MCP servers

| Server | Auth | Use it for |
|---|---|---|
| **context7** | none | Version-accurate SDK docs. The antidote to the plan's "all of this moves fast" warning. |
| **firebase** | `firebase login` | Firestore documents and queries, security rules, Auth users, Hosting, Functions logs. Inspect real session docs when the group flow misbehaves. |
| **github** | OAuth via `/mcp` (Claude) / token (Codex) | Issues, PRs, labels, milestones as structured tools. |
| **playwright** | none (downloads a browser on first use) | Drive the `.tech` landing and `/j/{code}` join page. Console + network output. |

## Hooks

| Hook | Fires | Does |
|---|---|---|
| `check-secrets.mjs` | after every Write/Edit | Blocks the write if the file gained something matching a Google key, ElevenLabs key, GitHub token, JWT, or a server-side secret behind `EXPO_PUBLIC_*`. |
| `typecheck.sh` | when an agent finishes a turn | Runs `tsc --noEmit` once per turn (not per edit — that would be unusably slow) and makes the agent fix errors before stopping. No-ops until the Expo app exists. |

## Permissions

`.claude/settings.json` is set to hackathon mode: reads, `npm`/`npx`/`expo`/
`tsc`/`eslint`/`jest`, local git (`add`, `commit`, `branch`, `checkout`), and
read-only `gh` all run without prompting.

Still prompts: `git push`, `gh issue`/`pr` writes, `firebase deploy`, `eas build`,
`rm`, `npm publish`.

Always refused: reading `.env` or service-account files, `git push --force`,
`git reset --hard`.

To loosen it for yourself without touching the shared file, put your own rules in
`.claude/settings.local.json` — it's gitignored.
