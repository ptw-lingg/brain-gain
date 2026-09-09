// Read access to the audit trail — administrator-only, like backups: the log names every user and
// every change made in the system. Both endpoints share one filter (action, entityType, free text,
// date range); the list adds offset/limit paging because the log grows forever, the CSV export
// deliberately does not (an export is the whole filtered history).

import { asyncRouter } from '../middleware/asyncRouter';
import type { AuditAction, AuditEntityType, AuditEntry } from '../types';
import { authenticate, requireAdmin, type AuthRequest } from '../middleware/auth';
import { readAuditEntries } from '../services/audit';
import { sendAttachment } from './http';

const router = asyncRouter();

router.use(authenticate, requireAdmin);

interface AuditFilter {
  action?: string;
  entityType?: string;
  q?: string;
  from?: string; // inclusive day bound, ISO date
  to?: string; // inclusive day bound, ISO date
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function parseFilter(query: Record<string, unknown>): AuditFilter {
  return {
    action: str(query.action),
    entityType: str(query.entityType),
    q: str(query.q),
    from: str(query.from),
    to: str(query.to),
  };
}

/** Filtered entries, NEWEST first. */
async function filteredEntries(f: AuditFilter): Promise<AuditEntry[]> {
  const entries = (await readAuditEntries()).reverse();
  const q = f.q?.toLowerCase();
  // Day bounds compare lexicographically on the ISO timestamp: from the start of `from`'s day to the
  // end of `to`'s day.
  const fromBound = f.from ? f.from.slice(0, 10) : undefined;
  const toBound = f.to ? `${f.to.slice(0, 10)}~` : undefined; // '~' > '9' and 'T', so the whole day is included
  return entries.filter((e) => {
    if (f.action && e.action !== (f.action as AuditAction)) return false;
    if (f.entityType && e.entityType !== (f.entityType as AuditEntityType)) return false;
    if (fromBound && e.timestamp < fromBound) return false;
    if (toBound && e.timestamp > toBound) return false;
    if (q) {
      const haystack = [e.actor?.email ?? '', e.actor?.impersonatorEmail ?? '', e.entityName, e.entityId, e.details ?? '']
        .join('\n')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

// GET /api/audit — filtered page of entries, newest first: { total, entries }.
router.get('/', async (req: AuthRequest, res) => {
  const entries = await filteredEntries(parseFilter(req.query));
  const offsetRaw = Math.floor(Number(req.query.offset));
  const limitRaw = Math.floor(Number(req.query.limit));
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 50;
  res.json({ total: entries.length, entries: entries.slice(offset, offset + limit) });
});

// ── CSV export ────────────────────────────────────────────────────────────────────────────────────

/**
 * RFC-4180 quoting plus a formula-injection guard: a cell starting with =, +, - or @ would execute
 * as a formula in Excel, so it is prefixed with a quote character.
 */
function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const flattenChanges = (changes: AuditEntry['changes']): string =>
  (changes ?? [])
    .map((c) => `${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`)
    .join('; ');

// GET /api/audit/export.csv — the whole filtered trail as a CSV attachment (same filter, no paging).
router.get('/export.csv', async (req: AuthRequest, res) => {
  const entries = await filteredEntries(parseFilter(req.query));
  const header = ['timestamp', 'actorEmail', 'impersonatorEmail', 'action', 'entityType', 'entityId', 'entityName', 'changes', 'details'];
  const rows = entries.map((e) =>
    [
      e.timestamp,
      e.actor?.email ?? '',
      e.actor?.impersonatorEmail ?? '',
      e.action,
      e.entityType,
      e.entityId,
      e.entityName,
      flattenChanges(e.changes),
      e.details ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  // UTF-8 BOM so Excel detects the encoding; CRLF per RFC 4180.
  const bom = String.fromCharCode(0xfeff);
  const csv = bom + [header.join(','), ...rows].join('\r\n') + '\r\n';
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
  return sendAttachment(res, Buffer.from(csv, 'utf-8'), `braingain-audit-${stamp}.csv`, 'text/csv; charset=utf-8');
});

export default router;
