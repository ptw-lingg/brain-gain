import type { JobRole, OrgUnit, OrgUnitAssignment, Training, TrainingAssignment, User } from '../types';
import { readStore, writeStore } from './fileStore';
import { subtreeUnitIds } from './orgUnits';
import { UUID_RE } from '../routes/http';

/**
 * Backfill `order` (by file position) and `materials: []` on training records that predate those
 * fields. Runs with the other data migrations (boot + after a backup restore) — this used to happen
 * lazily inside GET /api/trainings, i.e. a WRITE on a read path that could revert a concurrent save.
 * Idempotent; the read path still coerces in memory but never writes.
 */
export async function migrateTrainingOrder(): Promise<void> {
  const trainings = await readStore<Training>('trainings');
  let changed = false;
  trainings.forEach((t, i) => {
    if (typeof t.order !== 'number' || !Number.isFinite(t.order)) {
      t.order = i;
      changed = true;
    }
    if (!Array.isArray(t.materials)) {
      t.materials = [];
      changed = true;
    }
  });
  if (changed) await writeStore('trainings', trainings);
}

// ── assignment ───────────────────────────────────────────────────────────────────────────────────
// Three rules decide who must take a training, and a user needs only ONE to match:
//   1. a job role of theirs requires it            (JobRole.trainingIds — the original rule)
//   2. their org unit is assigned to it            (Training.assignment.orgUnits, optionally with
//                                                   the whole subtree below the unit)
//   3. it is assigned to everyone                  (Training.assignment.everyone — every account
//                                                   that can sign in; pending ones are not "everyone")
// Rules 2 and 3 are evaluated here so every reader (dashboard, trainees, my-team, update
// notifications, SCORM launch) gets the identical answer.

/** Does this training's own assignment (rules 2 + 3) apply to the user? */
export function assignedByTraining(user: User, training: Training, orgUnits: OrgUnit[]): boolean {
  const a = training.assignment;
  if (!a) return false;
  if (a.everyone && !user.isDisabled) return true;
  if (!user.orgUnitId || a.orgUnits.length === 0) return false;
  for (const entry of a.orgUnits) {
    if (entry.orgUnitId === user.orgUnitId) return true;
    if (entry.includeSubunits && subtreeUnitIds(orgUnits, [entry.orgUnitId]).has(user.orgUnitId)) return true;
  }
  return false;
}

/**
 * Trainings the given user is required to complete, deduped — from preloaded data. Roles alone
 * when `trainings`/`orgUnits` are not supplied (legacy call shape); the full rule set otherwise.
 */
export function requiredTrainingIdsFor(
  user: User | undefined,
  roles: JobRole[],
  trainings: Training[] = [],
  orgUnits: OrgUnit[] = [],
): Set<string> {
  const ids = new Set<string>();
  if (!user) return ids;
  for (const role of roles) {
    if (user.roleIds.includes(role.id)) role.trainingIds.forEach((id) => ids.add(id));
  }
  for (const t of trainings) {
    if (!ids.has(t.id) && assignedByTraining(user, t, orgUnits)) ids.add(t.id);
  }
  return ids;
}

/** Trainings the given user is required to complete (all three rules), deduped. */
export async function requiredTrainingIds(userId: string): Promise<Set<string>> {
  const [users, roles, trainings, orgUnits] = await Promise.all([
    readStore<User>('users'),
    readStore<JobRole>('roles'),
    readStore<Training>('trainings'),
    readStore<OrgUnit>('orgUnits'),
  ]);
  return requiredTrainingIdsFor(
    users.find((u) => u.id === userId),
    roles,
    trainings,
    orgUnits,
  );
}

/**
 * Client-supplied assignment → stored shape. Unknown or malformed org-unit ids are dropped (the
 * silent-normalizer idiom of this write path), duplicates collapse to the first entry,
 * `includeSubunits` defaults to true (the editor's default). Returns undefined when nothing is
 * assigned, so the field disappears from the record instead of lingering as an empty rule.
 */
export function sanitizeAssignment(input: unknown, orgUnits: OrgUnit[]): TrainingAssignment | undefined {
  const obj = (input ?? {}) as Record<string, unknown>;
  const known = new Set(orgUnits.map((o) => o.id));
  const seen = new Set<string>();
  const entries: OrgUnitAssignment[] = [];
  for (const raw of Array.isArray(obj.orgUnits) ? obj.orgUnits : []) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const id = typeof e.orgUnitId === 'string' ? e.orgUnitId : '';
    if (!UUID_RE.test(id) || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    entries.push({ orgUnitId: id, includeSubunits: e.includeSubunits === undefined ? true : Boolean(e.includeSubunits) });
  }
  const everyone = Boolean(obj.everyone);
  if (!everyone && entries.length === 0) return undefined;
  return { everyone, orgUnits: entries };
}

/** Role ids from a client body (`roleIds`), restricted to roles that exist. Undefined = not sent. */
export function sanitizeRoleIds(input: unknown, roles: JobRole[]): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const known = new Set(roles.map((r) => r.id));
  return [...new Set(input.filter((id): id is string => typeof id === 'string' && known.has(id)))];
}

/**
 * Make exactly the roles in `roleIds` require the training: adds the id to those roles' trainingIds
 * and removes it from every other role. Returns the roles that changed (before/after pairs) for the
 * audit trail; the caller writes the store inside its own transaction.
 */
export function syncRoleAssignment(
  roles: JobRole[],
  trainingId: string,
  roleIds: string[],
): { before: JobRole; after: JobRole }[] {
  const changed: { before: JobRole; after: JobRole }[] = [];
  roles.forEach((role, i) => {
    const has = role.trainingIds.includes(trainingId);
    const want = roleIds.includes(role.id);
    if (has === want) return;
    const after: JobRole = {
      ...role,
      trainingIds: want ? [...role.trainingIds, trainingId] : role.trainingIds.filter((id) => id !== trainingId),
    };
    changed.push({ before: role, after });
    roles[i] = after;
  });
  return changed;
}
