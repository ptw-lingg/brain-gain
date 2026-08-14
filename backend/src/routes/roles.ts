import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { JobRole } from '../types';
import { readStore, writeStore } from '../services/fileStore';
import { authenticate, requireAdmin, type AuthRequest } from '../middleware/auth';
import { auditEvent, diffEntities } from '../services/audit';

const router = Router();

// GET is read-only for any authenticated user (to resolve role names).
router.get('/', authenticate, async (_req, res) => {
  res.json(await readStore<JobRole>('roles'));
});

// Mutations are admin only.
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const { name, description, trainingIds } = req.body ?? {};
  if (typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
  const roles = await readStore<JobRole>('roles');
  const role: JobRole = {
    id: randomUUID(),
    name,
    description: typeof description === 'string' ? description : '',
    trainingIds: Array.isArray(trainingIds) ? trainingIds : [],
  };
  roles.push(role);
  await writeStore('roles', roles);
  await auditEvent(req.user ?? null, 'create', { type: 'role', id: role.id, name: role.name });
  return res.status(201).json(role);
});

router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const { name, description, trainingIds } = req.body ?? {};
  const roles = await readStore<JobRole>('roles');
  const idx = roles.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const before = roles[idx];
  roles[idx] = {
    ...roles[idx],
    name: typeof name === 'string' ? name : roles[idx].name,
    description: typeof description === 'string' ? description : roles[idx].description,
    trainingIds: Array.isArray(trainingIds) ? trainingIds : roles[idx].trainingIds,
  };
  await writeStore('roles', roles);
  await auditEvent(req.user ?? null, 'update', { type: 'role', id: roles[idx].id, name: roles[idx].name }, { changes: diffEntities(before, roles[idx]) });
  return res.json(roles[idx]);
});

router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const roles = await readStore<JobRole>('roles');
  const removed = roles.find((r) => r.id === req.params.id);
  if (!removed) return res.status(404).json({ error: 'Not found' });
  await writeStore('roles', roles.filter((r) => r.id !== req.params.id));
  await auditEvent(req.user ?? null, 'delete', { type: 'role', id: removed.id, name: removed.name });
  return res.status(204).end();
});

export default router;
