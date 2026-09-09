import type { JobRole, Training, User } from '../types';
import { readStore, writeStore } from './fileStore';

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

/** Trainings the given user is required to complete (via job roles), deduped — from preloaded data. */
export function requiredTrainingIdsFor(user: User | undefined, roles: JobRole[]): Set<string> {
  const ids = new Set<string>();
  if (!user) return ids;
  for (const role of roles) {
    if (user.roleIds.includes(role.id)) role.trainingIds.forEach((id) => ids.add(id));
  }
  return ids;
}

/** Trainings the given user is required to complete (via job roles), deduped. */
export async function requiredTrainingIds(userId: string): Promise<Set<string>> {
  const [users, roles] = await Promise.all([
    readStore<User>('users'),
    readStore<JobRole>('roles'),
  ]);
  return requiredTrainingIdsFor(
    users.find((u) => u.id === userId),
    roles,
  );
}
