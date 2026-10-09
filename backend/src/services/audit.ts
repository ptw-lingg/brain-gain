// The audit trail: an append-only NDJSON log of who did what, at DATA_DIR/audit.ndjson.
//
// Scope — one entry for every administrative data change (users, roles, trainings, org units,
// settings), authentication event (sign-in success and failure, SSO sign-in, account activation,
// impersonation), backup lifecycle action (create — manual and automatic —, upload, delete,
// restore) and recorded training completion. Deliberately NOT logged: reads (GET endpoints and
// backup downloads), the self-service locale preference (PUT /auth/me), failed quiz attempts (by
// design not persisted anywhere), outbound mail, and dry-run imports.
//
// The log is deliberately NOT a fileStore store:
//   - Entries are appended one line at a time and never rewritten or pruned — a rewrite-the-world
//     JSON array cannot offer that property, and grows O(n) per event on a file that never shrinks.
//   - STORE_FILES is the allowlist backup.ts archives AND restores. The audit log is archived in
//     every backup as evidence (see buildArchive), but a restore must never overwrite it — keeping
//     it outside STORE_FILES keeps that invariant literally true with no special-casing.
//
// A failed append is logged to the console and swallowed: the audit trail supports the primary
// record (who passed which training), so refusing to record a passed training because a log line
// could not be written would create the harm the app exists to prevent.

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { dataDir } from './fileStore';
import type { AuditAction, AuditChange, AuditEntityType, AuditEntry, AuthUser, Settings } from '../types';

const AUDIT_FILE = 'audit.ndjson';

/** Absolute path of the audit log — used by backup.ts to include it in archives. */
export function auditFilePath(): string {
  return path.join(dataDir(), AUDIT_FILE);
}

// Appends are serialized through a promise queue (the exclusive() pattern from backup.ts) so
// concurrent requests never interleave partial lines.
let queue: Promise<unknown> = Promise.resolve();

// A crash mid-append can leave a torn line WITHOUT its newline — blindly appending would glue the
// next entry onto it and corrupt that one too. Before every append the tail is checked and a torn
// line sealed with its missing newline (one 1-byte read; negligible at this app's event rate).
async function healTornTail(): Promise<void> {
  try {
    const fh = await fs.open(auditFilePath(), 'r');
    try {
      const { size } = await fh.stat();
      if (size > 0) {
        const last = Buffer.alloc(1);
        await fh.read(last, 0, 1, size - 1);
        if (last[0] !== 0x0a) await fs.appendFile(auditFilePath(), '\n', 'utf-8'); // seal the torn line
      }
    } finally {
      await fh.close();
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; // no file yet = nothing to heal
  }
}

/**
 * Append one audit entry. NEVER throws and never fails the calling operation — an append failure
 * is reported on the console and swallowed.
 */
export function auditEvent(
  actor: AuthUser | null,
  action: AuditAction,
  entity: { type: AuditEntityType; id?: string; name?: string },
  extra?: { changes?: AuditChange[]; details?: string },
): Promise<void> {
  const entry: AuditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actor: actor
      ? {
          id: actor.id,
          email: actor.email,
          ...(actor.impersonatorId ? { impersonatorId: actor.impersonatorId, impersonatorEmail: actor.impersonatorEmail } : {}),
        }
      : null,
    action,
    entityType: entity.type,
    entityId: entity.id ?? '',
    entityName: entity.name ?? '',
    ...(extra?.changes?.length ? { changes: extra.changes } : {}),
    ...(extra?.details ? { details: extra.details } : {}),
  };
  const run = queue.then(async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    await healTornTail();
    await fs.appendFile(auditFilePath(), JSON.stringify(entry) + '\n', 'utf-8');
  });
  queue = run.catch(() => undefined); // a failure must not poison the chain
  return run.catch((err) => {
    console.error('Audit append failed:', err);
  });
}

/** All entries, oldest first. Unparsable (torn) lines are skipped; no file yet means no entries. */
export async function readAuditEntries(): Promise<AuditEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(auditFilePath(), 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const entries: AuditEntry[] = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      skipped += 1; // a torn line (crash mid-append) loses that one entry, never the log
    }
  }
  if (skipped) console.warn(`Audit log: skipped ${skipped} unparsable line(s)`);
  return entries;
}

// ── Field-level diffs ─────────────────────────────────────────────────────────────────────────────

// Never emitted: noise, not audit-relevant.
const SKIP_FIELDS = new Set(['id', 'createdAt']);

// Emitted with both values masked: the CHANGE is on record, the secret never is. `questions` is
// masked wholesale because a training's answer key (correctIndices) lives inside it — and `draft`
// (the training's staged WIP content) for the same reason: it carries a full questions snapshot.
const REDACT_FIELDS = new Set(['passwordHash', 'activationToken', 'entraOid', 'questions', 'draft']);

// passwordHash is reported under the name the admin actually thinks in.
const FIELD_LABELS: Record<string, string> = { passwordHash: 'password' };

const MASK = '***';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Shallow field-level diff of two records (top-level fields, compared structurally). Skips
 * SKIP_FIELDS, masks REDACT_FIELDS.
 */
export function diffEntities(beforeRecord: object, afterRecord: object): AuditChange[] {
  const before = beforeRecord as Record<string, unknown>;
  const after = afterRecord as Record<string, unknown>;
  const changes: AuditChange[] = [];
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (SKIP_FIELDS.has(field) || same(before[field], after[field])) continue;
    changes.push(
      REDACT_FIELDS.has(field)
        ? { field: FIELD_LABELS[field] ?? field, from: MASK, to: MASK }
        : { field, from: before[field], to: after[field] },
    );
  }
  return changes;
}

/** "Name (id)" for a referenced record: the id stays on record, the name makes it readable. */
export const labelRef = (id: string, name: string | undefined): string => (name ? `${name} (${id})` : id);

/**
 * Rewrites the before/after values of an id-list field (e.g. user.roleIds) as "Name (id)" labels,
 * so an entry can be read without cross-referencing the store — and stays meaningful after the
 * referenced record is renamed or deleted. Ids that resolve to no name stay bare.
 */
export function labelIdList(changes: AuditChange[], field: string, nameOf: (id: string) => string | undefined): AuditChange[] {
  const label = (v: unknown): unknown =>
    Array.isArray(v) ? v.map((id) => (typeof id === 'string' ? labelRef(id, nameOf(id)) : id)) : v;
  return changes.map((c) => (c.field === field ? { ...c, from: label(c.from), to: label(c.to) } : c));
}

// Settings groups whose fields are diffed individually as dot-paths (e.g. 'smtp.host').
const SETTINGS_GROUPS = ['entra', 'smtp', 'autoBackup'] as const;
const SETTINGS_REDACT = new Set(['smtp.password']);

/**
 * Settings-aware diff: scalar settings compared directly, the entra/smtp/autoBackup groups
 * field-by-field as dot-paths, with smtp.password masked. `tls` is excluded — certificate changes
 * are audited by the certificate endpoints, not the settings save.
 */
export function diffSettings(before: Settings, after: Settings): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const field of Object.keys(after) as (keyof Settings)[]) {
    if (field === 'tls') continue;
    if ((SETTINGS_GROUPS as readonly string[]).includes(field)) {
      const b = (before[field] ?? {}) as unknown as Record<string, unknown>;
      const a = (after[field] ?? {}) as unknown as Record<string, unknown>;
      for (const sub of new Set([...Object.keys(b), ...Object.keys(a)])) {
        if (same(b[sub], a[sub])) continue;
        const dotted = `${field}.${sub}`;
        changes.push(
          SETTINGS_REDACT.has(dotted) ? { field: dotted, from: MASK, to: MASK } : { field: dotted, from: b[sub], to: a[sub] },
        );
      }
    } else if (!same(before[field], after[field])) {
      changes.push({ field, from: before[field], to: after[field] });
    }
  }
  return changes;
}
