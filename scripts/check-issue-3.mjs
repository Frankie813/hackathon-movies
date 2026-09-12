// Usage: node --env-file=.env scripts/check-issue-3.mjs [--gemini]
// The optional Gemini check spends one request. Credentials are never printed.
import { deleteApp, initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';

let failed = false;

try {
  const response = await fetch(
    'https://api.themoviedb.org/3/discover/movie?include_adult=false&language=en-US&page=1',
    {
      headers: { Authorization: `Bearer ${process.env.TMDB_BEARER}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await response.json();
  if (!response.ok || !Array.isArray(body.results) || body.results.length === 0) {
    throw new Error('TMDB verification failed.');
  }
  console.log(`TMDB: passed (${body.results.length} discover results)`);
} catch {
  console.error('TMDB: failed (credential value suppressed)');
  failed = true;
}

if (process.argv.includes('--gemini')) {
  const client = initializeApp({
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  }, 'issue-3-check');
  try {
    const ai = getAI(client, { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, { model: 'gemini-3.5-flash' });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Return JSON with one field: ok set to true.' }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    if (JSON.parse(result.response.text()).ok !== true) throw new Error('Unexpected response.');
    console.log('Gemini via Firebase AI Logic: passed');
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[a-z0-9/_-]+$/i.test(error.code)
      ? ` (${error.code})`
      : '';
    const status = Number.isInteger(error?.customErrorData?.status)
      ? `, HTTP ${error.customErrorData.status}`
      : '';
    const message = String(error?.message ?? '').toLowerCase();
    const cause = message.includes('to access this model') && message.includes('app check')
      ? ', cause: this model requires App Check'
      : message.includes('deactivated in this project') && message.includes('app check')
        ? ', cause: Firebase AI Logic requires App Check reactivation'
        : message.includes('app check')
          ? ', cause: App Check rejected the request'
      : message.includes('service_disabled') || message.includes('api has not been')
        ? ', cause: Firebase AI Logic API is disabled'
        : message.includes('permission_denied') || message.includes('permission denied')
          ? ', cause: request was denied'
          : '';
    console.error(`Gemini via Firebase AI Logic: failed${code}${status}${cause}`);
    failed = true;
  } finally {
    await deleteApp(client);
  }
}

if (failed) process.exitCode = 1;
