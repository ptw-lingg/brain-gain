import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Training, TrainingSession } from '../types';
import { readStore, readSettings, writeStore } from '../services/fileStore';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { gradeAnswers, isAnswerCorrect } from '../services/questions';
import { auditEvent } from '../services/audit';

const router = Router();

router.use(authenticate);

// POST /api/sessions/confirm-materials — the learner confirms, before the test starts, having
// reviewed all provided material. The confirmation exists ONLY as an audit entry: for a training
// without test questions it is the evidence (together with the persisted session from the empty
// grading that follows) that the learner actually did the training.
router.post('/confirm-materials', async (req: AuthRequest, res) => {
  const { trainingId } = req.body ?? {};
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
  return res.status(204).end();
});

// POST /api/sessions/grade  — grade an attempt server-side; persist ONLY if passed.
router.post('/grade', async (req: AuthRequest, res) => {
  const { trainingId, answers } = req.body ?? {};
  if (typeof trainingId !== 'string' || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'trainingId and answers[] are required' });
  }
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === trainingId);
  if (!training) return res.status(404).json({ error: 'Training not found' });

  // answers[i] is the learner's selected option index/indices for question i. A question with several
  // correct answers counts only when the selection matches the key exactly — no partial credit.
  const total = training.questions.length;
  const correct = gradeAnswers(training.questions, answers);
  const scorePct = total === 0 ? 1 : correct / total;

  const { passThreshold, revealWrongQuestions } = await readSettings();
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
      { type: 'training', id: trainingId, name: training.name.en ?? Object.values(training.name)[0] ?? '' },
      { details: `score ${Math.round(scorePct * 100)}%` },
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
