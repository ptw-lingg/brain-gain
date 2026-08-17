import { Router, raw } from 'express';
import { randomUUID } from 'crypto';
import type {
  DueTraining,
  JobRole,
  MaterialFile,
  OrgUnit,
  PublicTraining,
  Question,
  Training,
  TraineeGroup,
  TrainingSession,
  TrainingUpdate,
  UpdateAck,
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
import { acksFor, computeDue, sessionsFor } from '../services/due';
import { normalizeCorrectIndices, questionType, sanitizeLocalizedText } from '../services/questions';
import { requiredTrainingIds } from '../services/training';
import { affectedUsers, normalizeDeadline } from '../services/updates';
import { isSmtpConfigured, sendMail } from '../services/mail';
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
 * The work-in-progress `draft` is stripped too: learners see and use ONLY the published content —
 * the top-level materials/questions, which publish-update alone writes.
 */
function toPublic(t: Training): PublicTraining {
  const { draft, ...rest } = t;
  void draft;
  return {
    ...rest,
    questions: t.questions.map((q) => {
      const { correctIndices, ...stripped } = q;
      void correctIndices;
      return { ...stripped, type: questionType(q) };
    }),
  };
}

/** File ids referenced by a training's WIP draft ([] when none). */
const draftFileIds = (t: Training): string[] =>
  t.draft ? materialFileIds({ materials: t.draft.materials }) : [];

/** The training's published version; legacy records without the field read as published v1. */
const versionOf = (t: Training): number => (typeof t.version === 'number' ? t.version : 1);

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
  const [trainings, sessions, acks] = await Promise.all([
    readOrderedTrainings(),
    readStore<TrainingSession>('sessions'),
    readStore<UpdateAck>('updateAcks'),
  ]);
  const required = await requiredTrainingIds(req.user!.id);
  const result: DueTraining[] = trainings
    .filter((t) => required.has(t.id))
    .map((t) => {
      const due = computeDue(
        t,
        sessionsFor(sessions, req.user!.id, t.id),
        acksFor(acks, req.user!.id, t.id),
      );
      return { training: toPublic(t), ...due };
    });
  res.json(result);
});

// GET /api/trainings/trainees  — who must do my (or all) trainings, grouped
router.get('/trainees', requireTrainerOrAdmin, async (req: AuthRequest, res) => {
  const [trainings, roles, users, sessions, acks] = await Promise.all([
    readOrderedTrainings(),
    readStore<JobRole>('roles'),
    readStore<User>('users'),
    readStore<TrainingSession>('sessions'),
    readStore<UpdateAck>('updateAcks'),
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
        const due = computeDue(
          training,
          sessionsFor(sessions, u.id, training.id),
          acksFor(acks, u.id, training.id),
        );
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

// GET /api/trainings/:id/trainer — the owning trainer's contact card for any authenticated user.
// The session page shows it so a trainee with questions can reach the right person; name, org unit
// and email are exactly what identifies the trainer in the company address list (SR-163). Only these
// three fields leave the server — never the full user record.
router.get('/:id/trainer', async (req: AuthRequest, res) => {
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === req.params.id);
  if (!training) return res.status(404).json({ error: 'Not found' });
  const users = await readStore<User>('users');
  const owner = users.find((u) => u.id === training.ownerId);
  if (!owner) return res.status(404).json({ error: 'Trainer not found' }); // owner account was deleted
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  const orgUnitName = orgUnits.find((o) => o.id === owner.orgUnitId)?.name ?? '';
  return res.json({ name: owner.name, email: owner.email, orgUnitName });
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
  // A new training starts UNPUBLISHED (version 0): any initial content goes into the draft, and
  // learners see nothing until version 1 is explicitly published.
  const draftMaterials = sanitizeMaterials(b.materials, MATERIAL_LOCALES);
  const draftQuestions = sanitizeQuestions(b.questions, MATERIAL_LOCALES);
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
    materials: [],
    questions: [],
    version: 0,
    updates: [],
    ...(draftMaterials.length || draftQuestions.length
      ? { draft: { materials: draftMaterials, questions: draftQuestions, savedAt: new Date().toISOString() } }
      : {}),
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

// PUT /api/trainings/:id  — admin or owning trainer. Metadata is applied immediately; CONTENT
// (materials/questions) is STAGED: it lands in the draft when it differs from the published
// content and never touches the published fields — trainees keep seeing the last published
// version until the editor publishes (SR-170).
router.put('/:id', requireAdminOrOwner, async (req: AuthRequest, res) => {
  const b = req.body ?? {};
  const trainings = await readStore<Training>('trainings');
  const idx = trainings.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const current = trainings[idx];
  // Only admins may reassign ownership.
  const ownerId =
    req.user?.isAdmin && typeof b.ownerId === 'string' ? b.ownerId : current.ownerId;

  // Candidate content: present-or-keep against the WIP (the draft when one exists) — an absent
  // field keeps what the editor was working on, not the published copy.
  const candMaterials =
    b.materials != null
      ? sanitizeMaterials(b.materials, MATERIAL_LOCALES)
      : current.draft?.materials ?? current.materials ?? [];
  const candQuestions =
    b.questions != null
      ? sanitizeQuestions(b.questions, MATERIAL_LOCALES)
      : current.draft?.questions ?? current.questions;
  const publishedJson = JSON.stringify([current.materials ?? [], current.questions]);
  const candidateJson = JSON.stringify([candMaterials, candQuestions]);
  const oldDraftJson = current.draft
    ? JSON.stringify([current.draft.materials, current.draft.questions])
    : null;

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
    // `version` and `updates` are server-managed like `order`: never read from the body, they ride
    // along from `current` via the spread above and change only through publish-update / cancel.
    // The PUBLISHED content is server-managed too — written exclusively by publish-update:
    materials: current.materials ?? [],
    questions: current.questions,
    // Content equal to the published version needs no draft (deleted below — the spread would keep
    // it); an unchanged draft keeps its object (and savedAt), so a metadata-only save stays silent.
    ...(candidateJson === publishedJson
      ? {}
      : {
          draft:
            candidateJson === oldDraftJson
              ? current.draft
              : { materials: candMaterials, questions: candQuestions, savedAt: new Date().toISOString() },
        }),
  };
  if (candidateJson === publishedJson) delete trainings[idx].draft;
  await writeStore('trainings', trainings);
  // A draft's file may have been removed or replaced: delete bytes referenced by the OLD draft
  // that neither the new draft nor the published content still uses. Published bytes are never
  // deleted here — PUT cannot change the published content. Best-effort, as before.
  const keptIds = new Set([...materialFileIds(trainings[idx]), ...draftFileIds(trainings[idx])]);
  const droppedIds = draftFileIds(current).filter((id) => !keptIds.has(id));
  await Promise.allSettled(droppedIds.map((id) => deleteMaterial(id)));
  await auditEvent(
    req.user ?? null,
    'update',
    { type: 'training', id: trainings[idx].id, name: trainingLabel(trainings[idx]) },
    { changes: diffEntities(current, trainings[idx]) },
  );
  return res.json(trainings[idx]);
});

// POST /api/trainings/:id/publish-update  — admin or owning trainer. The explicit step that makes
// content live: promotes the draft (when one exists) into the published fields and bumps the
// version. kind 'notify' (the default) additionally records the obligation and emails the
// affected users; kind 'silent' publishes without notifying anyone (typo fixes, first versions).
// Email subject/text are composed by the client (i18n lives there — the same split as the
// TraineesPage reminders); an unconfigured or failing SMTP NEVER fails the publish.
router.post('/:id/publish-update', requireAdminOrOwner, async (req: AuthRequest, res) => {
  const b = req.body ?? {};
  const kind: 'notify' | 'silent' = b.kind == null ? 'notify' : b.kind;
  if (kind !== 'notify' && kind !== 'silent') {
    return res.status(400).json({ error: "kind must be 'notify' or 'silent'" });
  }
  let deadline = '';
  let emailSubject = '';
  let emailText = '';
  if (kind === 'notify') {
    if (b.mode !== 'retake' && b.mode !== 'confirm') {
      return res.status(400).json({ error: "mode must be 'retake' or 'confirm'" });
    }
    deadline = normalizeDeadline(b.deadline) ?? '';
    if (!deadline) {
      return res.status(400).json({ error: 'deadline must be a calendar day, today or later' });
    }
    emailSubject = typeof b.emailSubject === 'string' ? b.emailSubject.trim() : '';
    emailText = typeof b.emailText === 'string' ? b.emailText.trim() : '';
    if (!emailSubject || !emailText) {
      return res.status(400).json({ error: 'emailSubject and emailText are required' });
    }
  }

  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === req.params.id);
  if (!training) return res.status(404).json({ error: 'Not found' });

  const currentVersion = versionOf(training);
  // Nobody can have passed an unpublished training (grading is refused at version 0), so an
  // obligation would reach no one — and its update record would claim version 1, breaking the
  // invariant that update records are v2+. The first version is published silently.
  if (kind === 'notify' && currentVersion === 0) {
    return res.status(400).json({ error: 'not published yet — publish the first version silently' });
  }
  // A silent publish exists to make a draft live; without one there is nothing it could do.
  if (kind === 'silent' && !training.draft) {
    return res.status(400).json({ error: 'nothing to publish — no draft' });
  }

  // Promote the draft: it becomes the published content; bytes only the old published version
  // referenced are deleted after the store write. (A notify publish WITHOUT a draft is allowed —
  // it re-announces the current content.)
  const oldPublishedIds = materialFileIds(training);
  if (training.draft) {
    training.materials = training.draft.materials;
    training.questions = training.draft.questions;
    delete training.draft;
  }
  const version = currentVersion + 1;
  training.version = version;

  let update: TrainingUpdate | null = null;
  if (kind === 'notify') {
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 2000) : undefined;
    update = {
      id: randomUUID(),
      publishedAt: new Date().toISOString(),
      deadline,
      mode: b.mode,
      ...(note ? { note } : {}),
      publishedBy: req.user!.id,
      version,
    };
    training.updates = [...(training.updates ?? []), update];
  }
  await writeStore('trainings', trainings);
  const newPublishedIds = new Set(materialFileIds(training));
  await Promise.allSettled(
    oldPublishedIds.filter((id) => !newPublishedIds.has(id)).map((id) => deleteMaterial(id)),
  );

  if (kind === 'silent') {
    await auditEvent(
      req.user ?? null,
      'training-update-published',
      { type: 'training', id: training.id, name: trainingLabel(training) },
      { details: `version=${version} kind=silent` },
    );
    return res.status(201).json({ version });
  }

  // Affected = assigned via roles AND passed before this publish; disabled accounts can't sign in,
  // so they are not emailed (their obligation surfaces on reactivation through the due list).
  const [users, roles, sessions, settings] = await Promise.all([
    readStore<User>('users'),
    readStore<JobRole>('roles'),
    readStore<TrainingSession>('sessions'),
    readSettings(),
  ]);
  const affected = affectedUsers(training, users, roles, sessions);
  const recipients = affected.filter((u) => !u.isDisabled).map((u) => u.email);

  let email: { sent: number } | { skipped: 'not-configured' | 'no-recipients' } | { failed: true };
  if (!isSmtpConfigured(settings)) {
    email = { skipped: 'not-configured' };
  } else if (recipients.length === 0) {
    email = { skipped: 'no-recipients' };
  } else {
    try {
      await sendMail(settings, { to: recipients, subject: emailSubject, text: emailText });
      email = { sent: recipients.length };
    } catch {
      email = { failed: true };
    }
  }

  await auditEvent(
    req.user ?? null,
    'training-update-published',
    { type: 'training', id: training.id, name: trainingLabel(training) },
    {
      details:
        `version=${version} kind=notify mode=${update!.mode} deadline=${deadline.slice(0, 10)} ` +
        `affected=${affected.length} notified=${'sent' in email ? email.sent : 0}`,
    },
  );

  return res.status(201).json({ update, version, affected: affected.length, email });
});

// DELETE /api/trainings/:id/draft  — admin or owning trainer discards the work-in-progress
// content: the training reverts to its published state. Bytes only the draft referenced are
// deleted; the fact (not the content) of the discard is audited.
router.delete('/:id/draft', requireAdminOrOwner, async (req: AuthRequest, res) => {
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === req.params.id);
  if (!training) return res.status(404).json({ error: 'Not found' });
  if (!training.draft) return res.status(404).json({ error: 'No draft to discard' });
  const savedAt = training.draft.savedAt;
  const droppedCandidates = draftFileIds(training);
  delete training.draft;
  await writeStore('trainings', trainings);
  const publishedIds = new Set(materialFileIds(training));
  await Promise.allSettled(
    droppedCandidates.filter((id) => !publishedIds.has(id)).map((id) => deleteMaterial(id)),
  );
  await auditEvent(
    req.user ?? null,
    'training-draft-discarded',
    { type: 'training', id: training.id, name: trainingLabel(training) },
    { details: `discarded draft from ${savedAt}` },
  );
  return res.status(204).end();
});

// DELETE /api/trainings/:id/updates/:updateId  — admin or owning trainer withdraws a published
// update: the pending obligation disappears for everyone (its acks are pruned), but the training
// version deliberately stays — version numbers are never reused.
router.delete('/:id/updates/:updateId', requireAdminOrOwner, async (req: AuthRequest, res) => {
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === req.params.id);
  if (!training) return res.status(404).json({ error: 'Not found' });
  const update = (training.updates ?? []).find((u) => u.id === req.params.updateId);
  if (!update) return res.status(404).json({ error: 'Not found' });
  training.updates = (training.updates ?? []).filter((u) => u.id !== update.id);
  await writeStore('trainings', trainings);
  const acks = await readStore<UpdateAck>('updateAcks');
  const kept = acks.filter((a) => a.updateId !== update.id);
  if (kept.length !== acks.length) await writeStore('updateAcks', kept);
  await auditEvent(
    req.user ?? null,
    'training-update-cancelled',
    { type: 'training', id: training.id, name: trainingLabel(training) },
    { details: `v${update.version} (${update.mode}), deadline ${update.deadline.slice(0, 10)}` },
  );
  return res.status(204).end();
});

// DELETE /api/trainings/:id  — admin or owning trainer
router.delete('/:id', requireAdminOrOwner, async (req: AuthRequest, res) => {
  const trainings = await readStore<Training>('trainings');
  const removed = trainings.find((t) => t.id === req.params.id);
  if (!removed) return res.status(404).json({ error: 'Not found' });
  await writeStore('trainings', trainings.filter((t) => t.id !== req.params.id));
  // Best-effort cleanup of the deleted training's uploaded files — published AND draft bytes.
  const removedIds = new Set([...materialFileIds(removed), ...draftFileIds(removed)]);
  await Promise.allSettled([...removedIds].map((id) => deleteMaterial(id)));
  // Drop the training's update acknowledgements too (the prune migration is the safety net).
  const acks = await readStore<UpdateAck>('updateAcks');
  const keptAcks = acks.filter((a) => a.trainingId !== removed.id);
  if (keptAcks.length !== acks.length) await writeStore('updateAcks', keptAcks);
  await auditEvent(req.user ?? null, 'delete', { type: 'training', id: removed.id, name: trainingLabel(removed) });
  return res.status(204).end();
});

export default router;
