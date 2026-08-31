// The version-neutral cmi data model and the single mapping table between it and the two SCORM
// dialects — used in BOTH directions (applying writes from content, flattening the seed the shim
// answers reads from). CANONICAL COPY: the browser shim keeps a simplified twin only so it can
// return the right SCORM error code synchronously; THIS module is what the server persists and
// what the completion decision reads. Nothing here trusts client-computed results — scores and
// statuses arrive as raw SCORM element writes and are normalized here.

import type {
  ScormAttempt,
  ScormCmi,
  ScormCompletionRule,
  ScormCompletionStatus,
  ScormSuccessStatus,
  ScormVersion,
} from '../types';
import { CMI_MAX_VALUE_LEN } from './protocol';
import { formatTotalTime, parseSessionTime } from './duration';

// SCORM API error codes actually returned by writes. 1.2 and 2004 number them differently:
// 1.2 →  403 element is read only · 405 incorrect data type (also our over-cap rejection)
// 2004 → 404 element is read only · 406 type mismatch · 351 general set failure (our over-cap)
const E12_READONLY = 403;
const E12_BAD_VALUE = 405;
const E2004_READONLY = 404;
const E2004_BAD_VALUE = 406;
const E2004_SET_FAIL = 351;

// Caps on the verbatim evidence maps. Over-cap writes are REJECTED with the dialect's set-failure
// code — never silently truncated (a truncated suspend_data or interaction is worse than none).
const MAX_INTERACTION_KEYS = 2500; // ~250 interactions × ~10 fields
const MAX_OBJECTIVE_KEYS = 1000;
const MAX_EXTRA_KEYS = 200;
const MAX_EVIDENCE_VALUE_LEN = 4096; // per interaction/objective/extra value
const MAX_LOCATION_LEN = 1000;

export function emptyCmi(): ScormCmi {
  return {
    location: '',
    suspendData: '',
    completion: 'not attempted',
    success: 'unknown',
    entry: 'ab-initio',
    exit: '',
    score: { raw: null, min: null, max: null, scaled: null },
    progressMeasure: null,
    sessionTimeSec: 0,
    totalTimeSec: 0,
    interactions: {},
    objectives: {},
    extra: {},
  };
}

/**
 * The normalized 0–1 score of an attempt, or null when the course reported none. 2004's native
 * `scaled` wins; 1.2 (or a 2004 course that only sets raw) derives from raw against min/max with
 * the spec defaults (0/100), clamped — and guards the degenerate max === min.
 */
export function scaledScore(cmi: ScormCmi): number | null {
  if (cmi.score.scaled !== null && Number.isFinite(cmi.score.scaled)) {
    return Math.min(1, Math.max(0, cmi.score.scaled));
  }
  if (cmi.score.raw === null || !Number.isFinite(cmi.score.raw)) return null;
  const min = cmi.score.min ?? 0;
  const max = cmi.score.max ?? 100;
  if (max <= min) return null;
  return Math.min(1, Math.max(0, (cmi.score.raw - min) / (max - min)));
}

/**
 * Has the course delivered a GRADEABLE outcome under the trainer-chosen rule? This gates whether
 * grading may run at all; pass/fail (the success veto + passThreshold) is decided separately by
 * the grading endpoint. A definitive FAILED verdict is gradeable too — like the quiz path, failure
 * is reported through grade (recording nothing, closing the attempt) so the learner retries a
 * fresh run. `activeSec` is SERVER-clocked in-content time — the 'time' rule never trusts a
 * client-reported total_time.
 */
export function completionSatisfied(
  rule: ScormCompletionRule,
  attempt: Pick<ScormAttempt, 'terminated' | 'activeSec'>,
  cmi: Pick<ScormCmi, 'completion' | 'success'>,
  durationMinutes: number,
): boolean {
  switch (rule) {
    case 'status':
      return cmi.success === 'passed' || cmi.success === 'failed' || cmi.completion === 'completed';
    case 'exit':
      return attempt.terminated;
    case 'time':
      return attempt.activeSec >= Math.max(1, durationMinutes) * 60;
  }
}

const num = (value: string): number | null => {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// 1.2 lesson_status is one field carrying what 2004 splits into completion + success. A write maps
// onto the internal pair; null = leave that half unchanged (e.g. 'completed' says nothing about
// pass/fail).
const LESSON_STATUS_12: Record<string, [ScormCompletionStatus, ScormSuccessStatus | null]> = {
  passed: ['completed', 'passed'],
  completed: ['completed', null],
  failed: ['completed', 'failed'],
  incomplete: ['incomplete', null],
  browsed: ['incomplete', null],
  'not attempted': ['not attempted', 'unknown'],
};

/**
 * Apply ONE raw SCORM element write to the internal model. Mutates `cmi`; returns null when the
 * write was accepted, else the dialect's SCORM error code. Tolerant by design: unknown-but-
 * plausible elements land verbatim in the evidence maps rather than erroring — Captivate's
 * "strict LMS" mode probes elements, and rejecting them wholesale breaks it.
 */
function applyOne(version: ScormVersion, cmi: ScormCmi, key: string, value: string): number | null {
  const READONLY = version === '1.2' ? E12_READONLY : E2004_READONLY;
  const BAD = version === '1.2' ? E12_BAD_VALUE : E2004_BAD_VALUE;
  const SET_FAIL = version === '1.2' ? E12_BAD_VALUE : E2004_SET_FAIL;

  if (
    readOnlyKeys(version).includes(key) ||
    key.endsWith('._children') ||
    key.endsWith('._count') ||
    key === 'cmi._version'
  ) {
    return READONLY;
  }

  if (version === '1.2') {
    switch (key) {
      case 'cmi.core.lesson_status': {
        const mapped = LESSON_STATUS_12[value];
        if (!mapped) return BAD;
        cmi.completion = mapped[0];
        if (mapped[1] !== null) cmi.success = mapped[1];
        return null;
      }
      case 'cmi.core.lesson_location':
        if (value.length > MAX_LOCATION_LEN) return SET_FAIL;
        cmi.location = value;
        return null;
      case 'cmi.core.score.raw': cmi.score.raw = num(value); return null;
      case 'cmi.core.score.min': cmi.score.min = num(value); return null;
      case 'cmi.core.score.max': cmi.score.max = num(value); return null;
      case 'cmi.core.session_time': cmi.sessionTimeSec = parseSessionTime('1.2', value); return null;
      case 'cmi.core.exit':
        if (!['', 'time-out', 'suspend', 'logout'].includes(value)) return BAD;
        cmi.exit = value as ScormCmi['exit'];
        return null;
    }
  } else {
    switch (key) {
      case 'cmi.completion_status':
        if (!['completed', 'incomplete', 'not attempted', 'unknown'].includes(value)) return BAD;
        cmi.completion = value as ScormCompletionStatus;
        return null;
      case 'cmi.success_status':
        if (!['passed', 'failed', 'unknown'].includes(value)) return BAD;
        cmi.success = value as ScormSuccessStatus;
        return null;
      case 'cmi.location':
        if (value.length > MAX_LOCATION_LEN) return SET_FAIL;
        cmi.location = value;
        return null;
      case 'cmi.score.scaled': {
        const n = num(value);
        if (n !== null && (n < -1 || n > 1)) return BAD;
        cmi.score.scaled = n;
        return null;
      }
      case 'cmi.score.raw': cmi.score.raw = num(value); return null;
      case 'cmi.score.min': cmi.score.min = num(value); return null;
      case 'cmi.score.max': cmi.score.max = num(value); return null;
      case 'cmi.session_time': cmi.sessionTimeSec = parseSessionTime('2004', value); return null;
      case 'cmi.progress_measure': {
        const n = num(value);
        if (n !== null && (n < 0 || n > 1)) return BAD;
        cmi.progressMeasure = n;
        return null;
      }
      case 'cmi.exit':
        if (!['', 'time-out', 'suspend', 'logout', 'normal'].includes(value)) return BAD;
        cmi.exit = value as ScormCmi['exit'];
        return null;
    }
  }

  // suspend_data is spelled the same in both dialects.
  if (key === 'cmi.suspend_data') {
    if (value.length > CMI_MAX_VALUE_LEN) return SET_FAIL; // rejected, NEVER truncated
    cmi.suspendData = value; // verbatim — byte-exact round-trip keeps Storyline resume alive
    return null;
  }

  // Evidence maps: interactions and objectives verbatim, everything else tolerated into `extra`
  // (adl.nav.request included — accepted and ignored, never an error).
  const target = key.startsWith('cmi.interactions.')
    ? cmi.interactions
    : key.startsWith('cmi.objectives.')
      ? cmi.objectives
      : cmi.extra;
  const cap =
    target === cmi.interactions ? MAX_INTERACTION_KEYS : target === cmi.objectives ? MAX_OBJECTIVE_KEYS : MAX_EXTRA_KEYS;
  if (value.length > MAX_EVIDENCE_VALUE_LEN) return SET_FAIL;
  if (!(key in target) && Object.keys(target).length >= cap) return SET_FAIL;
  target[key] = value;
  return null;
}

/**
 * Apply one batch of raw SCORM element writes (dialect key → string value) to the internal model.
 * Mutates `cmi`; returns per-key SCORM error codes for the rejected writes (an accepted write
 * produces no entry).
 */
export function applyCmiWrites(
  version: ScormVersion,
  cmi: ScormCmi,
  values: Record<string, string>,
): [string, number][] {
  const errors: [string, number][] = [];
  for (const [key, value] of Object.entries(values)) {
    const code = applyOne(version, cmi, key, value);
    if (code !== null) errors.push([key, code]);
  }
  return errors;
}

/** Read-only elements per dialect — writes get the dialect's read-only error, and the list is
 *  shipped to the shim in the init message so client and server can never drift. */
export function readOnlyKeys(version: ScormVersion): readonly string[] {
  return version === '1.2'
    ? [
        'cmi.core.student_id',
        'cmi.core.student_name',
        'cmi.core.credit',
        'cmi.core.lesson_mode',
        'cmi.core.entry',
        'cmi.core.total_time',
        'cmi.launch_data',
        'cmi.student_data.mastery_score',
        'cmi.student_data.max_time_allowed',
        'cmi.student_data.time_limit_action',
      ]
    : [
        'cmi.learner_id',
        'cmi.learner_name',
        'cmi.credit',
        'cmi.mode',
        'cmi.entry',
        'cmi.total_time',
        'cmi.launch_data',
        'cmi.scaled_passing_score',
        'cmi.max_time_allowed',
        'cmi.time_limit_action',
      ];
}

export interface CmiSeedContext {
  studentId: string; // the User UUID — deliberately not the email (no PII to untrusted content)
  studentName: string;
  masteryScore: number | null; // normalized 0–1 (formatted per dialect below)
  launchData: string;
  mode: 'normal' | 'browse';
  credit: 'credit' | 'no-credit';
  entry: 'ab-initio' | 'resume';
}

const numStr = (n: number | null): string => (n === null ? '' : String(n));

/** Highest interaction/objective index + 1, from the verbatim key map ("cmi.interactions.7.id" → 8). */
function countOf(map: Record<string, string>, prefix: string): number {
  let max = -1;
  for (const key of Object.keys(map)) {
    const m = new RegExp(`^${prefix.replace(/\./g, '\\.')}\\.(\\d+)\\.`).exec(key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * Flatten the internal model into the COMPLETE dialect map the shim is seeded with at launch.
 * Every element a course could plausibly LMSGetValue must be present (or covered by the shim's
 * ""+error-401 fallback) — reads are answered locally and synchronously, never over the bridge.
 */
export function flattenCmi(version: ScormVersion, cmi: ScormCmi, ctx: CmiSeedContext): Record<string, string> {
  const lessonStatus12 = (): string => {
    if (cmi.success === 'passed') return 'passed';
    if (cmi.success === 'failed') return 'failed';
    if (cmi.completion === 'completed') return 'completed';
    if (cmi.completion === 'incomplete') return 'incomplete';
    return 'not attempted'; // 1.2 has no 'unknown' — never hand a 1.2 SCO a foreign vocabulary value
  };

  const base: Record<string, string> =
    version === '1.2'
      ? {
          'cmi.core._children':
            'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time',
          'cmi.core.student_id': ctx.studentId,
          'cmi.core.student_name': ctx.studentName,
          'cmi.core.lesson_location': cmi.location,
          'cmi.core.credit': ctx.credit,
          'cmi.core.lesson_status': lessonStatus12(),
          'cmi.core.entry': ctx.entry === 'ab-initio' ? '' : 'resume', // 1.2: '' means a fresh attempt
          'cmi.core.score._children': 'raw,min,max',
          'cmi.core.score.raw': numStr(cmi.score.raw),
          'cmi.core.score.min': numStr(cmi.score.min),
          'cmi.core.score.max': numStr(cmi.score.max),
          'cmi.core.total_time': formatTotalTime('1.2', cmi.totalTimeSec),
          'cmi.core.lesson_mode': ctx.mode,
          'cmi.suspend_data': cmi.suspendData,
          'cmi.launch_data': ctx.launchData,
          'cmi.comments': '',
          'cmi.student_data._children': 'mastery_score,max_time_allowed,time_limit_action',
          'cmi.student_data.mastery_score': ctx.masteryScore === null ? '' : String(Math.round(ctx.masteryScore * 100)),
          'cmi.student_data.max_time_allowed': '',
          'cmi.student_data.time_limit_action': '',
          'cmi.interactions._children':
            'id,objectives,time,type,correct_responses,weighting,student_response,result,latency',
          'cmi.interactions._count': String(countOf(cmi.interactions, 'cmi.interactions')),
          'cmi.objectives._children': 'id,score,status',
          'cmi.objectives._count': String(countOf(cmi.objectives, 'cmi.objectives')),
        }
      : {
          'cmi._version': '1.0',
          'cmi.learner_id': ctx.studentId,
          'cmi.learner_name': ctx.studentName,
          'cmi.location': cmi.location,
          'cmi.credit': ctx.credit,
          'cmi.completion_status': cmi.completion,
          'cmi.success_status': cmi.success,
          'cmi.entry': ctx.entry,
          'cmi.exit': '',
          'cmi.score._children': 'scaled,raw,min,max',
          'cmi.score.scaled': numStr(cmi.score.scaled),
          'cmi.score.raw': numStr(cmi.score.raw),
          'cmi.score.min': numStr(cmi.score.min),
          'cmi.score.max': numStr(cmi.score.max),
          'cmi.total_time': formatTotalTime('2004', cmi.totalTimeSec),
          'cmi.mode': ctx.mode,
          'cmi.suspend_data': cmi.suspendData,
          'cmi.launch_data': ctx.launchData,
          'cmi.progress_measure': numStr(cmi.progressMeasure),
          'cmi.scaled_passing_score': ctx.masteryScore === null ? '' : String(ctx.masteryScore),
          'cmi.max_time_allowed': '',
          'cmi.time_limit_action': '',
          'cmi.interactions._children':
            'id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description',
          'cmi.interactions._count': String(countOf(cmi.interactions, 'cmi.interactions')),
          'cmi.objectives._children': 'id,score,success_status,completion_status,progress_measure,description',
          'cmi.objectives._count': String(countOf(cmi.objectives, 'cmi.objectives')),
        };

  // Evidence maps ride along verbatim so a resumed course reads back exactly what it wrote.
  return { ...base, ...cmi.interactions, ...cmi.objectives, ...cmi.extra };
}
