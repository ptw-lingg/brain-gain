// Completion signature (SR-173): when a learner completes a training — with or without test
// questions — they must re-confirm their identity at that moment, and the confirmation method is
// recorded with the completion in the audit trail. Password accounts re-enter their password;
// SSO-linked accounts present a FRESH Microsoft ID token. The check always runs against the
// ACTING user's account, so an impersonating admin cannot complete a training for someone else.

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Settings, User } from '../types';
import { EntraAuthError, isEntraConfigured, verifyEntraIdToken } from './entra';

// A Microsoft re-authentication must be FRESH — MSAL is asked for an interactive login
// (prompt: 'login'), and a token older than this is refused so a silently reused cached token
// can never count as a re-confirmation.
const MAX_TOKEN_AGE_SEC = 300;

export type SignatureMethod = 'password' | 'microsoft';

export type SignatureCheck =
  | { ok: true; method: SignatureMethod }
  // `reason` goes to the audit trail only — clients get a generic message (no oracle).
  | { ok: false; reason: string };

/**
 * Verify the re-authentication payload (`{ password }` or `{ entraIdToken }`) against the acting
 * user's account. Infra errors (e.g. an unreachable JWKS endpoint) are thrown, not mapped to a
 * failed signature — the caller surfaces them as a 500.
 */
export async function verifyCompletionSignature(
  user: User,
  reauth: unknown,
  settings: Settings,
): Promise<SignatureCheck> {
  const r = (typeof reauth === 'object' && reauth !== null ? reauth : {}) as Record<string, unknown>;

  if (typeof r.password === 'string' && r.password) {
    if (!user.passwordHash) return { ok: false, reason: 'account has no local password' };
    const ok = await bcrypt.compare(r.password, user.passwordHash);
    return ok ? { ok: true, method: 'password' } : { ok: false, reason: 'wrong password' };
  }

  if (typeof r.entraIdToken === 'string' && r.entraIdToken) {
    if (!isEntraConfigured(settings)) return { ok: false, reason: 'SSO is not configured' };
    let claims;
    try {
      claims = await verifyEntraIdToken(r.entraIdToken, settings.entra);
    } catch (err) {
      if (err instanceof EntraAuthError) return { ok: false, reason: 'Microsoft token rejected' };
      throw err;
    }
    // Identity binding: the token must belong to the Microsoft account LINKED to the acting user —
    // any other (even valid) Microsoft sign-in is someone else's identity.
    if (!user.entraOid || claims.oid !== user.entraOid) {
      return { ok: false, reason: 'Microsoft account does not match this user' };
    }
    const payload = jwt.decode(r.entraIdToken);
    const iat =
      payload && typeof payload === 'object' && typeof payload.iat === 'number' ? payload.iat : 0;
    if (!iat || Date.now() / 1000 - iat > MAX_TOKEN_AGE_SEC) {
      return { ok: false, reason: 'stale Microsoft sign-in' };
    }
    return { ok: true, method: 'microsoft' };
  }

  return { ok: false, reason: 'missing credentials' };
}
