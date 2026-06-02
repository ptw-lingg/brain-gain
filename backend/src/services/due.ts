import type { DueStatus, Training, TrainingSession } from '../types';

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
}

/**
 * Compute when a user must (re)take a training, given their passing sessions.
 * dueDate = lastPassed + cycleYears.
 * Window = [dueDate - windowBeforeMonths, dueDate + windowAfterMonths].
 */
export function computeDue(
  training: Pick<Training, 'cycleYears' | 'windowBeforeMonths' | 'windowAfterMonths'>,
  sessions: TrainingSession[],
  now: Date = new Date(),
): DueResult {
  const passed = sessions
    .map((s) => s.completedAt)
    .filter(Boolean)
    .sort();
  const lastPassedAt = passed.length ? passed[passed.length - 1] : null;

  if (!lastPassedAt) {
    return { status: 'never', dueDate: null, lastPassedAt: null };
  }

  const dueDate = addYears(new Date(lastPassedAt), training.cycleYears);
  const windowOpen = addMonths(dueDate, -training.windowBeforeMonths);
  const windowClose = addMonths(dueDate, training.windowAfterMonths);

  let status: DueStatus;
  if (now < windowOpen) status = 'up-to-date';
  else if (now <= windowClose) status = 'due';
  else status = 'overdue';

  return { status, dueDate: dueDate.toISOString(), lastPassedAt };
}

/** Last passing session for a (user, training) pair, or empty list filtered by both. */
export function sessionsFor(
  sessions: TrainingSession[],
  userId: string,
  trainingId: string,
): TrainingSession[] {
  return sessions.filter((s) => s.userId === userId && s.trainingId === trainingId);
}
