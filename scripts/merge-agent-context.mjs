#!/usr/bin/env node
// merge-agent-context.mjs — merges an `agent` block into each issue in
// .github/issues.json. Input: a JSON file mapping issue id → agent block.
// Usage: node scripts/merge-agent-context.mjs <patch.json>
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../.github/issues.json', import.meta.url);
const data = JSON.parse(readFileSync(file, 'utf8'));
const patch = JSON.parse(readFileSync(process.argv[2], 'utf8'));

let n = 0;
for (const [id, block] of Object.entries(patch)) {
  const issue = data.issues.find((i) => i.id === Number(id));
  if (!issue) throw new Error(`no issue ${id}`);
  issue.agent = block;
  n++;
}
writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const done = data.issues.filter((i) => i.agent).length;
console.log(`merged ${n} · ${done}/${data.issues.length} issues now carry agent context`);
