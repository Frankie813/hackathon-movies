#!/usr/bin/env node
// create-issues.mjs — creates labels, milestones (phases), and all issues from issues.json
// in Frankie813/hackathon-movies. Node 18+ (uses global fetch).
//
// Usage:
//   GITHUB_TOKEN=ghp_xxx node create-issues.mjs            # create everything
//   DRY_RUN=1 node create-issues.mjs                         # print what would be created
//   ASSIGNEE_A=octocat ASSIGNEE_B=... ASSIGNEE_C=... GITHUB_TOKEN=... node create-issues.mjs
//
// Token needs: Issues (read/write) and Metadata on the repo (fine-grained), or `repo` (classic).
// Safe to re-run: existing labels/milestones are reused; issues with an identical title are skipped.

import { readFileSync } from 'node:fs';

const REPO = process.env.REPO ?? 'Frankie813/hackathon-movies';
const TOKEN = process.env.GITHUB_TOKEN;
const DRY = !!process.env.DRY_RUN;
const ASSIGNEES = { A: process.env.ASSIGNEE_A, B: process.env.ASSIGNEE_B, C: process.env.ASSIGNEE_C };

if (!DRY && !TOKEN) {
  console.error('Set GITHUB_TOKEN (or DRY_RUN=1 to preview).');
  process.exit(1);
}

const data = JSON.parse(readFileSync(new URL('../.github/issues.json', import.meta.url), 'utf8'));
const API = `https://api.github.com/repos/${REPO}`;

async function gh(method, path, body) {
  if (DRY) return { dry: true, number: 0 };
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 422 && method === 'POST') return { exists: true }; // label already exists
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? {} : res.json();
}

const ownerLabel = { A: 'owner:A-mobile', B: 'owner:B-backend', C: 'owner:C-ai-demo', all: 'owner:all' };
const ownerName = { A: 'A (mobile)', B: 'B (backend)', C: 'C (AI + demo)', all: 'whole team' };

function body(issue, depMap) {
  const deps = issue.deps.length
    ? issue.deps.map((d) => `#${depMap[d] ?? `plan-${d}`}`).join(', ')
    : 'none';
  const phase = data.phases.find((p) => p.id === issue.phase).title;
  return [
    issue.desc,
    '',
    '**Acceptance criteria**',
    ...issue.ac.map((a) => `- [ ] ${a}`),
    '',
    `**Estimate:** ${issue.est} · **Priority:** ${issue.priority} · **Owner:** ${ownerName[issue.owner]}`,
    `**Depends on:** ${deps}`,
    `**Phase:** ${phase}`,
    '',
    `_Plan reference: PLAN.md issue ${issue.id}. Full context in PLAN.md._`,
  ].join('\n');
}

// 1. Labels
console.log(`\n== Labels (${data.labels.length}) ==`);
for (const l of data.labels) {
  const r = await gh('POST', '/labels', { name: l.name, color: l.color, description: l.description ?? '' });
  console.log(`  ${r.exists ? 'exists' : 'created'}  ${l.name}`);
}

// 2. Milestones (one per phase)
console.log(`\n== Milestones (${data.phases.length}) ==`);
const existingMs = DRY ? [] : await gh('GET', '/milestones?state=all&per_page=100');
const msNumber = {};
for (const p of data.phases) {
  const found = existingMs.find((m) => m.title === p.title);
  if (found) { msNumber[p.id] = found.number; console.log(`  exists   ${p.title}`); continue; }
  const r = await gh('POST', '/milestones', { title: p.title });
  msNumber[p.id] = r.number;
  console.log(`  created  ${p.title}`);
}

// 3. Issues — first pass creates them in plan order (repo is empty, so GitHub numbers
//    should equal plan ids; the second pass fixes dependency links if they don't).
console.log(`\n== Issues (${data.issues.length}) ==`);
const existingIssues = DRY ? [] : await gh('GET', '/issues?state=all&per_page=100');
const depMap = {};
const created = [];
for (const issue of data.issues) {
  const labels = [issue.priority, ownerLabel[issue.owner], `area:${issue.area}`, ...(issue.prize ? ['prize-track'] : [])];
  const dup = existingIssues.find((e) => e.title === issue.title);
  if (dup) { depMap[issue.id] = dup.number; console.log(`  exists   #${dup.number}  ${issue.title}`); continue; }
  const payload = {
    title: issue.title,
    body: body(issue, {}),
    labels,
    milestone: msNumber[issue.phase],
    ...(ASSIGNEES[issue.owner] ? { assignees: [ASSIGNEES[issue.owner]] } : {}),
  };
  const r = await gh('POST', '/issues', payload);
  depMap[issue.id] = DRY ? issue.id : r.number;
  created.push(issue);
  console.log(`  created  #${depMap[issue.id]}  [${issue.priority}] ${issue.title}  (${labels.join(', ')})`);
  if (!DRY) await new Promise((s) => setTimeout(s, 400)); // stay under secondary rate limits
}

// 4. Second pass: rewrite bodies with real dependency numbers.
console.log(`\n== Linking dependencies ==`);
let patched = 0;
for (const issue of created) {
  if (!issue.deps.length) continue;
  await gh('PATCH', `/issues/${depMap[issue.id]}`, { body: body(issue, depMap) });
  patched++;
  if (!DRY) await new Promise((s) => setTimeout(s, 300));
}
console.log(`  ${patched} issue bodies updated with dependency links`);

if (DRY) {
  console.log('\nDry run complete. Set GITHUB_TOKEN and remove DRY_RUN to create for real.');
} else {
  console.log(`\nDone. https://github.com/${REPO}/issues`);
  console.log(`Milestones: https://github.com/${REPO}/milestones`);
}
