#!/usr/bin/env bash
# SessionStart + CwdChanged hook: make a fresh Claude Code worktree runnable.
#
# Both events are needed, and neither covers the other:
#   CwdChanged  - EnterWorktree mid-session (the cwd watcher fires on old!=new).
#   SessionStart - `claude -w <name>` from the terminal, which starts up already
#                  inside the worktree. No cwd transition happens, so CwdChanged
#                  never fires there. Verified: -w alone left a worktree with no
#                  node_modules and no .env.
#
# Claude Code creates worktrees at .claude/worktrees/<name>. A worktree only
# gets *tracked* files, so it lands without the two things this app cannot run
# without: .env (six EXPO_PUBLIC_FIREBASE_* vars read by lib/firebase.ts) and
# node_modules. Without them Firebase init throws, the demo path is dead, and
# the typecheck Stop hook fails on every turn.
#
# This fires on every cwd change, so it must be cheap and idempotent: it bails
# in a few microseconds unless we just landed in a worktree that needs filling.
# It never blocks — a failed bootstrap leaves a usable worktree you fix by hand.
set -uo pipefail

input=$(cat)
# CwdChanged carries new_cwd; SessionStart only carries cwd.
new_cwd=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(j.new_cwd||j.cwd||"")}catch{}' <<<"$input" 2>/dev/null)

[ -n "$new_cwd" ] && [ -d "$new_cwd" ] || exit 0

# Only ever touch a Claude Code worktree.
case "$new_cwd" in
  */.claude/worktrees/*) ;;
  *) exit 0 ;;
esac

# Nothing to do once it's provisioned — the common case for repeat cd's.
[ -e "$new_cwd/node_modules" ] && [ -e "$new_cwd/.env" ] && exit 0

# The main checkout owns the real .env and node_modules. Ask git rather than
# guessing: --git-common-dir points at the main repo's .git from any worktree.
common=$(git -C "$new_cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
main_repo=$(dirname "$common")
[ -n "$main_repo" ] && [ -d "$main_repo" ] && [ "$main_repo" != "$new_cwd" ] || exit 0

did=()

# Symlink, don't copy: one source of truth for live keys, and rotating a key
# updates every worktree at once.
if [ ! -e "$new_cwd/.env" ] && [ -f "$main_repo/.env" ]; then
  ln -s "$main_repo/.env" "$new_cwd/.env" && did+=(".env -> main checkout")
fi

# cp -Rc is an APFS copy-on-write clone: ~1s and ~0 bytes for 600MB, but a
# fully independent tree, so `npm install` on a branch can't corrupt the parent.
# -R is the portable fallback if the volume isn't APFS.
if [ ! -e "$new_cwd/node_modules" ] && [ -d "$main_repo/node_modules" ]; then
  if cp -Rc "$main_repo/node_modules" "$new_cwd/node_modules" 2>/dev/null \
     || cp -R "$main_repo/node_modules" "$new_cwd/node_modules" 2>/dev/null; then
    did+=("node_modules (cloned)")
  fi
fi

# tsconfig.json lists expo-env.d.ts explicitly; it's gitignored and generated.
if [ ! -e "$new_cwd/expo-env.d.ts" ] && [ -f "$main_repo/expo-env.d.ts" ]; then
  cp "$main_repo/expo-env.d.ts" "$new_cwd/expo-env.d.ts" && did+=("expo-env.d.ts")
fi

[ ${#did[@]} -gt 0 ] && echo "Worktree bootstrapped: ${did[*]}"
exit 0
