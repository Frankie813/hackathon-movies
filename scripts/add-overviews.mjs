#!/usr/bin/env node
/**
 * scripts/add-overviews.mjs — fills in `overview` (the TMDB synopsis) for
 * every movie in a seed JSON that doesn't have one yet. curate.mjs writes it
 * for new catalogs; this backfills an existing lib/seed.json without
 * re-running the whole (YouTube-quota-spending) curation.
 *
 * Usage:
 *   node scripts/add-overviews.mjs lib/seed.json
 *
 * Env (from .env): TMDB_READ_ACCESS_TOKEN (preferred) or TMDB_API_KEY.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMDB_BASE = 'https://api.themoviedb.org/3';

function die(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const bearer = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
const apiKey = process.env.TMDB_API_KEY?.trim();
if (!bearer && !apiKey) die('No TMDB credential in .env');

async function tmdb(path) {
  const url = new URL(TMDB_BASE + path);
  const init = {};
  if (bearer) init.headers = { Authorization: `Bearer ${bearer}`, accept: 'application/json' };
  else url.searchParams.set('api_key', apiKey);
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error(`TMDB ${path}: ${body?.status_message ?? res.status}`);
  return body;
}

const file = process.argv[2];
if (!file) die('Usage: node scripts/add-overviews.mjs lib/seed.json');
const path = resolve(ROOT, file);
const movies = JSON.parse(readFileSync(path, 'utf8'));

let filled = 0;
for (const movie of movies) {
  if (movie.overview) continue;
  try {
    const detail = await tmdb(`/movie/${movie.id}`);
    movie.overview = detail.overview ?? '';
    filled += 1;
  } catch (error) {
    console.log(`  ✗ ${movie.title}: ${error.message}`);
  }
}
writeFileSync(path, JSON.stringify(movies, null, 2) + '\n', 'utf8');
console.log(`Filled ${filled} overviews in ${file}`);
