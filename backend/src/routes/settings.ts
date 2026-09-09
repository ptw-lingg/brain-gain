import { asyncRouter } from '../middleware/asyncRouter';
import type { OrgUnit, Settings, Training } from '../types';
import { readSettings, readStore, transaction, updateSettings, writeSettings, writeStore } from '../services/fileStore';
import { authenticate, requireAdmin, type AuthRequest } from '../middleware/auth';
import { auditEvent, diffSettings } from '../services/audit';
import {
  TlsError,
  applyCredentials,
  certMeta,
  currentCertMeta,
  generateSelfSigned,
  storeUploadedCredentials,
} from '../services/tls';

const router = asyncRouter();

/** Accept either an array or a comma-separated string; trim, lower-case, drop empties. */
function sanitizeDomains(input: unknown): string[] {
  const parts = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  return parts.map((d) => String(d).trim().toLowerCase()).filter((d) => d.length > 0);
}

// Strip the SMTP password before returning settings to any client — it is the one secret in here.
// `smtp.passwordSet` lets the UI show whether a password is stored without ever exposing it.
function publicSettings(s: Settings): Settings & { smtp: Settings['smtp'] & { passwordSet: boolean } } {
  return { ...s, smtp: { ...s.smtp, password: '', passwordSet: Boolean(s.smtp.password) } };
}

// GET /api/settings  — any authenticated user (client needs the threshold; SSO fields are not secret;
// the SMTP password is redacted).
router.get('/', authenticate, async (_req, res) => {
  res.json(publicSettings(await readSettings()));
});

// PUT /api/settings  — admin only. Partial merge so saving SSO config and the pass threshold are
// independent: only the fields present in the body are updated.
router.put('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const body = req.body ?? {};
  // Body-only validation first, so the store lock below is held only for the read-modify-write.
  if (body.passThreshold !== undefined && !Number.isFinite(Number(body.passThreshold))) {
    return res.status(400).json({ error: 'passThreshold (0–1) is required' });
  }
  if (body.companyName !== undefined && (typeof body.companyName !== 'string' || !body.companyName.trim())) {
    return res.status(400).json({ error: 'companyName must be a non-empty string' });
  }

  // Settings and the root org unit are rewritten together in one transaction.
  const { before, next } = await transaction(async () => {
  const before = await readSettings();
  const next: Settings = { ...before };

  if (body.passThreshold !== undefined) {
    next.passThreshold = Math.min(1, Math.max(0.5, Number(body.passThreshold)));
  }

  if (body.revealWrongQuestions !== undefined) {
    next.revealWrongQuestions = Boolean(body.revealWrongQuestions);
  }


  // The company name is the root org unit's name — keep the two in sync.
  if (body.companyName !== undefined) {
    next.companyName = body.companyName.trim();
    const orgUnits = await readStore<OrgUnit>('orgUnits');
    const root = orgUnits.find((o) => o.parentId === null) ?? orgUnits[0];
    if (root && root.name !== next.companyName) {
      root.name = next.companyName;
      await writeStore('orgUnits', orgUnits);
    }
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

  if (body.smtp !== undefined) {
    const m = body.smtp ?? {};
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const port = Number(m.port);
    next.smtp = {
      enabled: Boolean(m.enabled),
      host: str(m.host),
      port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : 587,
      secure: Boolean(m.secure),
      username: str(m.username),
      // A blank/omitted password keeps the stored one (so editing other fields never wipes the secret).
      password: typeof m.password === 'string' && m.password.length ? m.password : next.smtp.password,
      fromName: str(m.fromName),
      fromAddress: str(m.fromAddress),
    };
  }

  if (body.autoBackup !== undefined) {
    const a = body.autoBackup ?? {};
    // Out-of-range numbers are clamped rather than rejected; junk falls back to the default.
    const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
    };
    next.autoBackup = {
      enabled: Boolean(a.enabled),
      intervalDays: clampInt(a.intervalDays, 1, 365, 7),
      keep: clampInt(a.keep, 1, 100, 5),
    };
  }

  await writeSettings(next);
  return { before, next };
  });
  await auditEvent(req.user ?? null, 'update', { type: 'settings', name: 'Settings' }, { changes: diffSettings(before, next) });
  return res.json(publicSettings(next));
});

// GET /api/settings/certificate — admin only; current TLS cert metadata (never the private key)
router.get('/certificate', authenticate, requireAdmin, async (_req, res) => {
  res.json(await currentCertMeta());
});

// POST /api/settings/certificate — admin only; upload/replace the TLS certificate (PEM strings).
// Validates the cert+key, hot-swaps the running HTTPS server, and stores only non-secret metadata.
router.post('/certificate', authenticate, requireAdmin, async (req: AuthRequest, res) => {
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
    await updateSettings((settings) => ({ ...settings, tls: meta }));
    await auditEvent(
      req.user ?? null,
      'update',
      { type: 'settings', name: 'TLS certificate' },
      { details: `uploaded certificate ${meta.subject} (${meta.fingerprint})` },
    );
    return res.json(meta);
  } catch (err) {
    if (err instanceof TlsError) return res.status(400).json({ error: err.message });
    console.error('Certificate upload error:', err);
    return res.status(500).json({ error: 'Could not apply certificate' });
  }
});

// POST /api/settings/certificate/self-signed — admin only; revert to a fresh self-signed certificate
router.post('/certificate/self-signed', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const creds = await generateSelfSigned();
    applyCredentials(creds);
    const meta = await certMeta(creds.cert, 'self-signed');
    await updateSettings((settings) => ({ ...settings, tls: meta }));
    await auditEvent(
      req.user ?? null,
      'update',
      { type: 'settings', name: 'TLS certificate' },
      { details: `regenerated self-signed certificate ${meta.subject} (${meta.fingerprint})` },
    );
    return res.json(meta);
  } catch (err) {
    console.error('Self-signed regeneration error:', err);
    return res.status(500).json({ error: 'Could not regenerate certificate' });
  }
});

export default router;
