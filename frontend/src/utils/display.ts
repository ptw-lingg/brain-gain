import type { DueStatus } from '@/types';

export function dueLabel(status: DueStatus, dueDate: string | null): string {
  switch (status) {
    case 'never':
      return 'Due now';
    case 'up-to-date':
      return dueDate ? `Up to date · due ${formatDate(dueDate)}` : 'Up to date';
    case 'due':
      return dueDate ? `Due now · by ${formatDate(dueDate)}` : 'Due now';
    case 'overdue':
      return 'Overdue';
  }
}

export function dueClasses(status: DueStatus): string {
  switch (status) {
    case 'up-to-date':
      return 'bg-pastel-mint/50 text-emerald-700';
    case 'due':
      return 'bg-accent-light/60 text-accent';
    case 'never':
    case 'overdue':
      return 'bg-rose-100 text-rose-600';
  }
}

export function isActionable(status: DueStatus): boolean {
  return status !== 'up-to-date';
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
