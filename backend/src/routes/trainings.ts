import { Router, raw } from 'express';
import { randomUUID } from 'crypto';
import type {
  DueTraining,
  JobRole,
  MaterialFile,
  PublicTraining,
  Question,
  Training,
  TraineeGroup,
  TrainingSession,
  User,
} from '../types';
import {
  deleteMaterial,
  readMaterial,
  readSettings,
  readStore,
  saveMaterial,
  writeStore,
} from '../services/fileStore';
import { materialFileIds, sanitizeMaterials } from '../services/materials';
import { MATERIAL_LOCALES } from '../services/locales';
import {
  authenticate,
  requireAdmin,
  requireAdminOrOwner,
  requireTrainerOrAdmin,
  type AuthRequest,
} from '../middleware/auth';
import { computeDue, sessionsFor } from '../services/due';
import { normalizeCorrectIndices, questionType, sanitizeLocalizedText } from '../services/questions';
import { requiredTrainingIds } from '../services/training';
import { auditEvent, diffEntities } from '../services/audit';
import { toSafeUser } from './auth';
import { sanitizeFileName, sendAttachment, UUID_RE } from './http';

const router = Router();

// Human-readable audit label for a training: English name, else the first filled language.
const trainingLabel = (t: Training): string => t.name.en ?? Object.values(t.name)[0] ?? '';

router.use(authenticate);

/**
 * Strip the answer key so learners never receive it — for a multiple-choice question not even the
 * count. The question type is emitted (computed, so legacy records without one read as 'multiple');
 * the learner UI needs it to render radio buttons vs checkboxes, and a single-choice question
 * disclosing "exactly one correct answer" is the point of the type, not a leak.
 */
function toPublic(t: Training): PublicTraining {
  return {
    ...t,
    questions: t.questions.map((q) => {
      const { correctIndices, ...rest } = q;
      void correctIndices;
      return { ...rest, type: questionType(q) };
    }),
  };
}

function sanitizeQuestions(input: unknown, allowedLocales: readonly string[]): Question[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((q): Question | null => {
      const obj = (q ?? {}) as Record<string, unknown>;
      const text = sanitizeLocalizedText(obj.text, allowedLocales);
      // A question must keep at least one language of text — the material ≥1 rule.
      if (Object.keys(text).length === 0) return null;
      // Options empty in every language are dropped, with the answer key remapped to the surviving
      // indices (the same reindexing the editor does when an option row is removed).
      const rawOptions = Array.isArray(obj.options)
        ? obj.options.map((o) => sanitizeLocalizedText(o, allowedLocales))
        : [];
      const keptIndex = new Map<number, number>();
      const options = rawOptions.filter((o, i) => {
        if (Object.keys(o).length === 0) return false;
        keptIndex.set(i, keptIndex.size);
        return true;
      });
      const rawKey = Array.isArray(obj.correctIndices) ? obj.correctIndices : [obj.correctIndex];
      const remappedKey = rawKey
        .map((v) => keptIndex.get(Number(v)))
        .filter((v): v is number => v !== undefined);
      const correctIndices = normalizeCorrectIndices(remappedKey, options.length);
      return {
        id: typeof obj.id === 'string' && obj.id ? obj.id : randomUUID(),
        text,
        options,
        correctIndices,
        // 'single' requires exactly one correct answer; anything else (including absent — legacy
        // clients) is coerced to 'multiple' rather than rejected, like the rest of this normalizer.
        type: obj.type === 'single' && correctIndices.length === 1 ? 'single' : 'multiple',
      };
    })
    .filter((q): q is Question => q !== null);
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
    // Guard only — the real conversion of legacy materialLinks/materialFiles happens in the boot
    // migration (services/materials.ts); this keeps the field an array no matter what.
    if (!Array.isArray(t.materials)) {
      t.materials = [];
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

// POST /api/trainings/materials  — upload one learning-material file of any type (trainer/admin).
// The raw bytes are the request body (content-type application/octet-stream); the original filename
// and MIME type ride along as query params. Returns the descriptor the editor stores on the training.
// Registered before '/:id' so the literal path is never mistaken for a training id.
router.post(
  '/materials',
  requireTrainerOrAdmin,
  raw({ type: '*/*', limit: '100mb' }),
  async (req: AuthRequest, res) => {
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      return res.status(400).json({ error: 'empty upload' });
    }
    const id = randomUUID();
    const name = sanitizeFileName(req.query.name);
    const type = typeof req.query.type === 'string' ? req.query.type.slice(0, 255) : '';
    await saveMaterial(id, bytes, { name, size: bytes.length, type });
    const file: MaterialFile = { id, name, size: bytes.length, type };
    await auditEvent(req.user ?? null, 'create', { type: 'material', id, name });
    return res.status(201).json(file);
  },
);

// GET /api/trainings/materials/:fileId  — stream a stored file to any authenticated user (learners
// download material to study). No preview: the file is sent as an attachment to open in installed apps.
router.get('/materials/:fileId', async (req: AuthRequest, res) => {
  const { fileId } = req.params;
  if (!UUID_RE.test(fileId)) return res.status(400).json({ error: 'bad file id' });
  const file = await readMaterial(fileId);
  if (!file) return res.status(404).json({ error: 'Not found' });
  return sendAttachment(res, file.bytes, file.meta.name, file.meta.type);
});

// GET /api/trainings/:id  — single training, answer key stripped for non-owners
router.get('/:id', async (req: AuthRequest, res) => {
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === req.params.id);
  if (!training) return res.status(404).json({ error: 'Not found' });
  if (!Array.isArray(training.materials)) training.materials = []; // backfill legacy records
  const canSeeAnswers = req.user?.isAdmin || training.ownerId === req.user?.id;
  return res.json(canSeeAnswers ? training : toPublic(training));
});

// POST /api/trainings  — admin or trainer
router.post('/', requireTrainerOrAdmin, async (req: AuthRequest, res) => {
  const b = req.body ?? {};
  // Name/description/category are localized like question texts (legacy plain strings become the
  // English entry). A training must be nameable in at least one language.
  const name = sanitizeLocalizedText(b.name, MATERIAL_LOCALES);
  if (Object.keys(name).length === 0) {
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
    name,
    description: sanitizeLocalizedText(b.description, MATERIAL_LOCALES),
    durationMinutes: Math.max(0, Math.round(Number(b.durationMinutes) || 0)),
    category: sanitizeLocalizedText(b.category, MATERIAL_LOCALES),
    ownerId,
    cycleYears: clamp(b.cycleYears, 1, 5, 1),
    windowBeforeMonths: clamp(b.windowBeforeMonths, 0, 3, 3),
    windowAfterMonths: clamp(b.windowAfterMonths, 0, 3, 3),
    order: maxOrder + 1,
    materials: sanitizeMaterials(b.materials, MATERIAL_LOCALES),
    questions: sanitizeQuestions(b.questions, MATERIAL_LOCALES),
    createdAt: new Date().toISOString(),
  };
  trainings.push(training);
  await writeStore('trainings', trainings);
  await auditEvent(req.user ?? null, 'create', { type: 'training', id: training.id, name: trainingLabel(training) });
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
  await auditEvent(req.user ?? null, 'update', { type: 'training' }, { details: `reordered ${ids.length} trainings` });
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
    // Localized fields: a field that arrives is sanitized (legacy plain strings become the English
    // entry), an absent one keeps its stored value — the same present-or-keep rule as below.
    name: b.name != null ? sanitizeLocalizedText(b.name, MATERIAL_LOCALES) : current.name,
    description:
      b.description != null ? sanitizeLocalizedText(b.description, MATERIAL_LOCALES) : current.description,
    durationMinutes:
      b.durationMinutes != null
        ? Math.max(0, Math.round(Number(b.durationMinutes) || 0))
        : current.durationMinutes,
    category: b.category != null ? sanitizeLocalizedText(b.category, MATERIAL_LOCALES) : current.category,
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
    materials: b.materials != null ? sanitizeMaterials(b.materials, MATERIAL_LOCALES) : current.materials ?? [],
    questions: b.questions != null ? sanitizeQuestions(b.questions, MATERIAL_LOCALES) : current.questions,
  };
  await writeStore('trainings', trainings);
  // A variant's file may have been removed or replaced: delete the bytes no longer referenced by
  // this training so replaced uploads don't accumulate on disk. Best-effort — a failure to unlink
  // never fails the save.
  const keptIds = new Set(materialFileIds(trainings[idx]));
  const droppedIds = materialFileIds(current).filter((id) => !keptIds.has(id));
  await Promise.allSettled(droppedIds.map((id) => deleteMaterial(id)));
  await auditEvent(
    req.user ?? null,
    'update',
    { type: 'training', id: trainings[idx].id, name: trainingLabel(trainings[idx]) },
    { changes: diffEntities(current, trainings[idx]) },
  );
  return res.json(trainings[idx]);
});

// DELETE /api/trainings/:id  — admin or owning trainer
router.delete('/:id', requireAdminOrOwner, async (req: AuthRequest, res) => {
  const trainings = await readStore<Training>('trainings');
  const removed = trainings.find((t) => t.id === req.params.id);
  if (!removed) return res.status(404).json({ error: 'Not found' });
  await writeStore('trainings', trainings.filter((t) => t.id !== req.params.id));
  // Best-effort cleanup of the deleted training's uploaded files so they don't linger on disk.
  await Promise.allSettled(materialFileIds(removed).map((id) => deleteMaterial(id)));
  await auditEvent(req.user ?? null, 'delete', { type: 'training', id: removed.id, name: trainingLabel(removed) });
  return res.status(204).end();
});

export default router;
