import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { User } from '../types';
import { readStore, writeStore } from '../services/fileStore';
import { authenticate, requireAdmin } from '../middleware/auth';
import { toSafeUser } from './auth';

const router = Router();

router.use(authenticate, requireAdmin);

// GET /api/users
router.get('/', async (_req, res) => {
  const users = await readStore<User>('users');
  res.json(users.map(toSafeUser));
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  const users = await readStore<User>('users');
  const user = users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  return res.json(toSafeUser(user));
});

// POST /api/users  — admin creates a user
router.post('/', async (req, res) => {
  const { name, email, password, roleIds, isAdmin, isTrainer } = req.body ?? {};
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'name, email, password are required' });
  }
  const users = await readStore<User>('users');
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already in use' });
  }
  const user: User = {
    id: randomUUID(),
    name,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    roleIds: Array.isArray(roleIds) ? roleIds : [],
    isAdmin: Boolean(isAdmin),
    isTrainer: Boolean(isTrainer),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await writeStore('users', users);
  return res.status(201).json(toSafeUser(user));
});

// PUT /api/users/:id
router.put('/:id', async (req, res) => {
  const { name, email, roleIds, isAdmin, isTrainer, password } = req.body ?? {};
  const users = await readStore<User>('users');
  const idx = users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const current = users[idx];
  const updated: User = {
    ...current,
    name: typeof name === 'string' ? name : current.name,
    email: typeof email === 'string' ? email : current.email,
    roleIds: Array.isArray(roleIds) ? roleIds : current.roleIds,
    isAdmin: typeof isAdmin === 'boolean' ? isAdmin : current.isAdmin,
    isTrainer: typeof isTrainer === 'boolean' ? isTrainer : current.isTrainer,
    passwordHash:
      typeof password === 'string' && password.length > 0
        ? await bcrypt.hash(password, 10)
        : current.passwordHash,
  };
  users[idx] = updated;
  await writeStore('users', users);
  return res.json(toSafeUser(updated));
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  const users = await readStore<User>('users');
  const next = users.filter((u) => u.id !== req.params.id);
  if (next.length === users.length) return res.status(404).json({ error: 'Not found' });
  await writeStore('users', next);
  return res.status(204).end();
});

export default router;
