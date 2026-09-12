---
description: Pick up a GitHub issue — read it, branch, implement against its acceptance criteria
argument-hint: <issue-number>
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch
---

Work issue #$1 end to end. If `$1` is empty, stop and ask for a number.

## Before writing code

1. `gh issue view $1 --json number,title,body,labels,milestone` — the body holds
   the acceptance criteria, estimate, owner, phase, and dependencies.
2. Check its dependencies are closed. If one is open, say which and ask whether
   to proceed anyway or switch issues. Don't silently build on a missing base.
3. Read the matching section of `PLAN.md` (§K lists every issue; the linked
   sections hold the real detail — §D content sourcing, §F Gemini schemas,
   §G ElevenLabs pipeline, §H the scoring algorithm).
4. If `examples/` has a starting point for this issue — `TrailerCard.tsx` for #7,
   `SwipeDeck.tsx` for #6, `types.ts` for #5, `seed.sample.json` for #4 — read it
   and build on it rather than starting from scratch.
5. For anything calling an external SDK, look the API up with **context7** first.
   `PLAN.md` warns explicitly that Gemini model strings, `@google/genai`,
   `expo-audio`, and the ElevenLabs SDK all move fast. Don't write from memory.

## Branch and build

- Branch: `<owner-letter>/<number>-<slug>`, e.g. `a/7-youtube-trailer-card`.
  Never commit to `main`.
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
