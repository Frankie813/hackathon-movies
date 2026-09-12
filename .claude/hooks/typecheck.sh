#!/usr/bin/env bash
# Stop hook: typecheck once when the agent finishes, not on every keystroke.
# `tsc --noEmit` on an Expo project takes 5-15s — running it per-edit would make
# agents unusable. Running it once per turn catches the errors just as well.
#
# No-ops cleanly until the Expo app is scaffolded (issue #1).
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

input=$(cat)
# Claude Code sets this when a Stop hook already blocked once. Honour it or we
# loop forever on an error the agent can't fix.
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

[ -f package.json ] && [ -f tsconfig.json ] || exit 0

out=$(npx --no-install tsc --noEmit 2>&1) && exit 0

echo "Typecheck failed — fix before finishing:" >&2
printf '%s\n' "$out" | head -40 >&2
exit 2
