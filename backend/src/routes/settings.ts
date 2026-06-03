import { Router } from 'express';
import type { Settings } from '../types';
import { readSettings, writeSettings } from '../services/fileStore';
import { authenticate, requireAdmin } from '../middleware/auth';

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

export default router;
