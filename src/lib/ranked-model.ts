import { Schema, ThinkingLevel, getGenerativeModel } from 'firebase/ai';
import { ai, GEMINI_MODEL } from '../../lib/gemini';
import { isOverQuota, isRateLimited, openQuotaCooldown } from '../../lib/quota';
import { RANKED_SYSTEM_PROMPT } from './ranked';

/** 429 retries. Two is enough to ride out a burst without stalling the deck. */
const MAX_RETRIES = 2;

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
    // Re-checked every attempt, not just on the way in: #8's why-line prefetch
    // shares this quota and can hit the wall while this loop is sleeping.
    if (isOverQuota()) throw new Error('gemini quota cooldown');
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      if (!isRateLimited(error)) throw error;
      if (attempt >= MAX_RETRIES) {
        // Out of retries against a 429: we are genuinely over the 15 RPM free
        // tier. Record it so every other Gemini caller stops asking too, rather
        // than each new like spending three more doomed requests.
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
