// The SCORM bridge protocol — the messages exchanged between the app page (ScormPlayer) and the
// wrapper page on the content origin, plus the hard caps both sides enforce.
//
// CANONICAL COPY. frontend/src/scorm/protocol.ts is a hand-mirrored twin (the same convention as
// backend/src/types.ts ↔ frontend/src/types/index.ts); backend/tests/scorm-model.test.mjs holds a
// drift check that asserts the shared constants match. Change both files together.
//
// Trust model: every inbound message is validated by shape AND by transport identity
// (event.origin + event.source + per-launch nonce + monotonic seq) before it is touched. A message
// is data, never a path into a JS object — keys are matched against the cmi grammar below and the
// dunder names are rejected so a crafted key can never pollute a prototype.

import type { ScormVersion } from '../types';

export const SCORM_BRIDGE_V = 1 as const;

// Hard caps, enforced on BOTH sides; the server re-enforces them on every commit (the client copy
// exists only so the shim can return the right SCORM error code synchronously).
export const CMI_MAX_KEYS = 512;
export const CMI_MAX_KEY_LEN = 256;
// suspend_data reality, NOT the 1.2 spec's 4096: Storyline routinely writes far more in 1.2 mode
// and expects a byte-exact read-back — enforcing the spec here is the most reliable way to break
// resume against real packages. Both dialects get the 2004 limit.
export const CMI_MAX_VALUE_LEN = 65_536;
export const CMI_MAX_PAYLOAD_BYTES = 262_144; // 256 KB per commit
export const BRIDGE_MAX_MSGS_PER_SEC = 50;

// The iframe sandbox flags. ONE definition: the ScormPlayer iframe attribute and the content
// origin's CSP `sandbox` directive must stay byte-identical, or a package works in the app but
// breaks when its launch URL is opened top-level (the CSP applies there too). An e2e spec asserts
// the served header and the rendered attribute match.
// allow-same-origin is REQUIRED and safe here: the frame is on a DIFFERENT origin than the app, so
// the notorious allow-scripts+allow-same-origin combination grants the content nothing beyond what
// its own (empty, cookie-less) origin already gives it — while the SCORM API-finder walk, the
// authoring tools' localStorage use, and a verifiable event.origin all depend on it. Do not
// "harden" this away; it breaks every real package.
export const SCORM_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads';

/** Fields present on every bridge message. */
export interface ScormEnvelope {
  readonly bg: 'scorm';
  readonly v: typeof SCORM_BRIDGE_V;
  readonly nonce: string; // per-launch secret (the launch token's jti)
  readonly attemptId: string;
  readonly seq: number; // strictly increasing per direction; stale/replayed messages are dropped
}

/** content → app */
export type ScormInbound =
  | (ScormEnvelope & { type: 'ready'; api: 'API' | 'API_1484_11' })
  | (ScormEnvelope & { type: 'initialize' })
  | (ScormEnvelope & { type: 'setValues'; values: Record<string, string> })
  | (ScormEnvelope & { type: 'commit'; values: Record<string, string> })
  | (ScormEnvelope & { type: 'terminate'; values: Record<string, string>; exit: string })
  | (ScormEnvelope & { type: 'resize'; height: number })
  | (ScormEnvelope & { type: 'diag'; code: string; message: string });

/** app → content */
export type ScormOutbound =
  | (ScormEnvelope & {
      type: 'init';
      cmi: Record<string, string>;
      version: ScormVersion;
      readOnly: readonly string[];
    })
  | (ScormEnvelope & { type: 'ack'; forSeq: number })
  | (ScormEnvelope & { type: 'nak'; forSeq: number; reason: 'persist-failed' | 'expired' | 'invalid' | 'too-large' })
  | (ScormEnvelope & { type: 'close'; reason: 'expired' | 'signed' | 'exit' });

// cmi.core.lesson_status, cmi.interactions.3.id, adl.nav.request, cmi.objectives.0.score.raw
const CMI_KEY_RE = /^(cmi|adl)(\.[A-Za-z0-9_]+)+$/;
const FORBIDDEN_KEY = /__proto__|constructor|prototype/;

/** True when `u` is a safe cmi patch: string→string, sane keys, all caps respected. */
export function isCmiPatch(u: unknown): u is Record<string, string> {
  if (u === null || typeof u !== 'object' || Array.isArray(u)) return false;
  const entries = Object.entries(u as Record<string, unknown>);
  if (entries.length > CMI_MAX_KEYS) return false;
  let bytes = 0;
  for (const [k, v] of entries) {
    if (typeof v !== 'string') return false;
    if (k.length === 0 || k.length > CMI_MAX_KEY_LEN) return false;
    if (!CMI_KEY_RE.test(k) || FORBIDDEN_KEY.test(k)) return false;
    if (v.length > CMI_MAX_VALUE_LEN) return false;
    bytes += k.length + v.length + 4;
    if (bytes > CMI_MAX_PAYLOAD_BYTES) return false;
  }
  return true;
}

/** True when `u` is a well-formed inbound bridge message (shape only — the transport checks —
 *  origin, source, nonce, attemptId, seq — are the caller's job and come first). */
export function isScormInbound(u: unknown): u is ScormInbound {
  if (u === null || typeof u !== 'object') return false;
  const m = u as Record<string, unknown>;
  if (m.bg !== 'scorm' || m.v !== SCORM_BRIDGE_V) return false;
  if (typeof m.nonce !== 'string' || typeof m.attemptId !== 'string') return false;
  if (typeof m.seq !== 'number' || !Number.isSafeInteger(m.seq) || m.seq < 0) return false;
  switch (m.type) {
    case 'ready':
      return m.api === 'API' || m.api === 'API_1484_11';
    case 'initialize':
      return true;
    case 'setValues':
    case 'commit':
      return isCmiPatch(m.values);
    case 'terminate':
      return isCmiPatch(m.values) && typeof m.exit === 'string' && m.exit.length <= 32;
    case 'resize':
      return (
        typeof m.height === 'number' && Number.isFinite(m.height) && m.height >= 0 && m.height <= 20_000
      );
    case 'diag':
      return (
        typeof m.code === 'string' && m.code.length <= 16 &&
        typeof m.message === 'string' && m.message.length <= 512
      );
    default:
      return false;
  }
}
