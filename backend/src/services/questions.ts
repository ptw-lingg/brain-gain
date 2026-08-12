// Quiz-question helpers: normalizing the answer key that arrives from a client, grading an attempt,
// and migrating the legacy single-answer shape.
//
// A question's answer key is `correctIndices: number[]` — one or more options may be correct. Grading
// is EXACT SET MATCH: an attempt is right only when the selected options are exactly the correct ones,
// with no partial credit for finding some of them. That is the defensible rule for a pass/fail
// competency record, and it keeps a multi-answer question from being passable by ticking everything.
//
// A question additionally carries a presentation type: 'single' (radio buttons, exactly one correct
// answer) or 'multiple' (checkboxes). The type does not change the grading rule — a single-choice
// question is just an exact set match on a one-element set.

import type { LocalizedText, Question, Training } from '../types';
import { readStore, writeStore } from './fileStore';

/**
 * Coerce a question text or answer option into its localized form: an object keeps only configured
 * locales with non-empty trimmed strings; a legacy plain string becomes the English entry (English
 * is always configured). An empty result means "no language filled" — the caller drops the item,
 * mirroring the material rules.
 */
export function sanitizeLocalizedText(input: unknown, allowedLocales: readonly string[]): LocalizedText {
  if (typeof input === 'string') {
    const s = input.trim();
    return s ? { en: s } : {};
  }
  const obj = (input ?? {}) as Record<string, unknown>;
  const out: LocalizedText = {};
  for (const locale of allowedLocales) {
    const v = obj[locale];
    if (typeof v === 'string' && v.trim()) out[locale] = v.trim();
  }
  return out;
}

/**
 * Coerce whatever a client sent into a valid answer key: unique, in-bounds, ascending integers, and
 * never empty (a question with no correct answer would be unanswerable, so it falls back to the first
 * option — the same spirit as the old single-index fallback). Accepts a bare number so a legacy client
 * or stored record still normalizes.
 */
export function normalizeCorrectIndices(input: unknown, optionCount: number): number[] {
  const raw = Array.isArray(input) ? input : [input];
  const cleaned = [
    ...new Set(
      raw
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n >= 0 && (optionCount === 0 || n < optionCount)),
    ),
  ].sort((a, b) => a - b);
  return cleaned.length ? cleaned : [0];
}

/**
 * A question's effective type. Absent means 'multiple' (records predating the field), and 'single'
 * only counts when the answer key really has exactly one entry — so a record edited by hand or
 * restored from an old backup can never present as single-choice with a multi-answer key.
 */
export function questionType(q: Pick<Question, 'type' | 'correctIndices'>): 'single' | 'multiple' {
  return q.type === 'single' && q.correctIndices.length === 1 ? 'single' : 'multiple';
}

/** The learner's selection for one question, normalized the same way (may legitimately be empty). */
function normalizeSelection(input: unknown, optionCount: number): number[] {
  const raw = Array.isArray(input) ? input : [input];
  return [
    ...new Set(
      raw
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n >= 0 && (optionCount === 0 || n < optionCount)),
    ),
  ].sort((a, b) => a - b);
}

/** True when the selection is exactly the question's correct set. */
export function isAnswerCorrect(question: Question, selection: unknown): boolean {
  const chosen = normalizeSelection(selection, question.options.length);
  const key = question.correctIndices;
  return chosen.length === key.length && chosen.every((n, i) => n === key[i]);
}

/** Number of questions answered exactly right. */
export function gradeAnswers(questions: Question[], answers: unknown[]): number {
  return questions.reduce((acc, q, i) => acc + (isAnswerCorrect(q, answers[i]) ? 1 : 0), 0);
}

/**
 * One-time migration of stored questions from the single-answer shape (`correctIndex: n`) to
 * `correctIndices: [n]`. Runs at boot next to migrateOrgUnits(); a no-op once every question carries
 * the new field, so it is safe to run on every start.
 */
export async function migrateQuestions(): Promise<void> {
  const trainings = await readStore<Training>('trainings');
  let migrated = 0;

  for (const training of trainings) {
    for (const q of training.questions ?? []) {
      // Stored records may predate several shapes — treat the fields as unknown while converting.
      const legacy = q as unknown as { correctIndex?: number; correctIndices?: unknown; text: unknown; options: unknown[] };
      if (!Array.isArray(legacy.correctIndices) || !legacy.correctIndices.length) {
        legacy.correctIndices = normalizeCorrectIndices(legacy.correctIndex, legacy.options?.length ?? 0);
        migrated += 1;
      }
      delete legacy.correctIndex; // new field wins; drop any leftover
      // Pre-localization records carry plain strings — wrap them as the English entry. (The live
      // bilingual strings were separated by hand into proper de/en entries in the data itself.)
      if (typeof legacy.text === 'string') {
        legacy.text = legacy.text.trim() ? { en: legacy.text.trim() } : {};
        migrated += 1;
      }
      if (Array.isArray(legacy.options) && legacy.options.some((o) => typeof o === 'string')) {
        legacy.options = legacy.options.map((o) =>
          typeof o === 'string' ? (o.trim() ? { en: o.trim() } : {}) : o,
        );
        migrated += 1;
      }
    }
  }

  // Only write when something changed, so a normal boot doesn't rewrite the store.
  if (!migrated) return;
  await writeStore('trainings', trainings);
  console.log(`↪  migrated ${migrated} quiz question field(s) (correctIndices / localized text)`);
}
