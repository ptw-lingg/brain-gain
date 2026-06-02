import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthUser, Training } from '../types';
import { readStore } from '../services/fileStore';

export const JWT_SECRET = process.env.JWT_SECRET || 'braingain-secret';

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

// For training POST: admins and trainers may create.
export function requireTrainerOrAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin && !req.user?.isTrainer) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

// For training PUT/DELETE: admin, or the trainer who owns that training.
export async function requireAdminOrOwner(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.user?.isAdmin) {
    next();
    return;
  }
  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === req.params.id);
  if (training && training.ownerId === req.user?.id) {
    next();
    return;
  }
  res.status(403).json({ error: 'Forbidden' });
}
