import type { DueStatus, Training } from '@/types';
import { i18n } from '@/i18n';

/** A translate function compatible with both `useI18n().t` and the standalone `t`. */
type TFn = (key: string, named?: Record<string, unknown>) => string;

export function dueLabel(t: TFn, status: DueStatus, dueDate: string | null): string {
  switch (status) {
    case 'never':
      return t('due.now');
    case 'up-to-date':
      return dueDate ? t('due.upToDateUntil', { date: formatDate(dueDate) }) : t('due.upToDate');
    case 'due':
      return dueDate ? t('due.dueBy', { date: formatDate(dueDate) }) : t('due.now');
    case 'overdue':
      return t('due.overdue');
    case 'updated':
      // Past-deadline stays status 'updated' (its satisfaction rules differ from cycle overdue);
      // only the wording and styling flip — a pure display decision, like formatDate.
      return dueDate && new Date(dueDate).getTime() < Date.now()
        ? t('due.updatedOverdue')
        : dueDate
          ? t('due.updated', { date: formatDate(dueDate) })
          : t('due.updatedNoDate');
  }
}

export function dueClasses(status: DueStatus, dueDate: string | null = null): string {
  switch (status) {
    case 'up-to-date':
      return 'bg-pastel-mint/50 text-emerald-700';
    case 'due':
      return 'bg-orange-100 text-orange-700';
    case 'never':
    case 'overdue':
      return 'bg-rose-100 text-rose-600';
    case 'updated':
      // Distinct badge for the update-triggered due; rose once its deadline has passed.
      return dueDate && new Date(dueDate).getTime() < Date.now()
        ? 'bg-rose-100 text-rose-600'
        : 'bg-pastel-blue/60 text-blue-700';
  }
}

export function isActionable(status: DueStatus): boolean {
  return status !== 'up-to-date';
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(i18n.global.locale.value, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Date plus wall-clock time (with seconds) — for point-in-time records like audit entries. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(i18n.global.locale.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const CATEGORY_TINTS: Record<string, string> = {
  Safety: 'from-pastel-cyan/60',
  Compliance: 'from-pastel-mint/60',
  Technical: 'from-pastel-blue/60',
  General: 'from-pastel-slate/60',
};

export function categoryTint(category: string): string {
  return CATEGORY_TINTS[category] ?? 'from-pastel-sky/60';
}

/** Human-friendly recurrence label, e.g. 1 → "Yearly", 2 → "Every 2 years". */
export function cycleLabel(t: TFn, years: number): string {
  return years === 1 ? t('due.cycleYearly') : t('due.cycleEvery', { years });
}

/**
 * What a training is missing before trainees can use it. A training needs material to study;
 * without material there is nothing to do. Questions are optional for the learner: a training
 * without a test is completed by confirming the materials instead (the confirmation is audited and
 * the empty grading persists the session as evidence). The trainer list still flags a missing test
 * via `ready`/`hasQuestions`.
 */
export interface TrainingReadiness {
  hasMaterial: boolean;
  hasQuestions: boolean;
  /** Material AND a test present — fully prepared from the trainer's point of view. */
  ready: boolean;
  /** Material present — learners can start; without questions the confirmation completes it. */
  startable: boolean;
}

export function trainingReadiness(
  training: Pick<Training, 'materials' | 'questions'>,
): TrainingReadiness {
  // Every stored material carries at least one content-bearing variant (a link or an uploaded
  // file in some language), so one material is enough to have something to study.
  const hasMaterial = (training.materials?.length ?? 0) > 0;
  const hasQuestions = training.questions.length > 0;
  return { hasMaterial, hasQuestions, ready: hasMaterial && hasQuestions, startable: hasMaterial };
}

/** Human-readable duration from minutes: 45 → "45 min", 120 → "2 h", 90 → "1 h 30 min". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h && rest) return `${h} h ${rest} min`;
  if (h) return `${h} h`;
  return `${rest} min`;
}

/** Human-readable file size, e.g. 2048 → "2 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
