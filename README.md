# Setting up Frankie813/hackathon-movies

Three commands get the plan, labels, milestones, and all 42 issues into the repo. About five minutes.

> **Working on this with Claude Code or Codex?** Start at **[docs/AI-SETUP.md](docs/AI-SETUP.md)** —
> ~10 minutes per machine. The rules both tools follow live in **[AGENTS.md](AGENTS.md)**
> (`CLAUDE.md` is a symlink to it). Day-to-day the loop is `/next A` → `/issue 7` → `/ship 7`.

## 1. Commit the plan and examples

```bash
git clone https://github.com/Frankie813/hackathon-movies.git
cd hackathon-movies
# copy this whole folder's contents into the repo root:
#   PLAN.md, .github/issues.json, scripts/create-issues.mjs, scripts/add-to-project.sh, examples/
git add . && git commit -m "Add hackathon plan, issue definitions, and trailer card example" && git push
```

## 2. Create the issues

You need a GitHub token. Fine-grained token (Settings → Developer settings → Fine-grained tokens): repository `hackathon-movies`, permissions **Issues: read and write** and **Metadata: read**. A classic token with `repo` scope also works.

```bash
# preview first — no token needed
DRY_RUN=1 node scripts/create-issues.mjs

# create for real; assignees are optional GitHub usernames for persons A / B / C
GITHUB_TOKEN=ghp_xxx ASSIGNEE_A=frankie813 ASSIGNEE_B=teammate2 ASSIGNEE_C=teammate3 \
  node scripts/create-issues.mjs
```

What it creates, in order:

- 16 labels: `P0` `P1` `P2`, `owner:A-mobile` `owner:B-backend` `owner:C-ai-demo` `owner:all`, `area:*`, `prize-track`
- 6 milestones, one per phase (Setup → Core build → Integration → Group + AI → Polish → Demo prep), so the milestones page doubles as a burndown
- 42 issues, each with description, acceptance-criteria checkboxes, estimate, priority, owner, dependencies, and phase

Because the repo is empty, GitHub issue numbers come out 1–42 and match `PLAN.md` exactly. The script does a second pass to rewrite dependency links with real numbers anyway, so it's safe even if that assumption breaks. Re-running skips anything that already exists.

## 3. (Optional) Project board

If you want a kanban in addition to milestones, `gh` (GitHub CLI) can make one and add every issue:

```bash
gh auth login                      # needs the `project` scope; gh will prompt
bash scripts/add-to-project.sh     # creates "HackWesTX 26" board and adds issues 1–42
```

Then in the board's settings, turn on the **Auto-add** workflow so new issues land in the Todo column automatically.

## Filtering during the hackathon

Useful saved searches on the Issues tab:

- `is:open label:P0` — the demo path, nothing else
- `is:open label:owner:A-mobile milestone:"Phase 1 · Core build (h2–10)"` — one person's next few hours
- `is:open label:prize-track` — everything tied to Gemini or .tech

## Files

| Path | What |
|---|---|
| `PLAN.md` | Full research report + 24h plan (v2.1). Issue numbers match GitHub. |
| `.github/issues.json` | Single source of truth for issues. Edit here, re-run the script. |
| `scripts/create-issues.mjs` | Creates labels, milestones, issues. Node 18+, no dependencies. |
| `scripts/add-to-project.sh` | Optional project board via `gh`. |
| `examples/` | `TrailerCard.tsx`, `SwipeDeck.tsx`, `types.ts`, `seed.sample.json` — starting point for issues 4, 6, 7, 8. |
| `AGENTS.md` | Rules for AI agents — stack decisions, hard rules, workflow. `CLAUDE.md` symlinks here. |
| `docs/AI-SETUP.md` | One-time per-machine setup for Claude Code and Codex; what each command, agent, MCP server and hook does. |
| `.mcp.json` | MCP servers: context7 (docs), firebase, github, playwright. |
| `.claude/` | Slash commands, subagents, permissions, hooks. Claude Code only. |
| `scripts/setup-codex.sh` | Mirrors the MCP servers into `~/.codex/config.toml`. |
| `.env.example` | Key layout. Copy to `.env` (gitignored, and agents can't read it). |
