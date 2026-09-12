#!/usr/bin/env bash
# add-to-project.sh — optional: create a GitHub Projects board and add all issues to it.
# Requires GitHub CLI (`gh`) authenticated with the `project` scope: gh auth login -s project
set -euo pipefail
OWNER="${OWNER:-Frankie813}"
REPO="${REPO:-Frankie813/hackathon-movies}"
TITLE="${TITLE:-HackWesTX 26 — MovieMatch}"

echo "Creating project '$TITLE' for ${OWNER}…"
NUM=$(gh project create --owner "$OWNER" --title "$TITLE" --format json | python3 -c 'import sys,json; print(json.load(sys.stdin)["number"])')
echo "Project #$NUM created."

echo "Adding issues…"
gh issue list --repo "$REPO" --state all --limit 200 --json url --jq '.[].url' | while read -r url; do
  gh project item-add "$NUM" --owner "$OWNER" --url "$url" >/dev/null && echo "  added $url"
done

echo "Done: https://github.com/users/$OWNER/projects/$NUM"
echo "Tip: in the board's Workflows, enable 'Auto-add to project' so new issues land in Todo."
