// The shared Gemini quota wall.
//
// Every Gemini caller — #8's why lines, #21's group compromise, #22's mood
// filters, #23's ranked fallback — draws on the same free-tier bucket (~1,500
// requests a day at 15 RPM, AGENTS.md §4). So a 429 that one of them walks into
// is a wall all of them are already behind, and each one spending its own
// retries to rediscover that just drains the quota faster.
//
// All four report what they learn via openQuotaCooldown(). Three of them also
// check isOverQuota() and give up early; #21's compromise deliberately does not,
// because it runs once per session and carries the reveal (#10 step 5), so it is
// worth one attempt against a 60s guess that may already have lifted. See
// src/lib/compromise-model.ts.
//
// This module deliberately imports nothing. The lazy callers (src/lib/ranked.ts)
// have to be able to ask "are we walled?" without dragging Firebase into the
// bundle, which is the whole reason their model call sits behind a dynamic
// import in the first place.

/** How long to stay off Gemini after walking into a 429. */
export const QUOTA_COOLDOWN_MS = 60_000;

let quotaCooldownUntil = 0;

/** A 429 from Firebase AI Logic arrives as an AIError carrying the HTTP status. */
export function isRateLimited(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { customErrorData?: { status?: number } }).customErrorData?.status;
  // When the SDK gave us a status, believe it. Sniffing the message as well
  // would let an unrelated failure that happens to contain "429" (a request id,
  // a byte count, a port) trip the 60s cooldown and silence the whole deck.
  if (typeof status === 'number') return status === 429;
  // Older SDK paths only put the status in the message.
  return error instanceof Error && /\b429\b|RESOURCE_EXHAUSTED/i.test(error.message);
}

/** True while we know the quota is exhausted. Answer from cache, don't queue. */
export function isOverQuota(): boolean {
  return Date.now() < quotaCooldownUntil;
}

/** Called once a caller has exhausted its retries against a 429. */
export function openQuotaCooldown(): void {
  quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
}

/** Test seam. */
export function __resetQuotaCooldown(): void {
  quotaCooldownUntil = 0;
}
