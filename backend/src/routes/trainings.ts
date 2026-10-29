import { raw } from 'express';
import { asyncRouter } from '../middleware/asyncRouter';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import type {
  DueTraining,
  JobRole,
  MaterialFile,
  OrgUnit,
  PublicTraining,
  Question,
  ScormAttempt,
  ScormPackageRef,
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
  resolveScormEntry,
  saveMaterial,
  transaction,
  updateStore,
  writeStore,
} from '../services/fileStore';
import { importScormPackage, ScormImportError } from '../services/scorm/import';
import { contentTypeFor } from '../services/scorm/mime';
import { deletePackageIfUnreferenced, getPackage, referencedPackageIds } from '../services/scorm/packages';
import { deleteAttempt } from '../services/scorm/attempts';
import { materialFileIds, sanitizeMaterials, sanitizePreviewImage } from '../services/materials';
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
import {
  requiredTrainingIds,
  requiredTrainingIdsFor,
  sanitizeAssignment,
  sanitizeRoleIds,
  syncRoleAssignment,
} from '../services/training';
import { affectedUsers, normalizeDeadline } from '../services/updates';
import { isSmtpConfigured, sendMail } from '../services/mail';
import { auditEvent, diffEntities } from '../services/audit';
import { toSafeUser } from './auth';
import { sanitizeFileName, sendAttachment, UUID_RE } from './http';

const router = asyncRouter();

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
 * `scormPackageId` is stripped as well (toPublic spreads ...rest, so any kept field leaks by
 * default): a SCORM-backed training gives the learner only the non-revealing `scorm` summary —
 * never the package id, entry file, mastery score or manifest internals. Its questions (kept in
 * storage but unused — the package replaces the quiz) are withheld entirely.
 */
function toPublic(t: Training, pkgs?: Map<string, ScormPackageRef>): PublicTraining {
  const { draft, scormPackageId, ...rest } = t;
  void draft;
  const pkg = scormPackageId ? pkgs?.get(scormPackageId) : undefined;
  return {
    ...rest,
    questions: (scormPackageId ? [] : t.questions).map((q) => {
      const { correctIndices, ...stripped } = q;
      void correctIndices;
      return { ...stripped, type: questionType(q) };
    }),
    ...(pkg ? { scorm: { version: pkg.version, title: pkg.title } } : {}),
  };
}

/** packageId → descriptor, for resolving `scorm` summaries in list responses. */
async function packageMap(): Promise<Map<string, ScormPackageRef>> {
  const packages = await readStore<ScormPackageRef>('scormPackages');
  return new Map(packages.map((p) => [p.packageId, p]));
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
 * Read all trainings sorted by their explicit `order`. Legacy records without one are coerced IN
 * MEMORY only (by file position) — the persistent backfill is migrateTrainingOrder() at boot. A read
 * path must never write: it used to, and a GET racing a PUT could revert the PUT.
 */
async function readOrderedTrainings(): Promise<Training[]> {
  const trainings = await readStore<Training>('trainings');
  trainings.forEach((t, i) => {
    if (typeof t.order !== 'number' || !Number.isFinite(t.order)) t.order = i;
    // Guard only — the real conversion of legacy materialLinks/materialFiles happens in the boot
    // migration (services/materials.ts); this keeps the field an array no matter what.
    if (!Array.isArray(t.materials)) t.materials = [];
  });
  return [...trainings].sort((a, b) => a.order - b.order);
}

// GET /api/trainings  (admin: all; trainer with ?mine=1: only owned)
// Roles changed through the training editor are audited exactly like edits in the role editor —
// one 'update' per role with the trainingIds diff — so the audit trail reads the same either way.
async function auditRoleChanges(req: AuthRequest, changed: { before: JobRole; after: JobRole }[]): Promise<void> {
  for (const { before, after } of changed) {
    await auditEvent(
      req.user ?? null,
      'update',
      { type: 'role', id: after.id, name: after.name },
      { changes: diffEntities(before, after) },
    );
  }
}

router.get('/', async (req: AuthRequest, res) => {
  const trainings = await readOrderedTrainings();
  const pkgs = await packageMap();
  const mine = req.query.mine === '1' || req.query.mine === 'true';
  const canSeeAnswers = (t: Training) => req.user?.isAdmin || t.ownerId === req.user?.id;
  let result = trainings;
  if (mine && !req.user?.isAdmin) {
    result = trainings.filter((t) => t.ownerId === req.user?.id);
  }
  // Owners/admins get full questions; everyone else gets the public (no-answer) shape.
  res.json(result.map((t) => (canSeeAnswers(t) ? t : toPublic(t, pkgs))));
});

// GET /api/trainings/mine  — current user's required trainings + due status
router.get('/mine', async (req: AuthRequest, res) => {
  const [trainings, sessions, acks] = await Promise.all([
    readOrderedTrainings(),
    readStore<TrainingSession>('sessions'),
    readStore<UpdateAck>('updateAcks'),
  ]);
  const required = await requiredTrainingIds(req.user!.id);
  const pkgs = await packageMap();
  const result: DueTraining[] = trainings
    .filter((t) => required.has(t.id))
    .map((t) => {
      const due = computeDue(
        t,
        sessionsFor(sessions, req.user!.id, t.id),
        acksFor(acks, req.user!.id, t.id),
      );
      return { training: toPublic(t, pkgs), ...due };
    });
  res.json(result);
});

// GET /api/trainings/trainees  — who must do my (or all) trainings, grouped
router.get('/trainees', requireTrainerOrAdmin, async (req: AuthRequest, res) => {
  const [trainings, roles, users, sessions, acks, orgUnits] = await Promise.all([
    readOrderedTrainings(),
    readStore<JobRole>('roles'),
    readStore<User>('users'),
    readStore<TrainingSession>('sessions'),
    readStore<UpdateAck>('updateAcks'),
    readStore<OrgUnit>('orgUnits'),
  ]);

  const owned = req.user?.isAdmin
    ? trainings
    : trainings.filter((t) => t.ownerId === req.user?.id);

  // Each user's required set once (roles, org unit, everyone) — then grouped per training.
  const requiredByUser = new Map(users.map((u) => [u.id, requiredTrainingIdsFor(u, roles, trainings, orgUnits)] as const));
  const groups: TraineeGroup[] = owned.map((training) => {
    const trainees = users
      .filter((u) => requiredByUser.get(u.id)!.has(training.id))
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

// POST /api/trainings/scorm-packages — upload a SCORM zip (trainer/admin). Training-independent,
// like the material upload: the editor uploads immediately, references the returned packageId in
// the draft, and persists on save — a brand-new training has no id until then. The archive is
// fully validated (manifest, single SCO, zip-slip/symlink/zip-bomb guards) and extracted before
// anything is recorded; a never-referenced package is swept by gcScorm after a day.
// Registered before '/:id' so the literal path is never mistaken for a training id.
router.post(
  '/scorm-packages',
  requireTrainerOrAdmin,
  raw({ type: '*/*', limit: '500mb' }), // packages with video run 100–250 MB; largest limit in the app
  async (req: AuthRequest, res) => {
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      return res.status(400).json({ error: 'empty upload' });
    }
    const name = sanitizeFileName(req.query.name, 'package.zip');
    try {
      const ref = await importScormPackage({
        zipBytes: bytes,
        uploadedBy: req.user!.id,
        originalFileName: name,
      });
      await auditEvent(
        req.user ?? null,
        'scorm-imported',
        { type: 'scormPackage', id: ref.packageId, name },
        {
          details: `scorm=${ref.version} files=${ref.fileCount} bytes=${ref.bytes} sco=1 title="${ref.title}"`,
        },
      );
      return res.status(201).json(ref);
    } catch (err) {
      if (err instanceof ScormImportError) {
        // Trainers WILL bring rejected packages to support — the reason belongs in the audit trail.
        await auditEvent(
          req.user ?? null,
          'scorm-rejected',
          { type: 'scormPackage', id: '', name },
          { details: `${err.code}: ${err.message}` },
        );
        return res.status(422).json({ error: err.message, code: err.code, details: err.details });
      }
      throw err;
    }
  },
);

// PATCH /api/trainings/scorm-packages/:packageId — the two trainer-editable package options.
// Everything else on the record is immutable after import (a new build is a new package).
router.patch('/scorm-packages/:packageId', requireTrainerOrAdmin, async (req: AuthRequest, res) => {
  const b = req.body ?? {};
  let pkg: ScormPackageRef | undefined;
  let badRule = false;
  await updateStore<ScormPackageRef>('scormPackages', (packages) => {
    pkg = packages.find((p) => p.packageId === req.params.packageId);
    if (!pkg) return null;
    if (b.completionRule !== undefined) {
      if (!['status', 'exit', 'time'].includes(b.completionRule)) {
        badRule = true;
        return null;
      }
      pkg.completionRule = b.completionRule;
    }
    if (b.allowExternal !== undefined) pkg.allowExternal = b.allowExternal === true;
    return packages;
  });
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  if (badRule) return res.status(400).json({ error: "completionRule must be 'status', 'exit' or 'time'" });
  await auditEvent(
    req.user ?? null,
    'update',
    { type: 'scormPackage', id: pkg.packageId, name: pkg.originalFileName },
    { details: `completionRule=${pkg.completionRule} allowExternal=${pkg.allowExternal}` },
  );
  return res.json(pkg);
});

// GET /api/trainings/scorm-packages/:packageId/thumbnail — the cover candidate the import found in
// the package (trainer/admin), served inline for the editor's "use as preview image?" offer.
// Adopting it is a CLIENT step: the editor downsizes these bytes and uploads them like any picked
// image, so the cover goes through exactly the same validation as a manual upload. The path comes
// from the stored descriptor (server-written at import), re-checked for containment before reading.
router.get('/scorm-packages/:packageId/thumbnail', requireTrainerOrAdmin, async (req: AuthRequest, res) => {
  const pkg = await getPackage(req.params.packageId);
  if (!pkg?.thumbnailHref) return res.status(404).json({ error: 'Not found' });
  const abs = resolveScormEntry(pkg.packageId, pkg.thumbnailHref);
  if (!abs) return res.status(404).json({ error: 'Not found' });
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(abs);
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
  res.setHeader('Content-Type', contentTypeFor(pkg.thumbnailHref));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Length', String(bytes.length));
  return res.end(bytes);
});

// DELETE /api/trainings/scorm-packages/:packageId — only when nothing references it (an attached
// package is removed by editing the training, which then cleans up here automatically).
router.delete('/scorm-packages/:packageId', requireTrainerOrAdmin, async (req: AuthRequest, res) => {
  const pkg = await getPackage(req.params.packageId);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  const deleted = await deletePackageIfUnreferenced(req.params.packageId);
  if (!deleted) return res.status(409).json({ error: 'The package is attached to a training' });
  await auditEvent(req.user ?? null, 'delete', {
    type: 'scormPackage',
    id: pkg.packageId,
    name: pkg.originalFileName,
  });
  return res.status(204).end();
});

// GET /api/trainings/:id/scorm-attempts — trainer diagnostics: the attempts against this training
// (index rows only — status, score, write counts; never the cmi itself). This is what resolves
// "the package doesn't work" tickets: it shows whether a course ever reported status or terminate.
router.get('/:id/scorm-attempts', requireAdminOrOwner, async (req: AuthRequest, res) => {
  const attempts = await readStore<ScormAttempt>('scormAttempts');
  const users = await readStore<User>('users');
  const emailOf = new Map(users.map((u) => [u.id, u.email]));
  return res.json(
    attempts
      .filter((a) => a.trainingId === req.params.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 100)
      .map((a) => ({ ...a, userEmail: emailOf.get(a.userId) ?? '' })),
  );
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

// GET /api/trainings/:id  — single training, answer key stripped for non-owners. Owners/admins
// (the editor) additionally get the RESOLVED package descriptors — published and staged — so the
// form can render the manifest card without a second round-trip.
router.get('/:id', async (req: AuthRequest, res) => {
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === req.params.id);
  if (!training) return res.status(404).json({ error: 'Not found' });
  if (!Array.isArray(training.materials)) training.materials = []; // backfill legacy records
  const canSeeAnswers = req.user?.isAdmin || training.ownerId === req.user?.id;
  if (!canSeeAnswers) return res.json(toPublic(training, await packageMap()));
  const publishedPkg = training.scormPackageId ? await getPackage(training.scormPackageId) : null;
  const draftPkg = training.draft?.scormPackageId
    ? training.draft.scormPackageId === training.scormPackageId
      ? publishedPkg
      : await getPackage(training.draft.scormPackageId)
    : null;
  return res.json({ ...training, scormPackages: { published: publishedPkg, draft: draftPkg } });
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
  // A new training starts UNPUBLISHED (version 0): any initial content goes into the draft, and
  // learners see nothing until version 1 is explicitly published.
  const draftMaterials = sanitizeMaterials(b.materials, MATERIAL_LOCALES);
  const draftQuestions = sanitizeQuestions(b.questions, MATERIAL_LOCALES);
  // The card cover, validated against the stored upload (master data — never staged).
  const preview = await sanitizePreviewImage(b.previewImage ?? null);
  if (!preview.ok) return res.status(400).json({ error: preview.error });
  // Read, validate against the current store and append under the store lock. The org-unit /
  // everyone assignment and the roles that require the training (`roleIds`) are master data set
  // right here — a trainer may assign their own training, an admin any (SR-199).
  type PostOutcome =
    | { status: number; error: string }
    | { training: Training; changedRoles: { before: JobRole; after: JobRole }[] };
  const outcome = await transaction(async (): Promise<PostOutcome> => {
  const trainings = await readStore<Training>('trainings');
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  const roles = await readStore<JobRole>('roles');
  const assignment = sanitizeAssignment(b.assignment, orgUnits);
  const roleIds = sanitizeRoleIds(b.roleIds, roles);
  // New trainings go to the end of the ordering.
  const maxOrder = trainings.reduce(
    (max, t) => (typeof t.order === 'number' && t.order > max ? t.order : max),
    -1,
  );
  // A staged SCORM package (uploaded before the first save) — id only, validated like PUT does.
  let draftScormId: string | null = null;
  if (typeof b.scormPackageId === 'string' && b.scormPackageId) {
    if (!(await getPackage(b.scormPackageId))) {
      return { status: 400, error: 'Unknown SCORM package' };
    }
    if (referencedPackageIds(trainings).has(b.scormPackageId)) {
      return { status: 409, error: 'This SCORM package belongs to another training' };
    }
    draftScormId = b.scormPackageId;
  }
  const training: Training = {
    id: randomUUID(),
    name,
    description: sanitizeLocalizedText(b.description, MATERIAL_LOCALES),
    durationMinutes: Math.max(0, Math.round(Number(b.durationMinutes) || 0)),
    category: sanitizeLocalizedText(b.category, MATERIAL_LOCALES),
    ...(preview.file ? { previewImage: preview.file } : {}),
    ...(assignment ? { assignment } : {}),
    ownerId,
    cycleYears: clamp(b.cycleYears, 1, 5, 1),
    windowBeforeMonths: clamp(b.windowBeforeMonths, 0, 3, 3),
    windowAfterMonths: clamp(b.windowAfterMonths, 0, 3, 3),
    order: maxOrder + 1,
    materials: [],
    questions: [],
    version: 0,
    updates: [],
    ...(draftMaterials.length || draftQuestions.length || draftScormId
      ? {
          draft: {
            materials: draftMaterials,
            questions: draftQuestions,
            ...(draftScormId ? { scormPackageId: draftScormId } : {}),
            savedAt: new Date().toISOString(),
          },
        }
      : {}),
    createdAt: new Date().toISOString(),
  };
  trainings.push(training);
  await writeStore('trainings', trainings);
  const changedRoles = roleIds ? syncRoleAssignment(roles, training.id, roleIds) : [];
  if (changedRoles.length) await writeStore('roles', roles);
  return { training, changedRoles };
  });
  if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error });
  const { training, changedRoles } = outcome;
  await auditEvent(req.user ?? null, 'create', { type: 'training', id: training.id, name: trainingLabel(training) });
  await auditRoleChanges(req, changedRoles);
  return res.status(201).json(training);
});

// PUT /api/trainings/reorder  — admin sets the global display order
// Must be registered before '/:id' so "reorder" isn't captured as an id.
router.put('/reorder', requireAdmin, async (req: AuthRequest, res) => {
  const raw = (req.body ?? {}).ids;
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : null;
  if (!ids) return res.status(400).json({ error: 'ids must be an array of training ids' });
  const position = new Map(ids.map((id, i) => [id, i]));
  let reordered: Training[] = [];
  await updateStore<Training>('trainings', (trainings) => {
    // Any training not listed (e.g. created concurrently) is appended, keeping its relative order.
    let tail = ids.length;
    reordered = trainings.map((t) => ({
      ...t,
      order: position.has(t.id) ? (position.get(t.id) as number) : tail++,
    }));
    return reordered;
  });
  await auditEvent(req.user ?? null, 'update', { type: 'training' }, { details: `reordered ${ids.length} trainings` });
  return res.json([...reordered].sort((a, b) => a.order - b.order));
});

// PUT /api/trainings/:id  — admin or owning trainer. Metadata is applied immediately; CONTENT
// (materials/questions) is STAGED: it lands in the draft when it differs from the published
// content and never touches the published fields — trainees keep seeing the last published
// version until the editor publishes (SR-170).
router.put('/:id', requireAdminOrOwner, async (req: AuthRequest, res) => {
  const b = req.body ?? {};
  // Read → validate → write under the store lock, so two editors saving at the same moment (even
  // different trainings — the store is one file) cannot lose a save. The byte/package cleanup below
  // needs only the before/after records and runs outside the lock.
  type PutOutcome =
    | { status: number; error: string }
    | {
        current: Training;
        updated: Training;
        candScormId: string | null;
        nextPreview: MaterialFile | undefined;
        changedRoles: { before: JobRole; after: JobRole }[];
      };
  const outcome = await transaction(async (): Promise<PutOutcome> => {
  const trainings = await readStore<Training>('trainings');
  const idx = trainings.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return { status: 404, error: 'Not found' };
  const current = trainings[idx];
  // Assignment (org units / everyone): present-or-keep like the other master data; null clears it.
  // Validated against the current org-unit store so a deleted unit can never be (re)assigned.
  let nextAssignment = current.assignment;
  if (b.assignment !== undefined) {
    nextAssignment = b.assignment === null ? undefined : sanitizeAssignment(b.assignment, await readStore<OrgUnit>('orgUnits'));
  }
  // The roles that require this training — the same data the role editor writes (JobRole.trainingIds),
  // edited from the training side. Absent = roles untouched.
  const roles = await readStore<JobRole>('roles');
  const roleIds = sanitizeRoleIds(b.roleIds, roles);
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
  // The staged SCORM package: an id ONLY (null clears it) — the descriptor is resolved from the
  // server's own store, so a client can never smuggle a tampered masteryScore/entryHref in.
  // Same present-or-keep rule as above; undefined keeps the WIP value.
  const candScormId: string | null =
    b.scormPackageId !== undefined
      ? typeof b.scormPackageId === 'string' && b.scormPackageId
        ? b.scormPackageId
        : null
      : current.draft
        ? current.draft.scormPackageId ?? null
        : current.scormPackageId ?? null;
  if (candScormId && candScormId !== current.scormPackageId && candScormId !== current.draft?.scormPackageId) {
    if (!(await getPackage(candScormId))) {
      return { status: 400, error: 'Unknown SCORM package' };
    }
    // One package = one training: a package referenced elsewhere cannot be attached here too
    // (attempt records and GC pin a package to the training it belongs to).
    const others = trainings.filter((t) => t.id !== current.id);
    if (referencedPackageIds(others).has(candScormId)) {
      return { status: 409, error: 'This SCORM package belongs to another training' };
    }
  }
  // The card cover: present-or-keep like the other master data; an explicit null removes it. It is
  // validated against the stored upload and applied immediately — never part of the draft below.
  let nextPreview = current.previewImage;
  if (b.previewImage !== undefined) {
    const preview = await sanitizePreviewImage(b.previewImage);
    if (!preview.ok) return { status: 400, error: preview.error };
    nextPreview = preview.file ?? undefined;
  }
  const publishedJson = JSON.stringify([current.materials ?? [], current.questions, current.scormPackageId ?? null]);
  const candidateJson = JSON.stringify([candMaterials, candQuestions, candScormId]);
  const oldDraftJson = current.draft
    ? JSON.stringify([current.draft.materials, current.draft.questions, current.draft.scormPackageId ?? null])
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
    // `version`, `publishedAt` and `updates` are server-managed like `order`: never read from the
    // body, they ride along from `current` via the spread above and change only through
    // publish-update / cancel. The PUBLISHED content is server-managed too — written exclusively
    // by publish-update:
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
              : {
                  materials: candMaterials,
                  questions: candQuestions,
                  ...(candScormId ? { scormPackageId: candScormId } : {}),
                  savedAt: new Date().toISOString(),
                },
        }),
  };
  if (candidateJson === publishedJson) delete trainings[idx].draft;
  // The spread above carried the old cover along; apply the decision (kept, replaced or removed).
  if (nextPreview) trainings[idx].previewImage = nextPreview;
  else delete trainings[idx].previewImage;
  if (nextAssignment) trainings[idx].assignment = nextAssignment;
  else delete trainings[idx].assignment;
  await writeStore('trainings', trainings);
  const changedRoles = roleIds ? syncRoleAssignment(roles, current.id, roleIds) : [];
  if (changedRoles.length) await writeStore('roles', roles);
  return { current, updated: trainings[idx], candScormId, nextPreview, changedRoles };
  });
  if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error });
  const { current, updated, candScormId, nextPreview, changedRoles } = outcome;
  // A draft's file may have been removed or replaced: delete bytes referenced by the OLD draft
  // that neither the new draft nor the published content still uses. Published bytes are never
  // deleted here — PUT cannot change the published content. Best-effort, as before.
  // A replaced or removed cover image is dropped the same way (unless a material still uses it).
  const keptIds = new Set([
    ...materialFileIds(updated),
    ...draftFileIds(updated),
    ...(nextPreview ? [nextPreview.id] : []),
  ]);
  const droppedIds = [
    ...draftFileIds(current),
    ...(current.previewImage ? [current.previewImage.id] : []),
  ].filter((id) => !keptIds.has(id));
  await Promise.allSettled(droppedIds.map((id) => deleteMaterial(id)));
  // Same for a replaced/removed draft package: its tree is deleted once nothing references it.
  const oldDraftScormId = current.draft?.scormPackageId;
  if (oldDraftScormId && oldDraftScormId !== candScormId) {
    await deletePackageIfUnreferenced(oldDraftScormId);
  }
  await auditEvent(
    req.user ?? null,
    'update',
    { type: 'training', id: updated.id, name: trainingLabel(updated) },
    { changes: diffEntities(current, updated) },
  );
  await auditRoleChanges(req, changedRoles);
  return res.json(updated);
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

  // Promotion, version bump and update record under the store lock; the mail (slow, external) and
  // the byte cleanup follow outside it.
  type PublishOutcome =
    | { status: number; error: string }
    | {
        training: Training;
        update: TrainingUpdate | null;
        version: number;
        oldPublishedIds: string[];
        oldPublishedScormId: string | undefined;
      };
  const outcome = await transaction(async (): Promise<PublishOutcome> => {
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === req.params.id);
  if (!training) return { status: 404, error: 'Not found' };

  const currentVersion = versionOf(training);
  // Nobody can have passed an unpublished training (grading is refused at version 0), so an
  // obligation would reach no one — and its update record would claim version 1, breaking the
  // invariant that update records are v2+. The first version is published silently.
  if (kind === 'notify' && currentVersion === 0) {
    return { status: 400, error: 'not published yet — publish the first version silently' };
  }
  // A silent publish exists to make a draft live; without one there is nothing it could do.
  if (kind === 'silent' && !training.draft) {
    return { status: 400, error: 'nothing to publish — no draft' };
  }

  // A confirm-mode update is discharged by a button click (confirm-materials) — meaningless for a
  // SCORM course, whose new content must actually be run. Judged against the POST-promotion state.
  const nextScormId = training.draft ? training.draft.scormPackageId : training.scormPackageId;
  if (kind === 'notify' && b.mode === 'confirm' && nextScormId) {
    return { status: 400, error: 'A SCORM course update requires a retake, not a confirmation' };
  }

  // Promote the draft: it becomes the published content; bytes only the old published version
  // referenced are deleted after the store write. (A notify publish WITHOUT a draft is allowed —
  // it re-announces the current content.) The SCORM package id is promoted the same way — the
  // published id is PINNED to this version; in-flight attempts keep running against the build they
  // launched with and are refused at grading if a newer one was published meanwhile.
  const oldPublishedIds = materialFileIds(training);
  const oldPublishedScormId = training.scormPackageId;
  if (training.draft) {
    training.materials = training.draft.materials;
    training.questions = training.draft.questions;
    if (training.draft.scormPackageId) training.scormPackageId = training.draft.scormPackageId;
    else delete training.scormPackageId;
    delete training.draft;
  }
  const version = currentVersion + 1;
  const publishedAt = new Date().toISOString();
  training.version = version;
  training.publishedAt = publishedAt; // when the CURRENT version went live — silent publishes too

  let update: TrainingUpdate | null = null;
  if (kind === 'notify') {
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 2000) : undefined;
    update = {
      id: randomUUID(),
      publishedAt,
      deadline,
      mode: b.mode,
      ...(note ? { note } : {}),
      publishedBy: req.user!.id,
      version,
    };
    training.updates = [...(training.updates ?? []), update];
  }
  await writeStore('trainings', trainings);
  return { training, update, version, oldPublishedIds, oldPublishedScormId };
  });
  if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error });
  const { training, update, version, oldPublishedIds, oldPublishedScormId } = outcome;
  const newPublishedIds = new Set(materialFileIds(training));
  await Promise.allSettled(
    oldPublishedIds.filter((id) => !newPublishedIds.has(id)).map((id) => deleteMaterial(id)),
  );
  if (oldPublishedScormId && oldPublishedScormId !== training.scormPackageId) {
    await deletePackageIfUnreferenced(oldPublishedScormId);
  }

  if (kind === 'silent') {
    await auditEvent(
      req.user ?? null,
      'training-update-published',
      { type: 'training', id: training.id, name: trainingLabel(training) },
      { details: `version=${version} kind=silent` },
    );
    return res.status(201).json({ version });
  }

  // Affected = assigned (role, org unit or everyone) AND passed before this publish; disabled
  // accounts can't sign in, so they are not emailed (their obligation surfaces on reactivation
  // through the due list).
  const [users, roles, sessions, settings, orgUnits] = await Promise.all([
    readStore<User>('users'),
    readStore<JobRole>('roles'),
    readStore<TrainingSession>('sessions'),
    readSettings(),
    readStore<OrgUnit>('orgUnits'),
  ]);
  const affected = affectedUsers(training, users, roles, sessions, orgUnits);
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
  const outcome = await transaction(async () => {
    const trainings = await readStore<Training>('trainings');
    const training = trainings.find((t) => t.id === req.params.id);
    if (!training) return { error: 'Not found' };
    if (!training.draft) return { error: 'No draft to discard' };
    const savedAt = training.draft.savedAt;
    const droppedCandidates = draftFileIds(training);
    const droppedScormId = training.draft.scormPackageId;
    delete training.draft;
    await writeStore('trainings', trainings);
    return { training, savedAt, droppedCandidates, droppedScormId };
  });
  if ('error' in outcome) return res.status(404).json({ error: outcome.error });
  const { training, savedAt, droppedCandidates, droppedScormId } = outcome;
  const publishedIds = new Set(materialFileIds(training));
  await Promise.allSettled(
    droppedCandidates.filter((id) => !publishedIds.has(id)).map((id) => deleteMaterial(id)),
  );
  if (droppedScormId && droppedScormId !== training.scormPackageId) {
    await deletePackageIfUnreferenced(droppedScormId);
  }
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
  // Trainings and acks rewritten in one transaction (a confirm-materials landing in between would
  // otherwise re-create an ack for a withdrawn update).
  const outcome = await transaction(async () => {
    const trainings = await readStore<Training>('trainings');
    const training = trainings.find((t) => t.id === req.params.id);
    if (!training) return null;
    const update = (training.updates ?? []).find((u) => u.id === req.params.updateId);
    if (!update) return null;
    training.updates = (training.updates ?? []).filter((u) => u.id !== update.id);
    await writeStore('trainings', trainings);
    const acks = await readStore<UpdateAck>('updateAcks');
    const kept = acks.filter((a) => a.updateId !== update.id);
    if (kept.length !== acks.length) await writeStore('updateAcks', kept);
    return { training, update };
  });
  if (!outcome) return res.status(404).json({ error: 'Not found' });
  const { training, update } = outcome;
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
  // The record and its update acknowledgements go in one transaction; the file, package and
  // attempt cleanup is best-effort and runs afterwards (each with its own serialization).
  const removed = await transaction(async () => {
    const trainings = await readStore<Training>('trainings');
    const found = trainings.find((t) => t.id === req.params.id);
    if (!found) return null;
    await writeStore('trainings', trainings.filter((t) => t.id !== req.params.id));
    // Drop the training's update acknowledgements too (the prune migration is the safety net).
    const acks = await readStore<UpdateAck>('updateAcks');
    const keptAcks = acks.filter((a) => a.trainingId !== found.id);
    if (keptAcks.length !== acks.length) await writeStore('updateAcks', keptAcks);
    return found;
  });
  if (!removed) return res.status(404).json({ error: 'Not found' });
  // Best-effort cleanup of the deleted training's uploaded files — published AND draft bytes,
  // plus the card's cover image.
  const removedIds = new Set([
    ...materialFileIds(removed),
    ...draftFileIds(removed),
    ...(removed.previewImage ? [removed.previewImage.id] : []),
  ]);
  await Promise.allSettled([...removedIds].map((id) => deleteMaterial(id)));
  // SCORM cleanup: the training's packages (published + draft) once unreferenced, and its
  // never-consumed attempts. Consumed attempts stay — they are the evidence behind persisted
  // sessions, which survive a training deletion too.
  for (const pkgId of new Set([removed.scormPackageId, removed.draft?.scormPackageId])) {
    if (pkgId) await deletePackageIfUnreferenced(pkgId);
  }
  const scormAttempts = await readStore<ScormAttempt>('scormAttempts');
  await Promise.allSettled(
    scormAttempts.filter((a) => a.trainingId === removed.id).map((a) => deleteAttempt(a.id)),
  );
  await auditEvent(req.user ?? null, 'delete', { type: 'training', id: removed.id, name: trainingLabel(removed) });
  return res.status(204).end();
});

export default router;
