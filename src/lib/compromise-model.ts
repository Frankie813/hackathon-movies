import { AIError, Schema, getGenerativeModel } from 'firebase/ai';
import { ai, GEMINI_MODEL } from '../../lib/gemini';
/** Uses the existing Firebase AI Logic app, never a raw Gemini key. */
export async function generateCompromiseText(prompt: string): Promise<string> {
  const model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: Schema.object({
        properties: { pick: Schema.string(), tmdb_id: Schema.integer(), why: Schema.string(), runner_up: Schema.string() },
        optionalProperties: ['tmdb_id', 'runner_up'],
      }),
    },
  }, { timeout: 12_000 });
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      if (!(error instanceof AIError) || error.customErrorData?.status !== 429 || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}
