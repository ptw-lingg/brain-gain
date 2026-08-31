// The SCORM bridge protocol — HAND-MIRRORED TWIN of backend/src/scorm/protocol.ts (the canonical
// copy; the same convention as types.ts ↔ types/index.ts). backend/tests/scorm-model.test.mjs
// asserts the shared constants below match the backend's — change both files together.

import type { ScormVersion } from '@/types';

export const SCORM_BRIDGE_V = 1 as const;

export const CMI_MAX_KEYS = 512;
export const CMI_MAX_KEY_LEN = 256;
// suspend_data reality, NOT the 1.2 spec's 4096 — see the backend twin for the full rationale.
export const CMI_MAX_VALUE_LEN = 65_536;
export const CMI_MAX_PAYLOAD_BYTES = 262_144;
export const BRIDGE_MAX_MSGS_PER_SEC = 50;

// Must stay byte-identical to the content origin's CSP `sandbox` directive (asserted in e2e).
// allow-same-origin is REQUIRED and safe here: the frame is on a DIFFERENT origin than the app —
// see the backend twin for the full rationale. Do not "harden" this away.
export const SCORM_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads';

export interface ScormEnvelope {
  readonly bg: 'scorm';
  readonly v: typeof SCORM_BRIDGE_V;
  readonly nonce: string;
  readonly attemptId: string;
  readonly seq: number;
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

const CMI_KEY_RE = /^(cmi|adl)(\.[A-Za-z0-9_]+)+$/;
const FORBIDDEN_KEY = /__proto__|constructor|prototype/;

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

/** Shape check only — the transport checks (origin, source, nonce, attemptId, seq) come FIRST. */
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
