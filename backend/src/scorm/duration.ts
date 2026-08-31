// SCORM time formats. 1.2 uses CMITimespan (HHHH:MM:SS.SS); 2004 uses ISO 8601 durations
// (PT1H30M5.5S, optionally with a date part). Content WRITES session_time in its dialect and READS
// total_time in the same dialect — total_time itself is server-accumulated in seconds, so both a
// parser and a formatter per dialect live here. Parsers are tolerant (authoring tools are sloppy);
// an unparsable value reads as 0 rather than erroring an attempt mid-course.

import type { ScormVersion } from '../types';

/** Parse a 1.2 CMITimespan ("0000:12:30.5") to seconds. Unparsable → 0. */
export function parseTimespan12(value: string): number {
  const m = /^(\d{2,4}):(\d{2}):(\d{2})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return 0;
  const [, h, min, s, frac] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + (frac ? Number(`0.${frac}`) : 0);
}

/** Parse a 2004 ISO 8601 duration ("PT1H30M5.5S", "P1DT2H") to seconds. Unparsable → 0. */
export function parseDuration2004(value: string): number {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    value.trim(),
  );
  if (!m || value.trim() === 'P') return 0;
  const [, years, months, days, hours, minutes, seconds] = m;
  // Years/months are approximated the way most LMSs do (365/30 days) — session times never
  // legitimately reach those units, this only keeps a weird value from being dropped entirely.
  return (
    (Number(years) || 0) * 365 * 86400 +
    (Number(months) || 0) * 30 * 86400 +
    (Number(days) || 0) * 86400 +
    (Number(hours) || 0) * 3600 +
    (Number(minutes) || 0) * 60 +
    (Number(seconds) || 0)
  );
}

/** Parse a session_time value in the given dialect to seconds (clamped to a sane non-negative). */
export function parseSessionTime(version: ScormVersion, value: string): number {
  const sec = version === '1.2' ? parseTimespan12(value) : parseDuration2004(value);
  if (!Number.isFinite(sec) || sec < 0) return 0;
  return Math.min(sec, 365 * 86400); // one attempt session cannot meaningfully exceed a year
}

/** Format seconds as a 1.2 CMITimespan ("0001:02:03"). */
export function formatTimespan12(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(Math.min(h, 9999), 4)}:${pad(m)}:${pad(s)}`;
}

/** Format seconds as a 2004 ISO 8601 duration ("PT1H2M3S"). */
export function formatDuration2004(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  let out = 'PT';
  if (h) out += `${h}H`;
  if (m) out += `${m}M`;
  out += `${s}S`;
  return out;
}

/** Format accumulated seconds as the total_time string of the given dialect. */
export function formatTotalTime(version: ScormVersion, totalSec: number): string {
  return version === '1.2' ? formatTimespan12(totalSec) : formatDuration2004(totalSec);
}
