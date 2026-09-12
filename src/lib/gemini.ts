import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';

import { app } from '../../lib/firebase';

// Firebase AI Logic holds the Gemini credential on the server. Only the public
// Firebase web configuration belongs in the app; do not add a Gemini API key.
export const GEMINI_MODEL = 'gemini-3.5-flash';

export const ai = getAI(app, { backend: new GoogleAIBackend() });
export const gemini = getGenerativeModel(ai, { model: GEMINI_MODEL });
