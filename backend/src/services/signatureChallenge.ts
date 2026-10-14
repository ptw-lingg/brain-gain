// One-time challenges for the Microsoft completion signature (SR-173 / SYS-SES-12).
//
// A Microsoft re-confirmation must be fresh. The ID token's own `iat` cannot prove that: Entra
// backdates it by up to five minutes as skew allowance, so a token minted a second ago already looks
// five minutes old. Instead the server hands the browser a nonce for THIS confirmation, the browser
// passes it into the Microsoft login request, Microsoft echoes it in the ID token's `nonce` claim,
// and the signature is accepted only for a nonce this server issued to this user, unexpired and not
// yet used. Clocks play no part in that.
//
// In memory on purpose: a challenge is short-lived and worthless after a restart (the learner simply
// confirms again); nothing about it belongs in the data directory.

import { randomBytes } from 'crypto';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const challenges = new Map<string, { userId: string; expires: number }>();

function sweep(now: number): void {
  for (const [nonce, c] of challenges) if (c.expires <= now) challenges.delete(nonce);
}

/** Issue a nonce for `userId`, valid for CHALLENGE_TTL_MS. */
export function issueSignatureChallenge(userId: string, now = Date.now()): { nonce: string; expiresAt: string } {
  sweep(now);
  const nonce = randomBytes(24).toString('base64url');
  const expires = now + CHALLENGE_TTL_MS;
  challenges.set(nonce, { userId, expires });
  return { nonce, expiresAt: new Date(expires).toISOString() };
}

/**
 * Consume `nonce` for `userId`: true exactly once, while unexpired and issued to that user. A wrong
 * user or a reuse is false — and a wrong-user attempt does NOT burn the nonce for its owner.
 */
export function consumeSignatureChallenge(nonce: string, userId: string, now = Date.now()): boolean {
  const c = challenges.get(nonce);
  if (!c || c.expires <= now || c.userId !== userId) return false;
  challenges.delete(nonce);
  return true;
}
