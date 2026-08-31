// The SCORM launch token: a short-lived signed grant that authorizes fetching ONE package's bytes
// from the content origin, minted for one user's one attempt. It sits in the URL PATH (never a
// query string — relative asset resolution keeps the path prefix and drops the query, so a query
// token would authorize the launch page and then 401 every asset).
//
// The critical split: this token authorizes BYTES, never STATE. Every cmi write goes to the main
// origin with the learner's normal Bearer JWT, and a completion additionally needs the SR-173
// signature — so a leaked/shared launch URL exposes course material the learner is entitled to
// and nothing else. That is what makes the multi-hour TTL acceptable; revocation (the content
// server checks the attempt is still open on every request) kills the URL the moment the attempt
// terminates or is signed.

import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../middleware/auth';

// DERIVED from JWT_SECRET, never JWT_SECRET itself: a content token must be unusable as an app
// bearer token and vice versa, even though both are HS256 JWTs — the derivation plus the `typ`
// claim make the two token families mutually unverifiable.
const LAUNCH_SECRET = createHmac('sha256', JWT_SECRET).update('braingain-scorm-launch-v1').digest();

export const LAUNCH_TTL_SEC = 8 * 3600; // asset fetches continue for the whole course session

export interface LaunchClaims {
  typ: 'scorm-launch';
  aid: string; // attemptId
  pid: string; // packageId
  sub: string; // userId
  jti: string; // doubles as the per-launch bridge nonce
}

export function mintLaunchToken(claims: Omit<LaunchClaims, 'typ'>): string {
  return jwt.sign({ ...claims, typ: 'scorm-launch' }, LAUNCH_SECRET, {
    algorithm: 'HS256',
    expiresIn: LAUNCH_TTL_SEC,
  });
}

/** Verified claims, or null on ANY failure (bad signature, expired, wrong type, app JWT). */
export function verifyLaunchToken(token: string): LaunchClaims | null {
  try {
    const decoded = jwt.verify(token, LAUNCH_SECRET, { algorithms: ['HS256'] }) as Partial<LaunchClaims>;
    if (decoded.typ !== 'scorm-launch') return null;
    if (
      typeof decoded.aid !== 'string' ||
      typeof decoded.pid !== 'string' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.jti !== 'string'
    ) {
      return null;
    }
    return decoded as LaunchClaims;
  } catch {
    return null;
  }
}
