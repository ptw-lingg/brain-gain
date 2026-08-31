// SCORM attempt persistence. The per-attempt FILE (DATA_DIR/scorm-attempts/<id>.json) is the
// source of truth for cmi; the scormAttempts store is a denormalized INDEX for resume lookup,
// launch-token revocation, trainer diagnostics and GC, refreshed on lifecycle transitions only.
//
// Why write-through (every commit request goes to disk before it is acked) instead of an in-memory
// debounce: the client already coalesces writes (~2 s), so the request rate is low — and a 200 to
// the browser then MEANS "durably persisted", which is what lets the player promise the learner
// that an acked save survives a crash. Concurrency: one promise chain per attempt id serializes
// read-modify-write on the file; a single chain serializes index rewrites (writeStore rewrites the
// whole file, so unserialized concurrent lifecycle writes would lose records).

import { randomUUID } from 'crypto';
import type {
  ScormAttempt,
  ScormAttemptFile,
  ScormPackageRef,
  ScormVersion,
  Training,
} from '../../types';
import {
  deleteScormAttemptFile,
  readScormAttemptFile,
  readStore,
  writeScormAttemptFile,
  writeStore,
} from '../fileStore';
import { applyCmiWrites, completionSatisfied, emptyCmi, scaledScore } from '../../scorm/model';

// The 'time' completion rule accumulates SERVER-clocked in-content seconds: per commit, the gap
// since the previous one, capped — so an idle tab left open overnight doesn't count as ten hours
// of training, and a client-reported total_time is never trusted.
const ACTIVE_GAP_CAP_SEC = 300;

// ── Serialization ─────────────────────────────────────────────────────────────────────────────────

const attemptQueues = new Map<string, Promise<unknown>>();
function perAttempt<T>(attemptId: string, fn: () => Promise<T>): Promise<T> {
  const prev = attemptQueues.get(attemptId) ?? Promise.resolve();
  const run = prev.then(fn);
  const chained = run.catch(() => undefined); // a failure must not poison the chain
  attemptQueues.set(attemptId, chained);
  // Bound the map: drop the slot once this chain settles with nothing queued behind it.
  void chained.then(() => {
    if (attemptQueues.get(attemptId) === chained) attemptQueues.delete(attemptId);
  });
  return run;
}

let indexQueue: Promise<unknown> = Promise.resolve();
function withIndex<T>(fn: (index: ScormAttempt[]) => Promise<T>): Promise<T> {
  const run = indexQueue.then(async () => {
    const index = await readStore<ScormAttempt>('scormAttempts');
    return fn(index);
  });
  indexQueue = run.catch(() => undefined);
  return run;
}

/** Upsert one attempt's index row (lifecycle transitions only — never per commit). */
async function upsertIndex(attempt: ScormAttempt): Promise<void> {
  await withIndex(async (index) => {
    const i = index.findIndex((a) => a.id === attempt.id);
    if (i === -1) index.push(attempt);
    else index[i] = attempt;
    await writeStore('scormAttempts', index);
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────────

export async function loadAttempt(attemptId: string): Promise<ScormAttemptFile | null> {
  return readScormAttemptFile<ScormAttemptFile>(attemptId);
}

/**
 * Find the newest resumable attempt for (user, training, package, version), or create a fresh one.
 * A new package build or training version NEVER resumes an old attempt — suspend_data is an opaque
 * blob whose meaning is specific to one course build; replaying it into a new build is how a
 * learner gets a hard JS error inside their compliance training. Old open attempts are abandoned.
 */
export async function startOrResumeAttempt(args: {
  userId: string;
  training: Training;
  pkg: ScormPackageRef;
  preview: boolean;
  restart?: boolean;
}): Promise<{ file: ScormAttemptFile; resumed: boolean }> {
  const { userId, training, pkg, preview, restart } = args;
  const index = await readStore<ScormAttempt>('scormAttempts');
  const open = index
    .filter(
      (a) =>
        a.userId === userId &&
        a.trainingId === training.id &&
        a.status === 'in-progress' &&
        !a.consumedBySessionId,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const resumable = open.find(
    (a) => a.packageId === pkg.packageId && a.trainingVersion === training.version && a.preview === preview,
  );
  const stale = open.filter((a) => a !== (restart ? undefined : resumable));

  // Abandon what cannot (or must not) be resumed — superseded builds, or an explicit restart.
  for (const a of stale) {
    await perAttempt(a.id, async () => {
      const file = await loadAttempt(a.id);
      const closed: ScormAttempt = { ...(file?.attempt ?? a), status: 'abandoned' };
      if (file) await writeScormAttemptFile(a.id, { ...file, attempt: closed, rev: file.rev + 1 });
      await upsertIndex(closed);
    });
  }

  if (resumable && !restart) {
    const file = await loadAttempt(resumable.id);
    if (file) {
      file.cmi.entry = 'resume';
      file.attempt.lastActivityAt = new Date().toISOString();
      file.rev += 1;
      await perAttempt(resumable.id, () => writeScormAttemptFile(resumable.id, file));
      return { file, resumed: true };
    }
    // Index row without a file (crash between writes): fall through and start fresh.
  }

  const attempt: ScormAttempt = {
    id: randomUUID(),
    userId,
    trainingId: training.id,
    packageId: pkg.packageId,
    trainingVersion: training.version,
    scormVersion: pkg.version,
    status: 'in-progress',
    preview,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    activeSec: 0,
    terminated: false,
    completion: 'not attempted',
    success: 'unknown',
    scoreScaled: null,
    setValuesCount: 0,
  };
  const file: ScormAttemptFile = { attempt, cmi: emptyCmi(), rev: 1 };
  await perAttempt(attempt.id, () => writeScormAttemptFile(attempt.id, file));
  await upsertIndex(attempt);
  return { file, resumed: false };
}

export interface CommitResult {
  errors: [string, number][];
  completion: ScormAttempt['completion'];
  success: ScormAttempt['success'];
  scaled: number | null;
  terminated: boolean;
}

/**
 * Apply a batch of raw SCORM writes to an attempt and persist it (write-through: the response is
 * the durability guarantee). `terminate` marks a clean LMSFinish/Terminate and accumulates
 * session_time into total_time. Refused (null) when the attempt is closed or consumed — a finished
 * attempt is immutable.
 */
export async function commitAttempt(
  attemptId: string,
  values: Record<string, string>,
  opts: { terminate?: boolean; exit?: string } = {},
): Promise<CommitResult | null> {
  return perAttempt(attemptId, async () => {
    const file = await loadAttempt(attemptId);
    if (!file) return null;
    const { attempt, cmi } = file;
    if (attempt.status !== 'in-progress' || attempt.consumedBySessionId) return null;

    const version: ScormVersion = attempt.scormVersion;
    const before = { completion: cmi.completion, success: cmi.success, sessionTimeSec: cmi.sessionTimeSec };
    const errors = applyCmiWrites(version, cmi, values);

    const now = new Date();
    // Server-clocked in-content time: capped gap since the last commit.
    const gapSec = Math.max(0, (now.getTime() - Date.parse(attempt.lastActivityAt)) / 1000);
    attempt.activeSec += Math.min(gapSec, ACTIVE_GAP_CAP_SEC);
    attempt.lastActivityAt = now.toISOString();
    attempt.setValuesCount += Object.keys(values).length;

    // total_time accumulates the GROWTH of the reported session_time, so repeated commits of a
    // monotonically growing value never double-count; terminate folds in the final report.
    const grewBy = Math.max(0, cmi.sessionTimeSec - before.sessionTimeSec);
    cmi.totalTimeSec += grewBy;

    if (opts.terminate) {
      attempt.terminated = true;
      if (opts.exit && ['time-out', 'suspend', 'logout', 'normal'].includes(opts.exit)) {
        cmi.exit = opts.exit as typeof cmi.exit;
      }
      cmi.sessionTimeSec = 0; // the next browser session reports its own time from zero
    }

    const statusChanged = cmi.completion !== before.completion || cmi.success !== before.success;
    if (cmi.completion === 'completed' && !attempt.completedAt) attempt.completedAt = now.toISOString();
    attempt.completion = cmi.completion;
    attempt.success = cmi.success;
    attempt.scoreScaled = scaledScore(cmi);

    file.rev += 1;
    await writeScormAttemptFile(attemptId, file);
    // The index is refreshed on lifecycle-relevant changes only (status flips, terminate) —
    // not on every bookmark write.
    if (statusChanged || opts.terminate) await upsertIndex(attempt);

    return {
      errors,
      completion: cmi.completion,
      success: cmi.success,
      scaled: attempt.scoreScaled,
      terminated: attempt.terminated,
    };
  });
}

/**
 * Close an attempt after grading. 'completed' additionally records the consuming session —
 * completion evidence that is never GC'd; 'failed' closes it so a relaunch starts ab-initio
 * (a failed run's suspend_data would resume the learner onto its results screen).
 */
export async function closeAttempt(
  attemptId: string,
  outcome: { status: 'completed'; sessionId: string } | { status: 'failed' | 'abandoned' },
): Promise<void> {
  await perAttempt(attemptId, async () => {
    const file = await loadAttempt(attemptId);
    if (!file) return;
    file.attempt.status = outcome.status;
    if (outcome.status === 'completed') file.attempt.consumedBySessionId = outcome.sessionId;
    file.rev += 1;
    await writeScormAttemptFile(attemptId, file);
    await upsertIndex(file.attempt);
  });
}

/** Is the attempt completion-worthy under the package's rule? Reads the FILE, never the index. */
export function attemptCompletionSatisfied(
  file: ScormAttemptFile,
  pkg: Pick<ScormPackageRef, 'completionRule'>,
  durationMinutes: number,
): boolean {
  return completionSatisfied(pkg.completionRule, file.attempt, file.cmi, durationMinutes);
}

/** Delete an attempt (file + index row). Consumed attempts are completion evidence — refused. */
export async function deleteAttempt(attemptId: string): Promise<void> {
  await perAttempt(attemptId, async () => {
    const file = await loadAttempt(attemptId);
    if (file?.attempt.consumedBySessionId) return;
    await deleteScormAttemptFile(attemptId);
    await withIndex(async (index) => {
      await writeStore('scormAttempts', index.filter((a) => a.id !== attemptId));
    });
  });
}
