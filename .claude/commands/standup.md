---
description: Where the team stands against the 24-hour plan
allowed-tools: Bash(gh issue list:*), Bash(gh pr list:*), Bash(git log:*), Bash(git branch:*), Read, Grep
---

Give a fast, honest status read. Keep it under 25 lines — this gets read at 4am.

1. Counts by priority: `gh issue list --state open --json number,labels --limit 100`
   → open vs. closed for `P0`, `P1`, `P2`.
2. Per owner (A / B / C): what's open, what's in flight (open PRs, recent
   branches), what's blocked by an unclosed dependency in `.github/issues.json`.
3. Per milestone/phase: closed vs. total, so the phase burndown is visible.
4. Open PRs awaiting review: `gh pr list --state open`.

Then answer these four directly:

- **Is the demo path (AGENTS.md §2) intact?** Which of its six steps have their
  issues closed, and which are still open. This is the only number that matters.
- **What's the biggest risk right now?** Cross-reference `PLAN.md` §L.
- **Is anyone blocked on someone else?** Name the issue pair.
- **Should P2 work stop yet?** Ask me what hour we're at if you need to know.

End with one sentence: the single most valuable thing the team could do next.
