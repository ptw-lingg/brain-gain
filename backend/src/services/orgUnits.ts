import { randomUUID } from 'crypto';
import type { OrgUnit, User } from '../types';
import { readSettings, readStore, writeStore } from './fileStore';

/**
 * Ensure the org-unit structure exists: create the root (company) unit on first run, and backfill
 * every user with an `orgUnitId`. Idempotent — safe to run on every startup. Covers both the fresh
 * demo seed and existing real data (users imported before this feature had no unit).
 */
export async function migrateOrgUnits(): Promise<void> {
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  const users = await readStore<User>('users');

  if (orgUnits.length === 0) {
    const settings = await readSettings();
    const firstAdmin = users.find((u) => u.isAdmin);
    orgUnits.push({
      id: randomUUID(),
      name: settings.companyName,
      parentId: null,
      headUserId: firstAdmin?.id ?? '',
    });
    await writeStore('orgUnits', orgUnits);
  }

  const root = orgUnits.find((o) => o.parentId === null) ?? orgUnits[0];
  if (!root) return;
  let usersChanged = false;
  for (const u of users) {
    if (!u.orgUnitId) {
      u.orgUnitId = root.id;
      usersChanged = true;
    }
  }
  if (usersChanged) await writeStore('users', users);
}

/** Id of the root org unit (parentId === null), or '' if none exists yet. */
export async function rootOrgUnitId(): Promise<string> {
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  return (orgUnits.find((o) => o.parentId === null) ?? orgUnits[0])?.id ?? '';
}

/** All unit ids in the subtree(s) rooted at `rootIds` (inclusive of the roots themselves). */
export function subtreeUnitIds(units: OrgUnit[], rootIds: string[]): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const u of units) {
    const p = u.parentId ?? '__root__';
    (childrenOf.get(p) ?? childrenOf.set(p, []).get(p)!).push(u.id);
  }
  const result = new Set<string>();
  const queue = [...rootIds];
  while (queue.length) {
    const id = queue.shift()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const child of childrenOf.get(id) ?? []) queue.push(child);
  }
  return result;
}

/** Would re-parenting `unitId` under `newParentId` create a cycle (unit becomes its own ancestor)? */
export function wouldCreateCycle(
  units: OrgUnit[],
  unitId: string,
  newParentId: string | null,
): boolean {
  const byId = new Map(units.map((u) => [u.id, u] as const));
  let cursor: string | null = newParentId;
  while (cursor) {
    if (cursor === unitId) return true;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}
