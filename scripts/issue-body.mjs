// issue-body.mjs — single renderer for GitHub issue bodies, used by both
// create-issues.mjs (first run) and sync-issue-bodies.mjs (updates), so the
// two can never drift.

const ownerName = { A: 'A (mobile)', B: 'B (backend)', C: 'C (AI + demo)', all: 'whole team' };

export function buildBody(issue, data, depMap = {}) {
  const deps = issue.deps.length
    ? issue.deps.map((d) => `#${depMap[d] ?? d}`).join(', ')
    : 'none';
  const phase = data.phases.find((p) => p.id === issue.phase).title;
  const a = issue.agent;

  const out = [
    issue.desc,
    '',
    '**Acceptance criteria**',
    ...issue.ac.map((x) => `- [ ] ${x}`),
    '',
    `**Estimate:** ${issue.est} · **Priority:** ${issue.priority} · **Owner:** ${ownerName[issue.owner]}`,
    `**Depends on:** ${deps}`,
    `**Phase:** ${phase}`,
  ];

  if (a) {
    out.push(
      '',
      '---',
      '',
      '## Implementation brief',
      '',
      '_Enough context to implement this issue without reading the other 41. Read `AGENTS.md` first — its hard rules outrank anything below._',
      '',
      '### What done looks like',
      a.goal,
      '',
      '### Files',
      ...a.files.map((f) => `- ${f}`),
      '',
      '### How to build it',
      ...a.steps.map((s, i) => `${i + 1}. ${s}`),
    );

    if (a.contract) {
      out.push('', '### Contract', '', 'What other issues import from this one — changing it after the fact breaks them silently.', '', a.contract);
    }
    if (a.gotchas?.length) {
      out.push('', '### Gotchas', ...a.gotchas.map((g) => `- ${g}`));
    }
    if (a.verify?.length) {
      out.push('', '### Verify before opening the PR', ...a.verify.map((v) => `- [ ] ${v}`));
    }
    if (a.refs?.length) {
      out.push('', '### References', ...a.refs.map((r) => `- ${r}`));
    }
  }

  out.push(
    '',
    '---',
    `_Generated from \`.github/issues.json\` (issue ${issue.id}). Edit that file and re-run \`scripts/sync-issue-bodies.mjs\` — do not hand-edit this body._`,
  );
  return out.join('\n');
}
