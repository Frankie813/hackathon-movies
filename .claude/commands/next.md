---
description: Pick the next issue to work on for an owner (A, B, or C)
argument-hint: [A|B|C] [optional: phase number]
allowed-tools: Bash(gh issue list:*), Bash(gh issue view:*), Read, Glob, Grep
---

Decide what `$1` should work on next. Owner letter is `$1`; if it's empty, ask
which owner before doing anything else. `$2`, if given, restricts to that phase.

1. Fetch open issues for that owner:
   `gh issue list --state open --label "owner:$1-*" --limit 60 --json number,title,labels,milestone,body`
   (owner label values are `owner:A-mobile`, `owner:B-backend`, `owner:C-ai-demo`;
   also check `owner:all`.)
2. Read `.github/issues.json` for the `dep` field on each candidate — the GitHub
   body has dependencies too, but the JSON is easier to parse reliably.
3. Drop anything whose dependencies are still open. Those are blocked, not next.
4. Rank what's left: `P0` before `P1` before `P2`; within a priority, earlier
   phase first; within a phase, shorter estimate first so something lands soon.
5. Report the top 3 as a short table — number, title, estimate, why it's next —
   then recommend one in a sentence.

Also flag, in one line each, anything worth knowing:
- A `P0` that is blocked by an issue nobody is working on.
- Whether we're past hour 20 of the plan (feature freeze — `P2` work should stop;
  see AGENTS.md §3). You can't know the wall-clock hour, so ask if it matters.

Don't start implementing. This command only decides.
