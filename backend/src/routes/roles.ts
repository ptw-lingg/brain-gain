import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { JobRole } from '../types';
import { readStore, writeStore } from '../services/fileStore';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// GET is read-only for any authenticated user (to resolve role names).
router.get('/', authenticate, async (_req, res) => {
  res.json(await readStore<JobRole>('roles'));
});

// Mutations are admin only.
router.post('/', authenticate, requireAdmin, async (req, res) => {
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
  return res.status(201).json(role);
});

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { name, description, trainingIds } = req.body ?? {};
  const roles = await readStore<JobRole>('roles');
  const idx = roles.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  roles[idx] = {
    ...roles[idx],
    name: typeof name === 'string' ? name : roles[idx].name,
    description: typeof description === 'string' ? description : roles[idx].description,
    trainingIds: Array.isArray(trainingIds) ? trainingIds : roles[idx].trainingIds,
  };
  await writeStore('roles', roles);
  return res.json(roles[idx]);
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const roles = await readStore<JobRole>('roles');
  const next = roles.filter((r) => r.id !== req.params.id);
  if (next.length === roles.length) return res.status(404).json({ error: 'Not found' });
  await writeStore('roles', next);
  return res.status(204).end();
});

export default router;
