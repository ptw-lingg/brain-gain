import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { SafeUser, User } from '../types';
import { readStore } from '../services/fileStore';
import { authenticate, signToken, type AuthRequest } from '../middleware/auth';

const router = Router();

export function toSafeUser(user: User): SafeUser {
  const { passwordHash, ...safe } = user;
  void passwordHash;
  return safe;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const users = await readStore<User>('users');
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken({
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    isTrainer: user.isTrainer,
  });
  return res.json({ token, user: toSafeUser(user) });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const users = await readStore<User>('users');
  const user = users.find((u) => u.id === req.user?.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json(toSafeUser(user));
});

export default router;
