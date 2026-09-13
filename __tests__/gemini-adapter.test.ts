import { AIError, getGenerativeModel } from 'firebase/ai';
import { generateCompromiseText } from '../src/lib/compromise-model';
// The real quota module on purpose: it imports nothing, and what is under test
// here is precisely whether this caller talks to the shared wall (#23).
import { __resetQuotaCooldown, isOverQuota, openQuotaCooldown } from '../lib/quota';

const mockGenerate = jest.fn();
jest.mock('../lib/gemini', () => ({ ai: {}, GEMINI_MODEL: 'gemini-3.5-flash' }));
jest.mock('firebase/ai', () => ({
  AIError: class extends Error {
    code: string;
    customErrorData?: { status?: number };
    constructor(code: string, message: string, data?: { status?: number }) {
      super(message);
      this.code = code;
      this.customErrorData = data;
    }
  },
  Schema: {
    object: (value: unknown) => value,
    string: () => ({ type: 'string' }), integer: () => ({ type: 'integer' }),
  },
  getGenerativeModel: jest.fn(() => ({ generateContent: mockGenerate })),
}));

describe('Firebase compromise adapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGenerate.mockReset();
    __resetQuotaCooldown();
  });
  afterEach(() => { jest.useRealTimers(); __resetQuotaCooldown(); });

  it('pins the existing model and sends the response schema with a bounded timeout', async () => {
    mockGenerate.mockResolvedValue({ response: { text: () => '{"pick":"demo"}' } });
    expect(await generateCompromiseText('prompt')).toBe('{"pick":"demo"}');
    expect(getGenerativeModel).toHaveBeenCalledWith({}, expect.objectContaining({
      model: 'gemini-3.5-flash',
      generationConfig: expect.objectContaining({ responseMimeType: 'application/json',
        responseSchema: expect.objectContaining({ optionalProperties: ['runner_up'] }) }),
    }), { timeout: 12_000 });
    expect(mockGenerate).toHaveBeenCalledWith('prompt');
  });

  it('retries 429 with bounded exponential backoff', async () => {
    mockGenerate.mockRejectedValueOnce(new AIError('fetch-error', 'limited', { status: 429 }))
      .mockRejectedValueOnce(new AIError('fetch-error', 'limited', { status: 429 }))
      .mockResolvedValue({ response: { text: () => '{}' } });
    const request = generateCompromiseText('prompt');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(500);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await request).toBe('{}');
    expect(mockGenerate).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-rate-limit errors', async () => {
    mockGenerate.mockRejectedValue(new AIError('fetch-error', 'denied', { status: 403 }));
    await expect(generateCompromiseText('prompt')).rejects.toThrow('denied');
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  // #21 was the only Gemini caller outside the shared wall. #8 spends a request
  // per card against 15 RPM, so the compromise now regularly runs after the
  // deck has already found the ceiling — both directions of that have to work.
  it('opens the shared cooldown once its retries are spent on a 429', async () => {
    mockGenerate.mockRejectedValue(new AIError('fetch-error', 'limited', { status: 429 }));
    const request = generateCompromiseText('prompt');
    const settled = expect(request).rejects.toThrow('limited');

    expect(isOverQuota()).toBe(false);
    await jest.advanceTimersByTimeAsync(2_000);
    await settled;

    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(isOverQuota()).toBe(true);
  });

  // Deliberately asymmetric with the deck's callers: this one runs once per
  // session and carries the reveal, so it still tries against a cooldown that
  // is only a 60s guess. Pinned because it reads like an oversight otherwise.
  it('still attempts while the deck is walled, unlike the deck itself', async () => {
    openQuotaCooldown();
    expect(isOverQuota()).toBe(true);

    mockGenerate.mockResolvedValue({ response: { text: () => '{"pick":"demo"}' } });
    expect(await generateCompromiseText('prompt')).toBe('{"pick":"demo"}');
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });
});
