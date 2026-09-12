#!/usr/bin/env node
// sync-issue-bodies.mjs — pushes the rendered body from .github/issues.json to
// every matching GitHub issue. Idempotent: skips issues whose body already
// matches, so it is safe to re-run after editing one entry.
//
// Usage:
//   DRY_RUN=1 node scripts/sync-issue-bodies.mjs        # show what would change
//   node scripts/sync-issue-bodies.mjs                  # apply (uses gh auth)
//   node scripts/sync-issue-bodies.mjs 7 12             # only these issues

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildBody } from './issue-body.mjs';

const REPO = process.env.REPO ?? 'Frankie813/hackathon-movies';
const DRY = !!process.env.DRY_RUN;
const only = process.argv.slice(2).map(Number).filter(Boolean);

const data = JSON.parse(readFileSync(new URL('../.github/issues.json', import.meta.url), 'utf8'));
const token = process.env.GITHUB_TOKEN ?? execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

const api = async (method, path, body) => {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

// Issue numbers match plan ids on this repo; verify by title before writing.
const live = await api('GET', '/issues?state=all&per_page=100');
const byNumber = Object.fromEntries(live.map((i) => [i.number, i]));

let changed = 0, skipped = 0, missing = 0;
for (const issue of data.issues) {
  if (only.length && !only.includes(issue.id)) continue;
  const gh = byNumber[issue.id];
  if (!gh) { console.log(`  MISSING  #${issue.id} — no such issue on GitHub`); missing++; continue; }
  if (gh.title !== issue.title) {
    console.log(`  SKIP     #${issue.id} — title mismatch, refusing to overwrite ("${gh.title}")`);
    skipped++;
    continue;
  }
  const body = buildBody(issue, data);
  if (gh.body === body) { skipped++; continue; }
  if (DRY) {
    console.log(`  would update #${issue.id}  ${issue.title}  (${gh.body?.length ?? 0} → ${body.length} chars)`);
  } else {
    await api('PATCH', `/issues/${issue.id}`, { body });
    console.log(`  updated  #${issue.id}  ${issue.title}  (${body.length} chars)`);
    await new Promise((s) => setTimeout(s, 300));
  }
  changed++;
}
console.log(`\n${DRY ? 'Would update' : 'Updated'} ${changed} · unchanged ${skipped}${missing ? ` · missing ${missing}` : ''}`);
