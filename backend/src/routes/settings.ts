import { Router } from 'express';
import type { Settings } from '../types';
import { readSettings, writeSettings } from '../services/fileStore';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// GET /api/settings  — any authenticated user (client needs the threshold)
router.get('/', authenticate, async (_req, res) => {
  res.json(await readSettings());
});

// PUT /api/settings  — admin only; applies to all trainings at once
router.put('/', authenticate, requireAdmin, async (req, res) => {
  const raw = Number(req.body?.passThreshold);
  if (!Number.isFinite(raw)) {
    return res.status(400).json({ error: 'passThreshold (0–1) is required' });
  }
  const passThreshold = Math.min(1, Math.max(0.5, raw));
  const settings: Settings = { passThreshold };
  await writeSettings(settings);
  return res.json(settings);
});

export default router;
