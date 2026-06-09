import type { JobRole, User } from '../types';
import { readStore } from './fileStore';

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
