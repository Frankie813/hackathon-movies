#!/usr/bin/env node
// PostToolUse hook: refuses to let a real API key land in the repo.
//
// The plan rates "API key leaked in client bundle" as medium-likelihood /
// high-impact (PLAN.md §L). Gemini goes through Firebase AI Logic and the TMDB
// write key never ships. Nothing secret may sit in app source, and nothing
// secret may sit behind EXPO_PUBLIC_*, which ships to users' phones in
// plaintext. The ElevenLabs patterns below are kept deliberately: the voice
// track was dropped in v2.2, so a stray `sk_` key here means something is
// being reintroduced that should have been raised first.
//
// Exit 2 => stderr is fed back to the agent so it can undo the write.

import { readFileSync } from 'node:fs';

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let file;
  try {
    file = JSON.parse(raw)?.tool_input?.file_path;
  } catch {
    process.exit(0);
  }
  if (!file) process.exit(0);

  // Files whose whole job is to describe the shape of secrets.
  if (/(^|\/)(\.env\.example|check-secrets\.mjs)$/.test(file)) process.exit(0);

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    process.exit(0); // deleted, binary, or unreadable — nothing to scan
  }

  const isDoc = /\.(md|mdx|txt)$/.test(file);

  const checks = [
    { re: /AIza[0-9A-Za-z_-]{35}/, what: 'a Google/Gemini API key' },
    { re: /\bsk_[0-9a-f]{32,}/, what: 'an ElevenLabs API key' },
    { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/, what: 'a GitHub token' },
    { re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./, what: 'a JWT (TMDB v4 read token?)' },
    {
      re: /(ELEVENLABS_API_KEY|TMDB_API_KEY|TMDB_READ_ACCESS_TOKEN|GEMINI_API_KEY)\s*[:=]\s*['"][^'"\s]{12,}['"]/,
      what: 'a hardcoded server-side key',
    },
  ];

  if (!isDoc) {
    checks.push({
      re: /EXPO_PUBLIC_[A-Z0-9_]*(ELEVENLABS|TMDB|GEMINI|SECRET|PRIVATE)/,
      what: 'a server-side secret exposed through EXPO_PUBLIC_ (it ships to the phone in plaintext)',
    });
  }

  const hits = checks.filter((c) => c.re.test(text)).map((c) => c.what);
  if (!hits.length) process.exit(0);

  console.error(
    `BLOCKED — possible secret written to ${file}: ${hits.join('; ')}.\n` +
      `Remove it now, before this gets committed. This project has no server-side\n` +
      `component — Gemini goes through Firebase AI Logic and nothing else needs a\n` +
      `secret. See AGENTS.md §3. If this is a false positive, say so and move on.`
  );
  process.exit(2);
});
