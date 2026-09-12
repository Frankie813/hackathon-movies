#!/usr/bin/env bash
# Mirror this repo's .mcp.json into ~/.codex/config.toml.
#
# Codex has no per-repo MCP config — servers are global, in ~/.codex/config.toml.
# Codex does read AGENTS.md from the repo, so instructions are already shared;
# this script closes the remaining gap (tools).
#
# Idempotent: skips any server already present. Backs up config.toml first.
# Usage: bash scripts/setup-codex.sh

set -euo pipefail

CONFIG_DIR="$HOME/.codex"
CONFIG="$CONFIG_DIR/config.toml"

if ! command -v codex >/dev/null 2>&1; then
  echo "warning: 'codex' is not on PATH. Writing the config anyway — it'll apply"
  echo "         once Codex is installed (npm i -g @openai/codex)."
  echo
fi

mkdir -p "$CONFIG_DIR"
touch "$CONFIG"

if [ -s "$CONFIG" ]; then
  backup="$CONFIG.bak.$(date +%Y%m%d%H%M%S)"
  cp "$CONFIG" "$backup"
  echo "Backed up existing config to $backup"
fi

add_server() {
  local name="$1"; shift
  if grep -q "^\[mcp_servers\.$name\]" "$CONFIG"; then
    echo "  = $name already configured, skipping"
    return
  fi
  printf '\n[mcp_servers.%s]\n%s\n' "$name" "$1" >> "$CONFIG"
  echo "  + $name"
}

echo "Adding MCP servers to $CONFIG:"

add_server "context7" 'command = "npx"
args = ["-y", "@upstash/context7-mcp@latest"]'

add_server "firebase" 'command = "npx"
args = ["-y", "firebase-tools@latest", "mcp", "--dir", "'"$(pwd)"'"]'

add_server "playwright" 'command = "npx"
args = ["-y", "@playwright/mcp@latest", "--isolated"]'

# GitHub MCP needs a token in Codex — it has no interactive OAuth flow the way
# Claude Code does. A gh CLI token works if it carries repo scope.
#
# Note: @modelcontextprotocol/server-github is archived upstream (last publish
# 2025-04) but still functional over stdio, which is what Codex wants. If it ever
# breaks, the `gh` CLI covers the same ground — GitHub access is convenience
# here, not a capability the project depends on.
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  TOKEN="$(gh auth token 2>/dev/null || true)"
else
  TOKEN="${GITHUB_TOKEN:-}"
fi

if [ -n "$TOKEN" ]; then
  add_server "github" 'command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_PERSONAL_ACCESS_TOKEN = "'"$TOKEN"'" }'
  echo
  echo "note: your GitHub token is now in plaintext in $CONFIG."
  echo "      That file is outside the repo, but treat it like a secret."
else
  echo "  - github skipped: no token. Set GITHUB_TOKEN or run 'gh auth login', then re-run."
fi

cat <<'DONE'

Done. Next:
  1. Restart Codex so it picks up the new servers.
  2. Codex reads AGENTS.md from the repo root automatically — no action needed.
  3. Codex does NOT read .claude/commands or .claude/settings.json. The slash
     commands and the permission allowlist are Claude Code only; the hard rules
     that matter are all in AGENTS.md, which both tools read.
DONE
