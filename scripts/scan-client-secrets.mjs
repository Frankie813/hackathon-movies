// Usage: node --env-file=.env scripts/scan-client-secrets.mjs <export-directory>
// Scans without printing secret values.
import { readdir, readFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'dist/issue-3-android');
const names = [
  'TMDB_API_KEY',
  'TMDB_READ_ACCESS_TOKEN',
  'TMDB_BEARER',
  'GEMINI_API_KEY',
  'ELEVENLABS_API_KEY',
  'GITHUB_TOKEN',
];
const secrets = names
  .map((name) => ({ name, value: process.env[name]?.trim() }))
  .filter(({ value }) => value);

if (!secrets.some(({ name }) => name === 'TMDB_BEARER')) {
  throw new Error('TMDB_BEARER is required for the scan; its value will not be printed.');
}

let files = 0;
let bundles = 0;
let leaks = 0;

async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) {
      await scan(path);
      continue;
    }
    if (!item.isFile()) continue;
    files += 1;
    if (/\.(js|bundle|hbc)$/.test(item.name)) bundles += 1;
    const content = await readFile(path);
    if (basename(path).startsWith('.env')) {
      console.error(`Unexpected environment file: ${relative(root, path)}`);
      leaks += 1;
    }
    for (const { name, value } of secrets) {
      if (
        content.includes(Buffer.from(value)) ||
        content.includes(Buffer.from(value, 'utf16le')) ||
        content.includes(Buffer.from(Buffer.from(value).toString('base64')))
      ) {
        console.error(`${name} detected in ${relative(root, path)} (value suppressed).`);
        leaks += 1;
      }
    }
  }
}

await scan(root);
if (!files || !bundles) throw new Error('No completed client export found.');
console.log(`Scanned ${files} files and ${bundles} client bundles; secret matches: ${leaks}.`);
if (leaks) process.exitCode = 1;
