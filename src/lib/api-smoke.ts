// Manual setup checks only. Nothing in this module runs at app startup.

interface TmdbDiscoverResponse {
  results?: unknown[];
}

/**
 * Verifies TMDB directly from the app without compiling the bearer into the
 * bundle. The development screen accepts it at runtime for this one-off check.
 */
export async function checkTmdb(bearer: string): Promise<number> {
  const token = bearer.trim();
  if (!token) throw new Error('Enter the TMDB API Read Access Token.');

  const response = await fetch(
    'https://api.themoviedb.org/3/discover/movie?include_adult=false&language=en-US&page=1',
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`TMDB check failed (${response.status}).`);

  const body = (await response.json()) as TmdbDiscoverResponse;
  if (!Array.isArray(body.results) || body.results.length === 0) {
    throw new Error('TMDB returned no discover results.');
  }
  return body.results.length;
}

export async function checkGemini(): Promise<void> {
  const { gemini } = await import('./gemini');
  const result = await gemini.generateContent({
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Return a JSON object with the single field ok set to true.' }],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  });
  const body: unknown = JSON.parse(result.response.text());
  if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) {
    throw new Error('Gemini did not return the expected JSON.');
  }
}

// SDK errors can contain request URLs and credentials. Only expose a code.
export function apiCheckError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error &&
      typeof error.code === 'string' && /^[a-z0-9/_-]{1,80}$/i.test(error.code)) {
    return `Check failed (${error.code}).`;
  }
  return 'Check failed. Verify the credential, network, and Firebase AI Logic setup.';
}
