---
description: Pick up a GitHub issue — read it, branch, implement against its acceptance criteria
argument-hint: <issue-number>
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch
---

Work issue #$1 end to end. If `$1` is empty, stop and ask for a number.

## Before writing code

1. `gh issue view $1 --json number,title,body,labels,milestone,assignees` — the
   body holds the acceptance criteria, estimate, owner, phase, and dependencies.
2. Claim it: `gh issue edit $1 --add-assignee @me`. Do this without asking —
   it's the one GitHub write AGENTS.md §3 lets you make unprompted. Say that
   you did. If `assignees` in step 1 already shows someone *else*, stop and ask
   before taking it over.
3. Check its dependencies are closed. If one is open, say which and ask whether
   to proceed anyway or switch issues. Don't silently build on a missing base.
4. Read the matching section of `PLAN.md` (§K lists every issue; the linked
   sections hold the real detail — §D content sourcing, §F Gemini schemas,
   §H the scoring algorithm). §G is vacant — the ElevenLabs plan was dropped.
5. If `examples/` has a starting point for this issue — `TrailerCard.tsx` for #7,
   `SwipeDeck.tsx` for #6, `types.ts` for #5, `seed.sample.json` for #4 — read it
   and build on it rather than starting from scratch.
6. For anything calling an external SDK, look the API up with **context7** first.
   `PLAN.md` warns explicitly that Gemini model strings, `@google/genai`,
   and `expo-audio` all move fast. Don't write from memory.

## Branch and build

- Start from a fresh `origin/main`, never from the current HEAD. If there is
  uncommitted work, stop and ask what to do with it first — never bare-stash it,
  the stash stack is shared across worktrees (AGENTS.md §5). Then:

  ```bash
  git fetch origin
  git switch -c <owner-letter>/<number>-<slug> origin/main
  ```

  e.g. `a/7-youtube-trailer-card`. Inside a `claude -w` / `EnterWorktree`
  worktree the checkout is already `origin/main` — just fetch and confirm
  `git log -1 origin/main` matches before branching. Never commit to `main`.
- Restate the acceptance criteria as a checklist at the start, and build
  directly against it. The AC is the scope boundary — don't exceed it.
- Honour the hard rules in AGENTS.md §3, especially: no video files ever, no
  raw keys in the client, validate every Gemini-returned `tmdb_id`.

## Before you report done

Walk the acceptance criteria one by one and mark each:
- **met** — and say how you verified it,
- **needs device verification** — anything about autoplay, muted video, 60fps
  swipe, or the iPhone silent switch. Simulators lie; say so plainly.
- **not met** — and why.

Then run `npx tsc --noEmit` and `npx eslint .` if the app exists. Finally, state
in one line whether the demo path (AGENTS.md §2) still runs, or that you
couldn't check it.

Do not push or open a PR — that's `/ship $1`.
