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

let closed = [], claimed = {}, review = {};
try {
  const raw = execFileSync('gh', ['issue', 'list', '--repo', REPO, '--state', 'all',
    '--limit', '200', '--json', 'number,state,assignees'], { encoding: 'utf8' });
  for (const i of JSON.parse(raw)) {
    if (i.state === 'CLOSED') closed.push(i.number);
    else if (i.assignees?.length) claimed[i.number] = i.assignees.map((a) => a.login);
  }
  // An open PR that references an issue means the work exists and is waiting to merge.
  const prs = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open',
    '--limit', '100', '--json', 'number,title,body,isDraft'], { encoding: 'utf8' });
  const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  for (const pr of JSON.parse(prs)) {
    const text = `${pr.title ?? ''} ${pr.body ?? ''}`;
    const refs = new Set();
    let m;
    while ((m = CLOSES.exec(text))) refs.add(Number(m[1]));
    if (!refs.size) {
      const t = (pr.title ?? '').match(/#(\d+)/);
      if (t) refs.add(Number(t[1]));
    }
    for (const n of refs) review[n] = { number: pr.number, draft: !!pr.isDraft };
  }
} catch (e) {
  console.warn(`! could not read GitHub state (${e.message.split('\n')[0]}) — rendering with none closed`);
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
  claimed,
  review,
};

const stamp = new Date().toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

const html = readFileSync(new URL('board.template.html', HERE), 'utf8')
  .replace('__DATA__', JSON.stringify(data))
  .replace('__SYNCED__', `Synced from GitHub · ${stamp} · ${data.done.length} of ${data.issues.length} closed`);

// Guard: an unterminated <script> parses into the DOM but never executes, which
// looks exactly like "the board renders nothing". Fail the build instead.
const opens = (html.match(/<script\b/g) ?? []).length;
const closes = (html.match(/<\/script>/g) ?? []).length;
if (opens !== closes || opens === 0) {
  console.error(`! refusing to write ${out}: ${opens} <script> vs ${closes} </script>`);
  process.exit(1);
}
if (!html.includes('__DATA__') === false) { console.error('! __DATA__ placeholder was not substituted'); process.exit(1); }

writeFileSync(out, html);
const inFlight = Object.keys(claimed).length + Object.keys(review).length;
console.log(`${out} — ${data.done.length} closed, ${inFlight} in flight, ${data.issues.length - data.done.length} open (${stamp})`);
