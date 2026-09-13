import { AIError, Schema, ThinkingLevel, getGenerativeModel } from 'firebase/ai';
import { ai, GEMINI_MODEL } from '../../lib/gemini';
import { RANKED_SYSTEM_PROMPT } from './ranked';

/** Uses the existing Firebase AI Logic app, never a raw Gemini key. */
export async function generateRankedText(prompt: string): Promise<string> {
  const model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    systemInstruction: RANKED_SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      // A lookup from memory, not a reasoning task; keep it fast for the deck.
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseSchema: Schema.object({
        properties: {
          candidates: Schema.array({
            items: Schema.object({
              properties: { title: Schema.string(), year: Schema.integer() },
              optionalProperties: ['year'],
            }),
          }),
        },
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
