import { Router } from 'express';
import type { Settings } from '../types';
import { readSettings, writeSettings } from '../services/fileStore';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  TlsError,
  applyCredentials,
  certMeta,
  currentCertMeta,
  generateSelfSigned,
  storeUploadedCredentials,
} from '../services/tls';

const router = Router();

/** Accept either an array or a comma-separated string; trim, lower-case, drop empties. */
function sanitizeDomains(input: unknown): string[] {
  const parts = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  return parts.map((d) => String(d).trim().toLowerCase()).filter((d) => d.length > 0);
}

// GET /api/settings  — any authenticated user (client needs the threshold; SSO fields are not secret)
router.get('/', authenticate, async (_req, res) => {
  res.json(await readSettings());
});

// PUT /api/settings  — admin only. Partial merge so saving SSO config and the pass threshold are
// independent: only the fields present in the body are updated.
router.put('/', authenticate, requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const next: Settings = { ...(await readSettings()) };

  if (body.passThreshold !== undefined) {
    const raw = Number(body.passThreshold);
    if (!Number.isFinite(raw)) {
      return res.status(400).json({ error: 'passThreshold (0–1) is required' });
    }
    next.passThreshold = Math.min(1, Math.max(0.5, raw));
  }

  if (body.entra !== undefined) {
    const e = body.entra ?? {};
    next.entra = {
      enabled: Boolean(e.enabled),
      tenantId: typeof e.tenantId === 'string' ? e.tenantId.trim() : '',
      clientId: typeof e.clientId === 'string' ? e.clientId.trim() : '',
      allowedDomains: sanitizeDomains(e.allowedDomains),
    };
  }

  await writeSettings(next);
  return res.json(next);
});

// GET /api/settings/certificate — admin only; current TLS cert metadata (never the private key)
router.get('/certificate', authenticate, requireAdmin, async (_req, res) => {
  res.json(await currentCertMeta());
});

// POST /api/settings/certificate — admin only; upload/replace the TLS certificate (PEM strings).
// Validates the cert+key, hot-swaps the running HTTPS server, and stores only non-secret metadata.
router.post('/certificate', authenticate, requireAdmin, async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.cert !== 'string' || !b.cert.trim() || typeof b.key !== 'string' || !b.key.trim()) {
    return res.status(400).json({ error: 'cert and key (PEM) are required' });
  }
  const creds = {
    cert: b.cert,
    key: b.key,
    ca: typeof b.chain === 'string' && b.chain.trim() ? b.chain : undefined,
  };
  try {
    const { meta } = await storeUploadedCredentials(creds);
    applyCredentials(creds);
    const settings = await readSettings();
    settings.tls = meta;
    await writeSettings(settings);
    return res.json(meta);
  } catch (err) {
    if (err instanceof TlsError) return res.status(400).json({ error: err.message });
    console.error('Certificate upload error:', err);
    return res.status(500).json({ error: 'Could not apply certificate' });
  }
});

// POST /api/settings/certificate/self-signed — admin only; revert to a fresh self-signed certificate
router.post('/certificate/self-signed', authenticate, requireAdmin, async (_req, res) => {
  try {
    const creds = await generateSelfSigned();
    applyCredentials(creds);
    const meta = await certMeta(creds.cert, 'self-signed');
    const settings = await readSettings();
    settings.tls = meta;
    await writeSettings(settings);
    return res.json(meta);
  } catch (err) {
    console.error('Self-signed regeneration error:', err);
    return res.status(500).json({ error: 'Could not regenerate certificate' });
  }
});

export default router;
