import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { ScormAttemptFile, ScormPackageRef, Training, TrainingSession, UpdateAck, User } from '../types';
import { readStore, readSettings, writeStore } from '../services/fileStore';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { gradeAnswers, isAnswerCorrect } from '../services/questions';
import { verifyCompletionSignature } from '../services/signature';
import { auditEvent } from '../services/audit';
import { attemptCompletionSatisfied, closeAttempt, commitAttempt, loadAttempt } from '../services/scorm/attempts';
import { getPackage } from '../services/scorm/packages';
import { scaledScore } from '../scorm/model';
import { formatTimespan12 } from '../scorm/duration';

const router = Router();

router.use(authenticate);

// POST /api/sessions/confirm-materials — the learner confirms, before the test starts, having
// reviewed all provided material. The confirmation exists ONLY as an audit entry: for a training
// without test questions it is the evidence (together with the persisted session from the empty
// grading that follows) that the learner actually did the training.
// With an `updateId` in the body, the confirmation additionally PERSISTS an UpdateAck: it is then
// the evidence that a confirm-mode training update was reviewed, and clears that pending update.
// Only confirm-mode updates are ackable — a retake obligation is cleared by a new passing session.
router.post('/confirm-materials', async (req: AuthRequest, res) => {
  const { trainingId, updateId } = req.body ?? {};
  if (typeof trainingId !== 'string') {
    return res.status(400).json({ error: 'trainingId is required' });
  }
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === trainingId);
  if (!training) return res.status(404).json({ error: 'Training not found' });
  const materials = Array.isArray(training.materials) ? training.materials.length : 0;
  await auditEvent(
    req.user ?? null,
    'materials-confirmed',
    { type: 'training', id: training.id, name: training.name.en ?? Object.values(training.name)[0] ?? '' },
    { details: `confirmed ${materials} material(s)` },
  );

  if (updateId !== undefined) {
    if (typeof updateId !== 'string') return res.status(400).json({ error: 'updateId must be a string' });
    // A SCORM-backed training's update means new course content — clearing that obligation with a
    // button click would create a false compliance record. Publish already refuses confirm-mode for
    // SCORM trainings; this guards records that predate the package.
    if (training.scormPackageId) {
      return res.status(400).json({ error: 'A SCORM course update requires a full retake, not a confirmation' });
    }
    const update = (training.updates ?? []).find((u) => u.id === updateId);
    if (!update) return res.status(404).json({ error: 'Update not found' });
    if (update.mode !== 'confirm') {
      return res.status(400).json({ error: 'This update requires a full retake, not a confirmation' });
    }
    const acks = await readStore<UpdateAck>('updateAcks');
    // Idempotent: confirming the same update twice is fine and records nothing new.
    if (!acks.some((a) => a.userId === req.user!.id && a.updateId === updateId)) {
      acks.push({
        id: randomUUID(),
        userId: req.user!.id,
        trainingId: training.id,
        updateId,
        confirmedAt: new Date().toISOString(),
      });
      await writeStore('updateAcks', acks);
      await auditEvent(
        req.user ?? null,
        'training-update-confirmed',
        { type: 'training', id: training.id, name: training.name.en ?? Object.values(training.name)[0] ?? '' },
        { details: `update v${update.version}` },
      );
    }
  }

  return res.status(204).end();
});

// POST /api/sessions/grade  — grade an attempt server-side; persist ONLY if passed.
// Two shapes, one signature policy:
//   classic { trainingId, answers[], reauth }        — the built-in quiz, graded here;
//   SCORM   { trainingId, scormAttemptId, reauth }   — the course already reported its result into
//     the SERVER-held attempt; the client names the attempt and nothing else. No score, status or
//     "passed" flag is ever read from the request body.
// Every submission requires a completion signature (SR-173): the body carries `reauth` — the
// ACTING user's password, or a fresh Microsoft ID token for SSO-linked accounts. The verified
// method is recorded with the completion in the audit trail.
router.post('/grade', async (req: AuthRequest, res) => {
  const { trainingId, answers, scormAttemptId, reauth } = req.body ?? {};
  if (typeof trainingId !== 'string' || (!Array.isArray(answers) && typeof scormAttemptId !== 'string')) {
    return res.status(400).json({ error: 'trainingId and answers[] (or scormAttemptId) are required' });
  }
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === trainingId);
  if (!training) return res.status(404).json({ error: 'Training not found' });
  const trainingName = training.name.en ?? Object.values(training.name)[0] ?? '';

  // An unpublished training (version 0) has no content to complete — without this guard, the
  // zero-questions auto-pass below (scorePct = 1) would let a learner "complete" it via the API
  // even though the UI never offers it. Legacy records without a version read as published v1.
  const version = typeof training.version === 'number' ? training.version : 1;
  if (version < 1) {
    return res.status(409).json({ error: 'This training has no published version yet' });
  }

  // A SCORM-backed training has questions: [] — without this guard the zero-questions auto-pass
  // below would let a learner "complete" the training via the API without ever launching the
  // course. Quiz answers and SCORM trainings are mutually exclusive, in both directions.
  const isScorm = Boolean(training.scormPackageId);
  if (isScorm && Array.isArray(answers)) {
    return res.status(409).json({ error: 'This training is completed through its SCORM course' });
  }
  if (!isScorm && typeof scormAttemptId === 'string') {
    return res.status(400).json({ error: 'This training is completed through its quiz' });
  }

  // SCORM: validate the named attempt BEFORE asking for the signature, so a learner is never
  // prompted to re-authenticate for an attempt that cannot be recorded anyway.
  let scormFile: ScormAttemptFile | null = null;
  let scormPkg: ScormPackageRef | null = null;
  if (isScorm) {
    scormFile = await loadAttempt(scormAttemptId as string);
    if (!scormFile || scormFile.attempt.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Attempt not found' }); // 404, not 403 — no existence oracle
    }
    if (scormFile.attempt.trainingId !== trainingId) {
      return res.status(400).json({ error: 'This attempt belongs to a different training' });
    }
    if (scormFile.attempt.preview) {
      return res.status(409).json({ error: 'A preview run cannot be recorded as a completion' });
    }
    if (scormFile.attempt.consumedBySessionId) {
      return res.status(409).json({ error: 'This attempt has already been recorded' }); // replay guard
    }
    if (scormFile.attempt.packageId !== training.scormPackageId) {
      return res.status(409).json({ error: 'The course content has changed — please run the new version' });
    }
    scormPkg = await getPackage(training.scormPackageId!);
    if (!scormPkg) return res.status(409).json({ error: 'The SCORM course content is missing' });
    // Force any straggler bridge state to disk, then judge from the FILE — never the index.
    await commitAttempt(scormFile.attempt.id, {});
    scormFile = (await loadAttempt(scormFile.attempt.id))!;
    if (!attemptCompletionSatisfied(scormFile, scormPkg, training.durationMinutes)) {
      return res.status(409).json({ error: 'The course has not reported completion yet' });
    }
  }

  // Completion signature — verified against the ACTING account, so an impersonating admin cannot
  // complete a training for someone else (they would need the target's own credentials).
  const settings = await readSettings();
  const users = await readStore<User>('users');
  const actingUser = users.find((u) => u.id === req.user!.id);
  if (!actingUser) return res.status(404).json({ error: 'User not found' });
  let signature;
  try {
    signature = await verifyCompletionSignature(actingUser, reauth, settings);
  } catch (err) {
    console.error('Completion signature verification error:', err);
    return res.status(500).json({ error: 'Identity confirmation failed — please try again' });
  }
  if (!signature.ok) {
    // The precise reason goes to the audit trail only; the client gets a generic message.
    // 403, not 401: the SESSION is still valid — only the step-up confirmation failed. (The
    // frontend treats any 401 as an expired session and bounces to the login page.)
    await auditEvent(
      req.user ?? null,
      'login-failed',
      { type: 'auth', id: actingUser.id, name: actingUser.email },
      { details: `completion signature rejected (${signature.reason}) — training "${trainingName}"` },
    );
    return res.status(403).json({ error: 'Identity confirmation failed — please check your credentials' });
  }

  const { passThreshold, revealWrongQuestions } = settings;

  // ── SCORM: the score comes from the SERVER-held attempt, never from the request ────────────────
  if (isScorm && scormFile && scormPkg) {
    // The SCO's own success verdict is a VETO, the org's passThreshold is the FLOOR, and the
    // manifest's masteryScore is NOT re-applied — the SCO already used it to produce its verdict,
    // and applying it a second time would put two truths in the audit trail. All three numbers are
    // recorded below so a reviewer can reconstruct the decision.
    const scaled = scaledScore(scormFile.cmi);
    const scorePct = scaled ?? 1; // completion-only course (no score) → 1, mirroring `total === 0 ? 1`
    const vetoed = scormFile.cmi.success === 'failed';
    const passed = !vetoed && scorePct >= passThreshold;

    if (passed) {
      const sessions = await readStore<TrainingSession>('sessions');
      const session: TrainingSession = {
        id: randomUUID(),
        userId: req.user!.id,
        trainingId,
        completedAt: new Date().toISOString(),
        scorePct,
        scormAttemptId: scormFile.attempt.id,
      };
      sessions.push(session);
      await writeStore('sessions', sessions);
      await closeAttempt(scormFile.attempt.id, { status: 'completed', sessionId: session.id });
      await auditEvent(
        req.user ?? null,
        'training-completed',
        { type: 'training', id: trainingId, name: trainingName },
        {
          details:
            `score ${Math.round(scorePct * 100)}% · scorm ${scormPkg.version} · success=${scormFile.cmi.success}` +
            ` · mastery=${scormPkg.masteryScore ?? '–'} · threshold=${Math.round(passThreshold * 100)}%` +
            ` · rule=${scormPkg.completionRule} · time ${formatTimespan12(scormFile.cmi.totalTimeSec)}` +
            ` · attempt ${scormFile.attempt.id} · signed: ${signature.method}`,
        },
      );
    } else {
      // No session, attempt closed as failed so a relaunch starts ab-initio — a failed run's
      // suspend_data would resume the learner onto its results screen. Nothing further is audited,
      // consistent with the quiz path (failed attempts are not recorded).
      await closeAttempt(scormFile.attempt.id, { status: 'failed' });
    }
    return res.json({
      scorePct,
      passed,
      passThreshold,
      success: scormFile.cmi.success,
      completion: scormFile.cmi.completion,
    });
  }

  // ── Classic quiz ─────────────────────────────────────────────────────────────────────────────────
  // answers[i] is the learner's selected option index/indices for question i. A question with several
  // correct answers counts only when the selection matches the key exactly — no partial credit.
  const total = training.questions.length;
  const correct = gradeAnswers(training.questions, answers);
  const scorePct = total === 0 ? 1 : correct / total;

  const passed = scorePct >= passThreshold;

  // Failed attempts are NOT recorded — the training simply stays due.
  if (passed) {
    const sessions = await readStore<TrainingSession>('sessions');
    const session: TrainingSession = {
      id: randomUUID(),
      userId: req.user!.id,
      trainingId,
      completedAt: new Date().toISOString(),
      scorePct,
    };
    sessions.push(session);
    await writeStore('sessions', sessions);
    await auditEvent(
      req.user ?? null,
      'training-completed',
      { type: 'training', id: trainingId, name: trainingName },
      { details: `score ${Math.round(scorePct * 100)}% · signed: ${signature.method}` },
    );
  }

  const result: Record<string, unknown> = { scorePct, passed, passThreshold, correct, total };
  // Opt-in (default off): a FAILED attempt names the questions that were answered wrong — indices
  // only, never the correct answers. A passed attempt never carries it, even when imperfect.
  if (!passed && revealWrongQuestions) {
    result.wrongIndices = training.questions
      .map((q, i) => (isAnswerCorrect(q, answers[i]) ? -1 : i))
      .filter((i) => i >= 0);
  }
  return res.json(result);
});

// GET /api/sessions/mine  — current user's passing sessions
router.get('/mine', async (req: AuthRequest, res) => {
  const sessions = await readStore<TrainingSession>('sessions');
  res.json(sessions.filter((s) => s.userId === req.user?.id));
});

export default router;
