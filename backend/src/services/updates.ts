// Helpers for published training updates (see TrainingUpdate in types.ts): deadline handling,
// resolving who is affected by a publish, and the boot/post-restore data migrations for the
// version field and the updateAcks store.

import type { JobRole, Training, TrainingSession, UpdateAck, User } from '../types';
import { readStore, writeStore } from './fileStore';
import { requiredTrainingIdsFor } from './training';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Normalize an editor-chosen deadline day to end-of-day UTC, so "due by Aug 31" includes all of
 * Aug 31 and the overdue styling flips only after the day ends. Returns null for anything that is
 * not a real calendar day or lies before today (a deadline that starts overdue is a mistake).
 */
export function normalizeDeadline(input: unknown, now: Date = new Date()): string | null {
  if (typeof input !== 'string') return null;
  const m = DAY_RE.exec(input.trim());
  if (!m) return null;
  const normalized = `${m[1]}-${m[2]}-${m[3]}T23:59:59.999Z`;
  const parsed = new Date(normalized);
  // Round-trip check rejects impossible days like 2026-02-31 (Date would silently roll them over).
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(`${m[1]}-${m[2]}-${m[3]}`)) {
    return null;
  }
  if (parsed.getTime() < now.getTime()) return null;
  return normalized;
}

/**
 * Users affected by publishing an update on this training: assigned via their job roles AND with
 * at least one passing session that predates the publish. Users who never passed are deliberately
 * excluded — they meet the current content on their first pass anyway.
 */
export function affectedUsers(
  training: Pick<Training, 'id'>,
  users: User[],
  roles: JobRole[],
  sessions: TrainingSession[],
): User[] {
  const completed = new Set(sessions.filter((s) => s.trainingId === training.id).map((s) => s.userId));
  return users.filter(
    (u) => completed.has(u.id) && requiredTrainingIdsFor(u, roles).has(training.id),
  );
}

/** Backfill `version: 1` on trainings written before content versions existed. Idempotent. */
export async function migrateTrainingVersions(): Promise<void> {
  const trainings = await readStore<Training>('trainings');
  let changed = false;
  for (const t of trainings) {
    if (typeof t.version !== 'number' || !Number.isFinite(t.version) || t.version < 1) {
      t.version = 1;
      changed = true;
    }
  }
  if (changed) await writeStore('trainings', trainings);
}

/**
 * Drop acknowledgements whose training, update or user no longer exists. Needed because restoring
 * a backup swaps only the stores listed in the archive, so a pre-feature restore can leave acks
 * behind that point at data the restore replaced. Stale acks are inert for due computation (it
 * only consults acks of currently pending updates) — this is hygiene, not correctness. Idempotent.
 */
export async function pruneUpdateAcks(): Promise<void> {
  const [acks, trainings, users] = await Promise.all([
    readStore<UpdateAck>('updateAcks'),
    readStore<Training>('trainings'),
    readStore<User>('users'),
  ]);
  if (acks.length === 0) return;
  const userIds = new Set(users.map((u) => u.id));
  const updateIdsByTraining = new Map(
    trainings.map((t) => [t.id, new Set((t.updates ?? []).map((u) => u.id))] as const),
  );
  const kept = acks.filter(
    (a) => userIds.has(a.userId) && updateIdsByTraining.get(a.trainingId)?.has(a.updateId),
  );
  if (kept.length !== acks.length) await writeStore('updateAcks', kept);
}
