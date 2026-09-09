import { asyncRouter } from '../middleware/asyncRouter';
import { randomUUID } from 'crypto';
import type { JobRole } from '../types';
import { readStore, updateStore } from '../services/fileStore';
import { authenticate, requireAdmin, type AuthRequest } from '../middleware/auth';
import { auditEvent, diffEntities } from '../services/audit';

const router = asyncRouter();

// GET is read-only for any authenticated user (to resolve role names).
router.get('/', authenticate, async (_req, res) => {
  res.json(await readStore<JobRole>('roles'));
});

// Mutations are admin only.
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const { name, description, trainingIds } = req.body ?? {};
  if (typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
  const role: JobRole = {
    id: randomUUID(),
    name,
    description: typeof description === 'string' ? description : '',
    trainingIds: Array.isArray(trainingIds) ? trainingIds : [],
  };
  await updateStore<JobRole>('roles', (roles) => [...roles, role]);
  await auditEvent(req.user ?? null, 'create', { type: 'role', id: role.id, name: role.name });
  return res.status(201).json(role);
});

router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const { name, description, trainingIds } = req.body ?? {};
  let before: JobRole | undefined;
  let after: JobRole | undefined;
  await updateStore<JobRole>('roles', (roles) => {
    const idx = roles.findIndex((r) => r.id === req.params.id);
    if (idx === -1) return null;
    before = roles[idx];
    after = {
      ...roles[idx],
      name: typeof name === 'string' ? name : roles[idx].name,
      description: typeof description === 'string' ? description : roles[idx].description,
      trainingIds: Array.isArray(trainingIds) ? trainingIds : roles[idx].trainingIds,
    };
    roles[idx] = after;
    return roles;
  });
  if (!before || !after) return res.status(404).json({ error: 'Not found' });
  await auditEvent(req.user ?? null, 'update', { type: 'role', id: after.id, name: after.name }, { changes: diffEntities(before, after) });
  return res.json(after);
});

router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  let removed: JobRole | undefined;
  await updateStore<JobRole>('roles', (roles) => {
    removed = roles.find((r) => r.id === req.params.id);
    return removed ? roles.filter((r) => r.id !== req.params.id) : null;
  });
  if (!removed) return res.status(404).json({ error: 'Not found' });
  await auditEvent(req.user ?? null, 'delete', { type: 'role', id: removed.id, name: removed.name });
  return res.status(204).end();
});

export default router;
