import { Schema, getGenerativeModel } from 'firebase/ai';
import { ai, GEMINI_MODEL } from '../../lib/gemini';
import { isRateLimited, openQuotaCooldown } from '../../lib/quota';

/** 429 retries, matching the other Gemini callers. */
const MAX_RETRIES = 2;

/** Uses the existing Firebase AI Logic app, never a raw Gemini key. */
export async function generateCompromiseText(prompt: string): Promise<string> {
  const model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: Schema.object({
        properties: { pick: Schema.string(), tmdb_id: Schema.integer(), why: Schema.string(), runner_up: Schema.string() },
        // tmdb_id is what validation matches against the catalog, so it is required.
        optionalProperties: ['runner_up'],
      }),
    },
  }, { timeout: 12_000 });
  // Deliberately asymmetric with the deck's callers (lib/gemini.ts, ranked-model):
  // they check isOverQuota() and bail, this one does not. The cooldown is a 60s
  // guess opened by whichever caller last hit a 429, and this request happens
  // once per session and carries the whole reveal (#10 step 5) — worth spending
  // an attempt on a wall that may already have lifted. It still *reports* what
  // it learns, so the deck stops competing with it.
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      if (!isRateLimited(error)) throw error;
      if (attempt >= MAX_RETRIES) {
        openQuotaCooldown();
        throw error;
      }
      // Full jitter, so a why-line retrying at the same moment doesn't collide.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.round(500 * 2 ** attempt * (0.5 + Math.random() / 2))),
      );
    }
  }
}
