#!/usr/bin/env node
// build-board.mjs — renders the MovieMatch Build Order board from issues.json plus
// live issue state on GitHub. A closed issue is a done issue; everything else
// (ready vs waiting, hours left, what each issue unlocks) is derived from the
// dependency graph at render time.
//
// Usage:
//   node scripts/build-board.mjs [outfile]      # default: docs/index.html (GitHub Pages)
//
// Needs `gh` authenticated for the repo. Falls back to "nothing closed yet" if
// the gh call fails, so the board still renders offline.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = process.env.REPO ?? 'Frankie813/hackathon-movies';
const HERE = new URL('.', import.meta.url);
const out = process.argv[2] ?? new URL('../docs/index.html', HERE).pathname;

const plan = JSON.parse(readFileSync(new URL('../.github/issues.json', HERE), 'utf8'));

let closed = [];
try {
  const raw = execFileSync('gh', ['issue', 'list', '--repo', REPO, '--state', 'closed',
    '--limit', '200', '--json', 'number'], { encoding: 'utf8' });
  closed = JSON.parse(raw).map((i) => i.number);
} catch (e) {
  console.warn(`! could not read GitHub issue state (${e.message.split('\n')[0]}) — rendering with none closed`);
}

const blocks = Object.fromEntries(plan.issues.map((i) => [i.id, []]));
for (const i of plan.issues) for (const d of i.deps) blocks[d].push(i.id);

const data = {
  phases: plan.phases.map((p) => ({ id: p.id, title: p.title })),
  issues: plan.issues.map((i) => ({
    id: i.id, t: i.title, o: i.owner, p: i.priority, e: i.est, h: parseFloat(i.est),
    ph: i.phase, a: i.area, z: !!i.prize, d: i.deps, b: blocks[i.id],
  })),
  done: closed.filter((n) => plan.issues.some((i) => i.id === n)),
};

const stamp = new Date().toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

const html = readFileSync(new URL('board.template.html', HERE), 'utf8')
  .replace('__DATA__', JSON.stringify(data))
  .replace('__SYNCED__', `Synced from GitHub · ${stamp} · ${data.done.length} of ${data.issues.length} closed`);

writeFileSync(out, html);
console.log(`${out} — ${data.done.length} closed, ${data.issues.length - data.done.length} open (${stamp})`);
