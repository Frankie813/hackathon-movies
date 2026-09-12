import { AIError, Schema, getGenerativeModel } from 'firebase/ai';
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
      temperature: 0.2,
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
        optionalProperties: ['exclude_genres', 'keywords', 'exclude_keywords', 'min_rating', 'tone'],
      }),
    },
  }, { timeout: 10_000 });
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
