// Unit tests for the canonical SCORM pure logic (SYS-SCO-01/06/07, traced to SR-178/SR-179):
// the zip-slip containment check, the 1.2↔2004 cmi mapping in both directions, the suspend_data
// cap (rejected, never truncated), score normalization edges, duration formats, the completion
// rules, and the bridge message validators — plus the mirror-drift check that pins the frontend
// twin's constants to the backend's.
//
// These import the REAL TypeScript modules via tsx's ESM api (tsx is already the backend runtime),
// so the logic under test is byte-identical to what the server runs.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { require as tsRequire } from 'tsx/cjs/api';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'braingain-model-'));

let model, protocol, duration, fileStore;
before(() => {
  model = tsRequire('../src/scorm/model.ts', import.meta.url);
  protocol = tsRequire('../src/scorm/protocol.ts', import.meta.url);
  duration = tsRequire('../src/scorm/duration.ts', import.meta.url);
  fileStore = tsRequire('../src/services/fileStore.ts', import.meta.url);
});

// ── zip-slip containment (SYS-SCO-13 / SR-181 / VT-196) ─────────────────────────────────────────

test('SYS-SCO-01 / SYS-SCO-13 / SR-181 / VT-196: resolveScormEntry rejects every traversal shape and resolves clean paths', () => {
  const pid = '11111111-1111-1111-1111-111111111111';
  const bad = [
    '../evil', '..\\evil', 'a/../../evil', 'a/..', '/abs', 'C:/evil', 'c:\\evil', '//unc/share',
    'a//b', './a', 'a/./b', '', 'a/b/../../..', '..', 'a\u0000b', 'x'.repeat(2000),
  ];
  for (const rel of bad) {
    assert.equal(fileStore.resolveScormEntry(pid, rel), null, `must reject: ${JSON.stringify(rel)}`);
  }
  const ok = fileStore.resolveScormEntry(pid, 'lib/story.js');
  assert.ok(ok && ok.includes(`${pid}${sep}lib${sep}story.js`), 'clean nested path resolves inside the package dir');
  // Backslashes are normalized to separators, not treated as name characters.
  const backslash = fileStore.resolveScormEntry(pid, 'lib\\story.js');
  assert.ok(backslash && backslash.endsWith(`lib${sep}story.js`));
});

// ── cmi mapping, both dialects (SYS-SCO-07 / SR-179 / VT-200 / VT-201) ──────────────────────────

test('SYS-SCO-07 / VT-200: 1.2 lesson_status maps onto the completion+success pair and reads back in 1.2 vocabulary', () => {
  const cmi = model.emptyCmi();
  let errs = model.applyCmiWrites('1.2', cmi, { 'cmi.core.lesson_status': 'passed' });
  assert.deepEqual(errs, []);
  assert.equal(cmi.completion, 'completed');
  assert.equal(cmi.success, 'passed');

  model.applyCmiWrites('1.2', cmi, { 'cmi.core.lesson_status': 'failed' });
  assert.equal(cmi.success, 'failed');

  // 'completed' says nothing about pass/fail — success is left alone.
  model.applyCmiWrites('1.2', cmi, { 'cmi.core.lesson_status': 'completed' });
  assert.equal(cmi.success, 'failed');

  // Read-back NEVER hands a 1.2 SCO a foreign vocabulary value.
  const flat = model.flattenCmi('1.2', cmi, {
    studentId: 'u1', studentName: 'U', masteryScore: 0.8, launchData: '', mode: 'normal', credit: 'credit', entry: 'ab-initio',
  });
  assert.equal(flat['cmi.core.lesson_status'], 'failed');
  assert.equal(flat['cmi.student_data.mastery_score'], '80');
  assert.equal(flat['cmi.core.entry'], '');

  errs = model.applyCmiWrites('1.2', cmi, { 'cmi.core.lesson_status': 'garbage' });
  assert.equal(errs.length, 1);
  assert.equal(errs[0][1], 405, '1.2 bad vocabulary → 405');
});

test('SYS-SCO-07 / VT-201: 2004 statuses, scaled score bounds and progress_measure validate per dialect', () => {
  const cmi = model.emptyCmi();
  let errs = model.applyCmiWrites('2004', cmi, {
    'cmi.completion_status': 'completed',
    'cmi.success_status': 'passed',
    'cmi.score.scaled': '0.92',
  });
  assert.deepEqual(errs, []);
  assert.equal(model.scaledScore(cmi), 0.92);

  errs = model.applyCmiWrites('2004', cmi, { 'cmi.score.scaled': '1.5' });
  assert.equal(errs[0][1], 406, '2004 out-of-range scaled → 406');
  errs = model.applyCmiWrites('2004', cmi, { 'cmi.completion_status': 'done' });
  assert.equal(errs[0][1], 406);
  errs = model.applyCmiWrites('2004', cmi, { 'cmi.learner_id': 'spoof' });
  assert.equal(errs[0][1], 404, '2004 read-only write → 404');
  errs = model.applyCmiWrites('1.2', model.emptyCmi(), { 'cmi.core.student_id': 'spoof' });
  assert.equal(errs[0][1], 403, '1.2 read-only write → 403');
});

test('SYS-SCO-07 / SR-179 / VT-201: over-cap suspend_data is REJECTED with the dialect code, never truncated', () => {
  const cmi = model.emptyCmi();
  model.applyCmiWrites('1.2', cmi, { 'cmi.suspend_data': 'keep-me' });
  const over = 'x'.repeat(protocol.CMI_MAX_VALUE_LEN + 1);
  let errs = model.applyCmiWrites('1.2', cmi, { 'cmi.suspend_data': over });
  assert.equal(errs[0][1], 405);
  assert.equal(cmi.suspendData, 'keep-me', 'rejected write leaves the stored value untouched');
  errs = model.applyCmiWrites('2004', cmi, { 'cmi.suspend_data': over });
  assert.equal(errs[0][1], 351);

  // Under the cap, even far beyond the 1.2 spec's 4096, round-trips byte-exact (Storyline reality).
  const big = 'S'.repeat(40000);
  errs = model.applyCmiWrites('1.2', cmi, { 'cmi.suspend_data': big });
  assert.deepEqual(errs, []);
  assert.equal(cmi.suspendData, big);
});

test('SYS-SCO-07: scaledScore derives 1.2 raw against min/max, guards max===min, and clamps', () => {
  const cmi = model.emptyCmi();
  model.applyCmiWrites('1.2', cmi, { 'cmi.core.score.raw': '92' });
  assert.equal(model.scaledScore(cmi), 0.92, 'spec defaults 0/100 apply');
  model.applyCmiWrites('1.2', cmi, { 'cmi.core.score.min': '50', 'cmi.core.score.max': '50' });
  assert.equal(model.scaledScore(cmi), null, 'degenerate max === min → no score');
  model.applyCmiWrites('1.2', cmi, { 'cmi.core.score.min': '0', 'cmi.core.score.max': '80' });
  assert.equal(model.scaledScore(cmi), 1, 'clamped to 1');
  assert.equal(model.scaledScore(model.emptyCmi()), null, 'no score reported → null');
});

test('SYS-SCO-07: interactions land verbatim, synthesize _count, and adl.nav.request is tolerated', () => {
  const cmi = model.emptyCmi();
  const errs = model.applyCmiWrites('2004', cmi, {
    'cmi.interactions.0.id': 'Q1',
    'cmi.interactions.0.learner_response': 'a',
    'cmi.interactions.7.id': 'Q8',
    'adl.nav.request': 'continue',
  });
  assert.deepEqual(errs, []);
  assert.equal(cmi.interactions['cmi.interactions.7.id'], 'Q8');
  assert.equal(cmi.extra['adl.nav.request'], 'continue');
  const flat = model.flattenCmi('2004', cmi, {
    studentId: 'u', studentName: 'U', masteryScore: null, launchData: '', mode: 'normal', credit: 'credit', entry: 'resume',
  });
  assert.equal(flat['cmi.interactions._count'], '8', 'count = highest index + 1');
  assert.equal(flat['cmi.interactions.0.learner_response'], 'a', 'evidence rides along in the seed');
  assert.equal(flat['cmi.entry'], 'resume');
});

// ── durations (SYS-SCO-07) ───────────────────────────────────────────────────────────────────────

test('SYS-SCO-07: session_time parses and total_time formats in both dialects', () => {
  assert.equal(duration.parseSessionTime('1.2', '0001:30:05.5'), 5405.5);
  assert.equal(duration.parseSessionTime('1.2', 'junk'), 0);
  assert.equal(duration.parseSessionTime('2004', 'PT1H30M5S'), 5405);
  assert.equal(duration.parseSessionTime('2004', 'P1DT2H'), 93600);
  assert.equal(duration.parseSessionTime('2004', 'nonsense'), 0);
  assert.equal(duration.formatTotalTime('1.2', 5405), '0001:30:05');
  assert.equal(duration.formatTotalTime('2004', 5405), 'PT1H30M5S');
  assert.equal(duration.formatTotalTime('2004', 0), 'PT0S');
});

// ── completion rules (SYS-SCO-11 / SR-177 / VT-203) ──────────────────────────────────────────────

test('SYS-SCO-11 / VT-203: the three completion rules gate on status, terminate and server-clocked time', () => {
  const cmi = model.emptyCmi();
  const attempt = { terminated: false, activeSec: 0 };
  assert.equal(model.completionSatisfied('status', attempt, cmi, 10), false);
  cmi.completion = 'completed';
  assert.equal(model.completionSatisfied('status', attempt, cmi, 10), true);
  cmi.success = 'failed';
  assert.equal(
    model.completionSatisfied('status', attempt, cmi, 10),
    true,
    'a definitive failed verdict is gradeable (grade records nothing and closes the attempt)',
  );
  assert.equal(
    model.completionSatisfied('status', attempt, { completion: 'incomplete', success: 'failed' }, 10),
    true,
    '2004 can fail without completing — still a definitive outcome',
  );
  assert.equal(
    model.completionSatisfied('status', attempt, { completion: 'incomplete', success: 'unknown' }, 10),
    false,
    'no verdict yet → not gradeable',
  );

  assert.equal(model.completionSatisfied('exit', attempt, cmi, 10), false);
  assert.equal(model.completionSatisfied('exit', { ...attempt, terminated: true }, cmi, 10), true, 'exit rule: a clean Terminate suffices whatever the status');

  assert.equal(model.completionSatisfied('time', { terminated: false, activeSec: 599 }, cmi, 10), false);
  assert.equal(model.completionSatisfied('time', { terminated: false, activeSec: 600 }, cmi, 10), true);
});

// ── bridge validators (SYS-SCO-06 / SR-178 / VT-205) ─────────────────────────────────────────────

test('SYS-SCO-06 / SR-178 / VT-205: isScormInbound and isCmiPatch reject malformed, oversized and prototype-polluting shapes', () => {
  const env = { bg: 'scorm', v: 1, nonce: 'n', attemptId: 'a', seq: 1 };
  assert.ok(protocol.isScormInbound({ ...env, type: 'ready', api: 'API' }));
  assert.ok(protocol.isScormInbound({ ...env, type: 'commit', values: { 'cmi.suspend_data': 'x' } }));
  assert.ok(!protocol.isScormInbound(null));
  assert.ok(!protocol.isScormInbound({ ...env, type: 'commit', values: { 'not-cmi-key': 'x' } }));
  assert.ok(!protocol.isScormInbound({ ...env, type: 'commit', values: { 'cmi.__proto__.polluted': 'x' } }));
  assert.ok(!protocol.isScormInbound({ ...env, type: 'commit', values: { 'cmi.a': 42 } }), 'non-string value');
  assert.ok(!protocol.isScormInbound({ ...env, v: 2, type: 'ready', api: 'API' }), 'wrong protocol version');
  assert.ok(!protocol.isScormInbound({ ...env, seq: -1, type: 'ready', api: 'API' }));
  assert.ok(!protocol.isScormInbound({ ...env, type: 'resize', height: 999999 }));
  const huge = {};
  for (let i = 0; i < 600; i++) huge[`cmi.extra_${i}`] = 'x';
  assert.ok(!protocol.isCmiPatch(huge), 'over CMI_MAX_KEYS');
  assert.ok(!protocol.isCmiPatch({ 'cmi.a': 'x'.repeat(protocol.CMI_MAX_VALUE_LEN + 1) }), 'over value cap');
});

// ── mirror drift (SYS-SCO-06) ─────────────────────────────────────────────────────────────────────

test('SYS-SCO-06: the frontend protocol mirror carries the same caps, version and sandbox flags', () => {
  const twin = readFileSync(join(backendRoot, '..', 'frontend', 'src', 'scorm', 'protocol.ts'), 'utf-8');
  for (const [name, value] of [
    ['SCORM_BRIDGE_V', protocol.SCORM_BRIDGE_V],
    ['CMI_MAX_KEYS', protocol.CMI_MAX_KEYS],
    ['CMI_MAX_KEY_LEN', protocol.CMI_MAX_KEY_LEN],
    ['CMI_MAX_VALUE_LEN', protocol.CMI_MAX_VALUE_LEN],
    ['CMI_MAX_PAYLOAD_BYTES', protocol.CMI_MAX_PAYLOAD_BYTES],
  ]) {
    const re = new RegExp(`${name}\\s*=\\s*([0-9_]+)`);
    const m = re.exec(twin);
    assert.ok(m, `frontend mirror declares ${name}`);
    assert.equal(Number(m[1].replace(/_/g, '')), value, `${name} matches the backend`);
  }
  assert.ok(twin.includes(protocol.SCORM_SANDBOX), 'frontend mirror carries the identical sandbox flag string');
});
