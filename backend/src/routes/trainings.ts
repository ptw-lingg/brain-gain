import { Router } from 'express';
import { randomUUID } from 'crypto';
import type {
  DueTraining,
  JobRole,
  MaterialLink,
  PublicTraining,
  Question,
  Training,
  TraineeGroup,
  TrainingSession,
  User,
} from '../types';
import { readStore, writeStore } from '../services/fileStore';
import {
  authenticate,
  requireAdmin,
  requireAdminOrOwner,
  requireTrainerOrAdmin,
  type AuthRequest,
} from '../middleware/auth';
import { computeDue, sessionsFor } from '../services/due';
import { requiredTrainingIds } from '../services/training';
import { toSafeUser } from './auth';

const router = Router();

router.use(authenticate);

/** Strip correctIndex so learners never receive the answer key. */
function toPublic(t: Training): PublicTraining {
  return {
    ...t,
    questions: t.questions.map(({ correctIndex, ...rest }) => {
      void correctIndex;
      return rest;
    }),
  };
}

function sanitizeQuestions(input: unknown): Question[] {
  if (!Array.isArray(input)) return [];
  return input.map((q): Question => {
    const obj = (q ?? {}) as Record<string, unknown>;
    const options = Array.isArray(obj.options) ? obj.options.map(String) : [];
    const correctIndex = Number(obj.correctIndex);
    return {
      id: typeof obj.id === 'string' && obj.id ? obj.id : randomUUID(),
      text: typeof obj.text === 'string' ? obj.text : '',
      options,
      correctIndex: Number.isInteger(correctIndex) ? correctIndex : 0,
    };
  });
}

function sanitizeLinks(input: unknown): MaterialLink[] {
  if (!Array.isArray(input)) return [];
  return input.map((l): MaterialLink => {
    const obj = (l ?? {}) as Record<string, unknown>;
    return {
      label: typeof obj.label === 'string' ? obj.label : '',
      url: typeof obj.url === 'string' ? obj.url : '',
    };
  });
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Read all trainings sorted by their explicit `order`. Legacy records written
 * before ordering existed get backfilled (by current file position) and persisted,
 * so the order field becomes the single source of truth from then on.
 */
async function readOrderedTrainings(): Promise<Training[]> {
  const trainings = await readStore<Training>('trainings');
  let changed = false;
  trainings.forEach((t, i) => {
    if (typeof t.order !== 'number' || !Number.isFinite(t.order)) {
      t.order = i;
      changed = true;
    }
  });
  if (changed) await writeStore('trainings', trainings);
  return [...trainings].sort((a, b) => a.order - b.order);
}

// GET /api/trainings  (admin: all; trainer with ?mine=1: only owned)
router.get('/', async (req: AuthRequest, res) => {
  const trainings = await readOrderedTrainings();
  const mine = req.query.mine === '1' || req.query.mine === 'true';
  const canSeeAnswers = (t: Training) => req.user?.isAdmin || t.ownerId === req.user?.id;
  let result = trainings;
  if (mine && !req.user?.isAdmin) {
    result = trainings.filter((t) => t.ownerId === req.user?.id);
  }
  // Owners/admins get full questions; everyone else gets the public (no-answer) shape.
  res.json(result.map((t) => (canSeeAnswers(t) ? t : toPublic(t))));
});

// GET /api/trainings/mine  — current user's required trainings + due status
router.get('/mine', async (req: AuthRequest, res) => {
  const [trainings, sessions] = await Promise.all([
    readOrderedTrainings(),
    readStore<TrainingSession>('sessions'),
  ]);
  const required = await requiredTrainingIds(req.user!.id);
  const result: DueTraining[] = trainings
    .filter((t) => required.has(t.id))
    .map((t) => {
      const due = computeDue(t, sessionsFor(sessions, req.user!.id, t.id));
      return { training: toPublic(t), ...due };
    });
  res.json(result);
});

// GET /api/trainings/trainees  — who must do my (or all) trainings, grouped
router.get('/trainees', requireTrainerOrAdmin, async (req: AuthRequest, res) => {
  const [trainings, roles, users, sessions] = await Promise.all([
    readOrderedTrainings(),
    readStore<JobRole>('roles'),
    readStore<User>('users'),
    readStore<TrainingSession>('sessions'),
  ]);

  const owned = req.user?.isAdmin
    ? trainings
    : trainings.filter((t) => t.ownerId === req.user?.id);

  const groups: TraineeGroup[] = owned.map((training) => {
    // Roles that demand this training → users holding any of those roles.
    const demandingRoleIds = roles
      .filter((r) => r.trainingIds.includes(training.id))
      .map((r) => r.id);
    const trainees = users
      .filter((u) => u.roleIds.some((rid) => demandingRoleIds.includes(rid)))
      .map((u) => {
        const due = computeDue(training, sessionsFor(sessions, u.id, training.id));
        return { user: toSafeUser(u), status: due.status, dueDate: due.dueDate };
      });
    return { training, trainees };
  });

  res.json(groups);
});

// GET /api/trainings/:id  — single training, answer key stripped for non-owners
router.get('/:id', async (req: AuthRequest, res) => {
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === req.params.id);
  if (!training) return res.status(404).json({ error: 'Not found' });
  const canSeeAnswers = req.user?.isAdmin || training.ownerId === req.user?.id;
  return res.json(canSeeAnswers ? training : toPublic(training));
});

// POST /api/trainings  — admin or trainer
router.post('/', requireTrainerOrAdmin, async (req: AuthRequest, res) => {
  const b = req.body ?? {};
  if (typeof b.name !== 'string' || !b.name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  // Trainers always own what they create; admins may target any owner.
  const ownerId = req.user?.isAdmin && typeof b.ownerId === 'string' ? b.ownerId : req.user!.id;
  const trainings = await readStore<Training>('trainings');
  // New trainings go to the end of the ordering.
  const maxOrder = trainings.reduce(
    (max, t) => (typeof t.order === 'number' && t.order > max ? t.order : max),
    -1,
  );
  const training: Training = {
    id: randomUUID(),
    name: b.name,
    description: typeof b.description === 'string' ? b.description : '',
    durationHours: Number(b.durationHours) || 0,
    category: typeof b.category === 'string' ? b.category : 'General',
    ownerId,
    cycleYears: clamp(b.cycleYears, 1, 5, 1),
    windowBeforeMonths: clamp(b.windowBeforeMonths, 0, 3, 3),
    windowAfterMonths: clamp(b.windowAfterMonths, 0, 3, 3),
    order: maxOrder + 1,
    materialLinks: sanitizeLinks(b.materialLinks),
    questions: sanitizeQuestions(b.questions),
    createdAt: new Date().toISOString(),
  };
  trainings.push(training);
  await writeStore('trainings', trainings);
  return res.status(201).json(training);
});

// PUT /api/trainings/reorder  — admin sets the global display order
// Must be registered before '/:id' so "reorder" isn't captured as an id.
router.put('/reorder', requireAdmin, async (req: AuthRequest, res) => {
  const raw = (req.body ?? {}).ids;
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : null;
  if (!ids) return res.status(400).json({ error: 'ids must be an array of training ids' });
  const trainings = await readStore<Training>('trainings');
  const position = new Map(ids.map((id, i) => [id, i]));
  // Any training not listed (e.g. created concurrently) is appended, keeping its relative order.
  let tail = ids.length;
  const reordered = trainings.map((t) => ({
    ...t,
    order: position.has(t.id) ? (position.get(t.id) as number) : tail++,
  }));
  await writeStore('trainings', reordered);
  return res.json([...reordered].sort((a, b) => a.order - b.order));
});

// PUT /api/trainings/:id  — admin or owning trainer
router.put('/:id', requireAdminOrOwner, async (req: AuthRequest, res) => {
  const b = req.body ?? {};
  const trainings = await readStore<Training>('trainings');
  const idx = trainings.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const current = trainings[idx];
  // Only admins may reassign ownership.
  const ownerId =
    req.user?.isAdmin && typeof b.ownerId === 'string' ? b.ownerId : current.ownerId;
  trainings[idx] = {
    ...current,
    name: typeof b.name === 'string' ? b.name : current.name,
    description: typeof b.description === 'string' ? b.description : current.description,
    durationHours: b.durationHours != null ? Number(b.durationHours) || 0 : current.durationHours,
    category: typeof b.category === 'string' ? b.category : current.category,
    ownerId,
    order: typeof current.order === 'number' ? current.order : idx, // managed only via reorder
    cycleYears: b.cycleYears != null ? clamp(b.cycleYears, 1, 5, current.cycleYears) : current.cycleYears,
    windowBeforeMonths:
      b.windowBeforeMonths != null
        ? clamp(b.windowBeforeMonths, 0, 3, current.windowBeforeMonths)
        : current.windowBeforeMonths,
    windowAfterMonths:
      b.windowAfterMonths != null
        ? clamp(b.windowAfterMonths, 0, 3, current.windowAfterMonths)
        : current.windowAfterMonths,
    materialLinks: b.materialLinks != null ? sanitizeLinks(b.materialLinks) : current.materialLinks,
    questions: b.questions != null ? sanitizeQuestions(b.questions) : current.questions,
  };
  await writeStore('trainings', trainings);
  return res.json(trainings[idx]);
});

// DELETE /api/trainings/:id  — admin or owning trainer
router.delete('/:id', requireAdminOrOwner, async (req, res) => {
  const trainings = await readStore<Training>('trainings');
  const next = trainings.filter((t) => t.id !== req.params.id);
  if (next.length === trainings.length) return res.status(404).json({ error: 'Not found' });
  await writeStore('trainings', next);
  return res.status(204).end();
});

export default router;
