import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Training, TrainingSession } from '../types';
import { readStore, readSettings, writeStore } from '../services/fileStore';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { gradeAnswers } from '../services/questions';

const router = Router();

router.use(authenticate);

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

  const { passThreshold } = await readSettings();
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
  }

  return res.json({ scorePct, passed, passThreshold, correct, total });
});

// GET /api/sessions/mine  — current user's passing sessions
router.get('/mine', async (req: AuthRequest, res) => {
  const sessions = await readStore<TrainingSession>('sessions');
  res.json(sessions.filter((s) => s.userId === req.user?.id));
});

export default router;
