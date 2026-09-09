// SCORM garbage collection + package lookups. Runs from runDataMigrations() — the right hook,
// because migrations also run after a backup restore, which can drop the training that referenced
// a package. Never deletes a consumed attempt or its file: that is completion evidence.

import type { ScormAttempt, ScormPackageRef, Training } from '../../types';
import {
  deleteScormAttemptFile,
  deleteScormPackageFiles,
  listScormAttemptFiles,
  listScormPackageDirs,
  readStore,
  transaction,
  writeStore,
} from '../fileStore';
import { updateAttemptIndex } from './attempts';

// A package uploaded but never attached to a training (the editor was abandoned mid-edit) is
// swept after a day; an in-progress attempt with no activity for a month is abandoned.
const UNREFERENCED_PACKAGE_MAX_AGE_MS = 24 * 3600 * 1000;
const STALE_ATTEMPT_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

/** Every package id referenced by any training — published or staged in a draft. */
export function referencedPackageIds(trainings: Training[]): Set<string> {
  const ids = new Set<string>();
  for (const t of trainings) {
    if (t.scormPackageId) ids.add(t.scormPackageId);
    if (t.draft?.scormPackageId) ids.add(t.draft.scormPackageId);
  }
  return ids;
}

export async function getPackage(packageId: string): Promise<ScormPackageRef | null> {
  const packages = await readStore<ScormPackageRef>('scormPackages');
  return packages.find((p) => p.packageId === packageId) ?? null;
}

/**
 * Delete a package's record and files IF nothing references it any more. Best-effort. The reference
 * check and the record removal share one transaction, so a training save that attaches the package
 * cannot slip in between them.
 */
export function deletePackageIfUnreferenced(packageId: string): Promise<boolean> {
  return transaction(async () => {
    const trainings = await readStore<Training>('trainings');
    if (referencedPackageIds(trainings).has(packageId)) return false;
    const packages = await readStore<ScormPackageRef>('scormPackages');
    const kept = packages.filter((p) => p.packageId !== packageId);
    if (kept.length !== packages.length) await writeStore('scormPackages', kept);
    await deleteScormPackageFiles(packageId);
    return true;
  });
}

export interface GcResult {
  packages: number; // records + trees removed
  orphanDirs: number; // trees on disk with no record (crashed imports)
  attempts: number; // never-consumed attempts removed or abandoned
}

export async function gcScorm(): Promise<GcResult> {
  const [trainings, packages] = await Promise.all([
    readStore<Training>('trainings'),
    readStore<ScormPackageRef>('scormPackages'),
  ]);
  const referenced = referencedPackageIds(trainings);
  const now = Date.now();
  const result: GcResult = { packages: 0, orphanDirs: 0, attempts: 0 };

  // 1. Package records not referenced by any training — swept once older than the grace period
  //    (a trainer may have uploaded and not yet saved the training that will reference it).
  const keptPackages: ScormPackageRef[] = [];
  for (const pkg of packages) {
    const age = now - Date.parse(pkg.uploadedAt);
    if (!referenced.has(pkg.packageId) && age > UNREFERENCED_PACKAGE_MAX_AGE_MS) {
      await deleteScormPackageFiles(pkg.packageId);
      result.packages += 1;
    } else {
      keptPackages.push(pkg);
    }
  }
  if (keptPackages.length !== packages.length) await writeStore('scormPackages', keptPackages);

  // 2. Trees on disk with no record — crashed imports (import deletes on failure, but a hard kill
  //    between extraction and the store write leaves one).
  const knownIds = new Set(keptPackages.map((p) => p.packageId));
  for (const dir of await listScormPackageDirs()) {
    if (!knownIds.has(dir)) {
      await deleteScormPackageFiles(dir);
      result.orphanDirs += 1;
    }
  }

  // 3. Attempts: never-consumed ones whose training or package is gone are dropped; in-progress
  //    ones idle past the window are marked abandoned (kept for diagnostics, files retained).
  //    Consumed attempts are completion evidence — NEVER touched here. Read AND rewritten inside
  //    the attempt index's own queue (after a restore this runs against live traffic, and a
  //    commit's index upsert must not be lost under this rewrite).
  const trainingIds = new Set(trainings.map((t) => t.id));
  let keptAttempts: ScormAttempt[] = [];
  await updateAttemptIndex(async (attempts) => {
    keptAttempts = [];
    let indexChanged = false;
    for (const a of attempts) {
      if (a.consumedBySessionId) {
        keptAttempts.push(a);
        continue;
      }
      if (!trainingIds.has(a.trainingId) || !knownIds.has(a.packageId)) {
        await deleteScormAttemptFile(a.id);
        result.attempts += 1;
        indexChanged = true;
        continue;
      }
      if (a.status === 'in-progress' && now - Date.parse(a.lastActivityAt) > STALE_ATTEMPT_MAX_AGE_MS) {
        keptAttempts.push({ ...a, status: 'abandoned' });
        result.attempts += 1;
        indexChanged = true;
        continue;
      }
      keptAttempts.push(a);
    }
    return indexChanged ? keptAttempts : null;
  });

  // 4. Attempt files with no index row (crash between file write and index write).
  const indexIds = new Set(keptAttempts.map((a) => a.id));
  for (const fileName of await listScormAttemptFiles()) {
    const id = fileName.replace(/\.json$/, '');
    if (!indexIds.has(id)) await deleteScormAttemptFile(id);
  }

  return result;
}
