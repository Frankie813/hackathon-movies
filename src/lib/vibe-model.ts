import { Schema, ThinkingLevel, getGenerativeModel } from 'firebase/ai';
import { ai, GEMINI_MODEL } from '../../lib/gemini';
import { isOverQuota, isRateLimited, openQuotaCooldown } from '../../lib/quota';
import { TAG_COUNT, VIBE_SYSTEM_PROMPT, type PosterImage } from './vibe';

/** 429 retries. An image request is the heaviest thing we send, so only one. */
const MAX_RETRIES = 1;

/** Uses the existing Firebase AI Logic app, never a raw Gemini key. */
export async function generateVibeText(image: PosterImage, title: string): Promise<string> {
  const model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    systemInstruction: VIBE_SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseSchema: Schema.object({
        properties: {
          tags: Schema.array({ items: Schema.string(), minItems: TAG_COUNT, maxItems: TAG_COUNT }),
        },
      }),
    },
  }, { timeout: 15_000 });
  for (let attempt = 0; ; attempt++) {
    if (isOverQuota()) throw new Error('gemini quota cooldown');
    try {
      const result = await model.generateContent([
        { inlineData: image },
        { text: `Poster for "${title}".` },
      ]);
      return result.response.text();
    } catch (error) {
      if (!isRateLimited(error)) throw error;
      if (attempt >= MAX_RETRIES) {
        openQuotaCooldown();
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.round(1000 * (0.5 + Math.random() / 2))));
    }
  }
}

/** Poster bytes → base64. Hermes has btoa; RN's fetch has arrayBuffer. */
export async function fetchPosterImage(url: string): Promise<PosterImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`poster ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { mimeType: response.headers.get('content-type') || 'image/jpeg', data: btoa(binary) };
}
