import { Schema, ThinkingLevel, getGenerativeModel } from 'firebase/ai';
import { ai, GEMINI_MODEL } from '../../lib/gemini';
import { isOverQuota, isRateLimited, openQuotaCooldown } from '../../lib/quota';
import { MOOD_SYSTEM_PROMPT, TMDB_GENRES } from './mood';

/** 429 retries, matching the other Gemini callers. */
const MAX_RETRIES = 2;

const genreNames = Object.keys(TMDB_GENRES);

/** Uses the existing Firebase AI Logic app, never a raw Gemini key. */
export async function generateMoodText(text: string): Promise<string> {
  const model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    systemInstruction: MOOD_SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      // Filters, not prose: the same mood should give the same deck every time.
      temperature: 0,
      // Default thinking took 12-15s per mood in live runs; this is a lookup,
      // not a reasoning task.
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseSchema: Schema.object({
        properties: {
          // Enum-constrained, so Gemini can only name genres TMDB actually has.
          genres: Schema.array({ items: Schema.enumString({ enum: genreNames }) }),
          exclude_genres: Schema.array({ items: Schema.enumString({ enum: genreNames }) }),
          keywords: Schema.array({ items: Schema.string() }),
          exclude_keywords: Schema.array({ items: Schema.string() }),
          min_rating: Schema.number(),
          tone: Schema.string(),
        },
        // exclude_keywords and min_rating are required (empty / 0 when unused):
        // left optional, Gemini skipped them on "funny but not dumb" in live runs.
        optionalProperties: ['exclude_genres', 'keywords', 'tone'],
      }),
    },
  }, { timeout: 15_000 });
  for (let attempt = 0; ; attempt++) {
    // Re-checked every attempt, not just on the way in: #8's why-line prefetch
    // shares this quota and can hit the wall while this loop is sleeping.
    if (isOverQuota()) throw new Error('gemini quota cooldown');
    try {
      const result = await model.generateContent(`Mood: "${text}"`);
      return result.response.text();
    } catch (error) {
      if (!isRateLimited(error)) throw error;
      if (attempt >= MAX_RETRIES) {
        // Out of retries against a 429: record it so the deck's why lines and
        // #23's ranked fallback stop asking too.
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
