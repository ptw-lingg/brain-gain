import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { JobRole, OrgUnit, TrainingSession, Training, UpdateAck, User } from '../types';
import { readStore, writeStore } from '../services/fileStore';
import { authenticate, requireAdmin, type AuthRequest } from '../middleware/auth';
import { acksFor, computeDue, sessionsFor } from '../services/due';
import { requiredTrainingIdsFor } from '../services/training';
import { subtreeUnitIds, wouldCreateCycle } from '../services/orgUnits';
import { auditEvent, diffEntities } from '../services/audit';
import { toSafeUser } from './auth';

const router = Router();

router.use(authenticate);

// GET /api/org-units — any authenticated user (the UI needs the list for selects and labels).
router.get('/', async (_req, res) => {
  res.json(await readStore<OrgUnit>('orgUnits'));
});

// GET /api/org-units/my-team — the oversight view for a head: everyone in the units they head and
// all sub-units, with each member's required trainings and due status. Empty if the caller heads none.
// Registered before '/:id' so "my-team" is never captured as an id.
router.get('/my-team', async (req: AuthRequest, res) => {
  const [orgUnits, users, roles, trainings, sessions, acks] = await Promise.all([
    readStore<OrgUnit>('orgUnits'),
    readStore<User>('users'),
    readStore<JobRole>('roles'),
    readStore<Training>('trainings'),
    readStore<TrainingSession>('sessions'),
    readStore<UpdateAck>('updateAcks'),
  ]);

  const headedIds = orgUnits.filter((o) => o.headUserId === req.user!.id).map((o) => o.id);
  if (headedIds.length === 0) return res.json({ units: [], members: [] });

  const scope = subtreeUnitIds(orgUnits, headedIds);
  const unitName = new Map(orgUnits.map((o) => [o.id, o.name] as const));
  const trainingById = new Map(trainings.map((t) => [t.id, t] as const));

  const members = users
    .filter((u) => u.orgUnitId && scope.has(u.orgUnitId))
    .map((u) => {
      const requiredIds = requiredTrainingIdsFor(u, roles);
      const memberTrainings = [...requiredIds]
        .map((id) => trainingById.get(id))
        .filter((t): t is Training => Boolean(t))
        .map((t) => {
          const due = computeDue(t, sessionsFor(sessions, u.id, t.id), acksFor(acks, u.id, t.id));
          return { id: t.id, name: t.name, status: due.status, dueDate: due.dueDate };
        });
      return {
        user: toSafeUser(u),
        orgUnitName: unitName.get(u.orgUnitId!) ?? '',
        trainings: memberTrainings,
      };
    });

  res.json({
    units: orgUnits.filter((o) => headedIds.includes(o.id)),
    members,
  });
});

// POST /api/org-units — admin only.
router.post('/', requireAdmin, async (req: AuthRequest, res) => {
  const { name, parentId, headUserId } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  if (parentId != null && !orgUnits.some((o) => o.id === parentId)) {
    return res.status(400).json({ error: 'parentId does not exist' });
  }
  const unit: OrgUnit = {
    id: randomUUID(),
    name: name.trim(),
    parentId: typeof parentId === 'string' && parentId ? parentId : null,
    headUserId: typeof headUserId === 'string' ? headUserId : '',
  };
  orgUnits.push(unit);
  await writeStore('orgUnits', orgUnits);
  await auditEvent(req.user ?? null, 'create', { type: 'orgUnit', id: unit.id, name: unit.name });
  return res.status(201).json(unit);
});

// PUT /api/org-units/:id — admin only. Rejects parent changes that would create a cycle.
router.put('/:id', requireAdmin, async (req: AuthRequest, res) => {
  const { name, parentId, headUserId } = req.body ?? {};
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  const idx = orgUnits.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const current = orgUnits[idx];

  let nextParentId = current.parentId;
  if (parentId !== undefined) {
    nextParentId = typeof parentId === 'string' && parentId ? parentId : null;
    if (nextParentId != null && !orgUnits.some((o) => o.id === nextParentId)) {
      return res.status(400).json({ error: 'parentId does not exist' });
    }
    if (nextParentId === current.id || wouldCreateCycle(orgUnits, current.id, nextParentId)) {
      return res.status(400).json({ error: 'A unit cannot be its own ancestor' });
    }
  }

  orgUnits[idx] = {
    ...current,
    name: typeof name === 'string' && name.trim() ? name.trim() : current.name,
    parentId: nextParentId,
    headUserId: typeof headUserId === 'string' ? headUserId : current.headUserId,
  };
  await writeStore('orgUnits', orgUnits);
  await auditEvent(req.user ?? null, 'update', { type: 'orgUnit', id: orgUnits[idx].id, name: orgUnits[idx].name }, { changes: diffEntities(current, orgUnits[idx]) });
  return res.json(orgUnits[idx]);
});

// POST /api/org-units/:id/members — admin: move several users into this unit at once.
// Body: { userIds: string[] }. Unknown ids are ignored; returns how many users actually moved.
router.post('/:id/members', requireAdmin, async (req: AuthRequest, res) => {
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  const unit = orgUnits.find((o) => o.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  const raw = (req.body ?? {}).userIds;
  const userIds = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : null;
  if (!userIds) return res.status(400).json({ error: 'userIds must be an array' });

  const wanted = new Set(userIds);
  const users = await readStore<User>('users');
  let moved = 0;
  for (const u of users) {
    if (wanted.has(u.id) && u.orgUnitId !== unit.id) {
      u.orgUnitId = unit.id;
      moved++;
    }
  }
  if (moved) {
    await writeStore('users', users);
    await auditEvent(req.user ?? null, 'update', { type: 'orgUnit', id: unit.id, name: unit.name }, { details: `moved ${moved} member(s)` });
  }
  return res.json({ moved });
});

// DELETE /api/org-units/:id — admin only. Blocked while the unit has sub-units or member users.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res) => {
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  const unit = orgUnits.find((o) => o.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  if (orgUnits.some((o) => o.parentId === unit.id)) {
    return res.status(409).json({ error: 'This unit has sub-units — move or delete them first' });
  }
  const users = await readStore<User>('users');
  if (users.some((u) => u.orgUnitId === unit.id)) {
    return res.status(409).json({ error: 'This unit still has members — reassign them first' });
  }
  await writeStore(
    'orgUnits',
    orgUnits.filter((o) => o.id !== unit.id),
  );
  await auditEvent(req.user ?? null, 'delete', { type: 'orgUnit', id: unit.id, name: unit.name });
  return res.status(204).end();
});

export default router;
