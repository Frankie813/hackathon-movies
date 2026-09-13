import { AIError, Schema, ThinkingLevel, getGenerativeModel } from 'firebase/ai';
import { ai, GEMINI_MODEL } from '../../lib/gemini';
import { MOOD_SYSTEM_PROMPT, TMDB_GENRES } from './mood';

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
    try {
      const result = await model.generateContent(`Mood: "${text}"`);
      return result.response.text();
    } catch (error) {
      if (!(error instanceof AIError) || error.customErrorData?.status !== 429 || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}
