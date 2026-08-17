import type { DueStatus, Training, TrainingSession, TrainingUpdate, UpdateAck } from '../types';

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export interface DueResult {
  status: DueStatus;
  dueDate: string | null;
  lastPassedAt: string | null;
  // Non-null exactly when status === 'updated': the pending training update the user must act on.
  pendingUpdate: TrainingUpdate | null;
}

/**
 * Compute when a user must (re)take a training, given their passing sessions.
 * dueDate = lastPassed + cycleYears.
 * Window = [dueDate - windowBeforeMonths, dueDate + windowAfterMonths].
 *
 * Published training updates overlay the cycle ONLY when it is otherwise satisfied ('up-to-date'):
 * never/due/overdue users must produce a new passing session anyway, and any new pass postdates
 * every publish, so satisfying the cycle satisfies every update — the cycle status is both the
 * simpler and the more urgent answer. An update is pending when it was published after the last
 * pass and (for confirm mode) has not been acknowledged; with several pending, the one with the
 * earliest deadline governs. A pending update keeps status 'updated' even past its deadline — its
 * satisfaction rules differ from cycle overdue (confirm mode stays clearable by an ack).
 */
export function computeDue(
  training: Pick<Training, 'cycleYears' | 'windowBeforeMonths' | 'windowAfterMonths' | 'updates'>,
  sessions: TrainingSession[],
  acks: UpdateAck[] = [],
  now: Date = new Date(),
): DueResult {
  const passed = sessions
    .map((s) => s.completedAt)
    .filter(Boolean)
    .sort();
  const lastPassedAt = passed.length ? passed[passed.length - 1] : null;

  if (!lastPassedAt) {
    return { status: 'never', dueDate: null, lastPassedAt: null, pendingUpdate: null };
  }

  const dueDate = addYears(new Date(lastPassedAt), training.cycleYears);
  const windowOpen = addMonths(dueDate, -training.windowBeforeMonths);
  const windowClose = addMonths(dueDate, training.windowAfterMonths);

  let status: DueStatus;
  if (now < windowOpen) status = 'up-to-date';
  else if (now <= windowClose) status = 'due';
  else status = 'overdue';

  if (status !== 'up-to-date') {
    return { status, dueDate: dueDate.toISOString(), lastPassedAt, pendingUpdate: null };
  }

  const acked = new Set(acks.map((a) => a.updateId));
  // ISO timestamps compare lexicographically, so `publishedAt > lastPassedAt` is exactly "no pass
  // since this publish" — a retake update is cleared by the new pass through this condition alone.
  const pendingList = (training.updates ?? []).filter(
    (u) => u.publishedAt > lastPassedAt && !(u.mode === 'confirm' && acked.has(u.id)),
  );
  if (pendingList.length === 0) {
    return { status, dueDate: dueDate.toISOString(), lastPassedAt, pendingUpdate: null };
  }

  const pending = [...pendingList].sort(
    (a, b) => a.deadline.localeCompare(b.deadline) || b.publishedAt.localeCompare(a.publishedAt),
  )[0];
  return { status: 'updated', dueDate: pending.deadline, lastPassedAt, pendingUpdate: pending };
}

/** Last passing session for a (user, training) pair, or empty list filtered by both. */
export function sessionsFor(
  sessions: TrainingSession[],
  userId: string,
  trainingId: string,
): TrainingSession[] {
  return sessions.filter((s) => s.userId === userId && s.trainingId === trainingId);
}

/** Acknowledgements for a (user, training) pair — the sibling of sessionsFor. */
export function acksFor(acks: UpdateAck[], userId: string, trainingId: string): UpdateAck[] {
  return acks.filter((a) => a.userId === userId && a.trainingId === trainingId);
}
