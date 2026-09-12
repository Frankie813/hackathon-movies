---
description: Commit, push, and open a PR that closes an issue
argument-hint: <issue-number>
allowed-tools: Bash, Read, Grep
---

Ship the work for issue #$1. If `$1` is empty, infer it from the branch name and
confirm with me before continuing.

1. `git status` and `git diff` — review every change. If something unrelated to
   #$1 crept in, say so and ask before including it.
2. Re-read the acceptance criteria: `gh issue view $1 --json title,body`.
3. **Scan the diff for secrets yourself** before committing — an `AIza…` key, an
   `sk_…` ElevenLabs key, a TMDB token, or any server-side key behind an
   `EXPO_PUBLIC_*` name. The hook catches writes, but a `git add` of a file
   written outside this session isn't covered. This is the one check worth
   being paranoid about.
4. Commit as `#$1 <short imperative summary>`. If the change is genuinely
   several steps, several commits are better than one.
5. Push the branch. Then open the PR with a body containing:
   - one line on what changed and why,
   - the acceptance-criteria checklist with honest marks (see `/issue`),
   - anything that still needs verification on a physical device,
   - `Closes #$1`.
6. Report the PR URL.

Push and PR creation both prompt for approval — that's deliberate, three people
share this repo. Don't try to route around it.

Never close the issue by hand; let the PR merge do it.
