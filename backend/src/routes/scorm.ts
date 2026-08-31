// SCORM runtime endpoints (main origin, Bearer-authenticated) — launching/resuming an attempt and
// committing cmi writes. Mounted at /api/sessions/scorm. Everything that authorizes STATE lives
// here on the app origin: the content origin's launch token only ever authorizes bytes.

import { Router } from 'express';
import { randomBytes } from 'crypto';
import type { NextFunction, Response } from 'express';
import type { ScormAttemptFile, Training, User } from '../types';
import { readStore } from '../services/fileStore';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { requiredTrainingIds } from '../services/training';
import { getPackage } from '../services/scorm/packages';
import { commitAttempt, loadAttempt, startOrResumeAttempt } from '../services/scorm/attempts';
import { LAUNCH_TTL_SEC, mintLaunchToken } from '../services/scorm/launch';
import { contentOrigin, SCORM_ENABLED } from '../services/scorm/config';
import { flattenCmi, readOnlyKeys } from '../scorm/model';
import { isCmiPatch } from '../scorm/protocol';

const router = Router();
router.use(authenticate);

interface AttemptRequest extends AuthRequest {
  attemptFile?: ScormAttemptFile;
}

// Loads the attempt and 404s (not 403 — no existence oracle) unless it belongs to the caller.
async function ownAttempt(req: AttemptRequest, res: Response, next: NextFunction): Promise<void> {
  const file = await loadAttempt(req.params.attemptId);
  if (!file || file.attempt.userId !== req.user!.id) {
    res.status(404).json({ error: 'Attempt not found' });
    return;
  }
  req.attemptFile = file;
  next();
}

// A malicious package could hammer commits; a small per-attempt token bucket keeps it off the
// disk. The legitimate client coalesces writes (~2 s), so real traffic never comes close.
const RATE_LIMIT = { capacity: 20, refillPerSec: 2 };
const buckets = new Map<string, { tokens: number; at: number }>();
function rateLimited(attemptId: string): boolean {
  const now = Date.now();
  const b = buckets.get(attemptId) ?? { tokens: RATE_LIMIT.capacity, at: now };
  b.tokens = Math.min(RATE_LIMIT.capacity, b.tokens + ((now - b.at) / 1000) * RATE_LIMIT.refillPerSec);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(attemptId, b);
    return true;
  }
  b.tokens -= 1;
  buckets.set(attemptId, b);
  if (buckets.size > 2000) buckets.clear();
  return false;
}

// POST /api/sessions/scorm/launch { trainingId, restart? } — open or resume the caller's attempt
// and hand back everything the player needs: the content-origin launch URL (token in the PATH),
// the per-launch nonce, and the COMPLETE flattened cmi seed (reads are answered locally in the
// shim — no read ever crosses the bridge).
router.post('/launch', async (req: AuthRequest, res) => {
  if (!SCORM_ENABLED) return res.status(501).json({ error: 'SCORM is disabled on this server' });
  const { trainingId, restart } = req.body ?? {};
  if (typeof trainingId !== 'string') return res.status(400).json({ error: 'trainingId is required' });

  const trainings = await readStore<Training>('trainings');
  const training = trainings.find((t) => t.id === trainingId);
  if (!training) return res.status(404).json({ error: 'Training not found' });

  const version = typeof training.version === 'number' ? training.version : 1;
  if (version < 1) {
    return res.status(409).json({ error: 'This training has no published version yet' });
  }
  if (!training.scormPackageId) {
    return res.status(409).json({ error: 'This training has no SCORM course' });
  }
  const pkg = await getPackage(training.scormPackageId);
  if (!pkg) return res.status(409).json({ error: 'The SCORM course content is missing' });

  // Learners launch what is assigned to them; owners/admins may trial-run anything they manage —
  // as a PREVIEW (never consumable). An impersonated session is always a preview: an impersonator
  // must not be able to work on the learner's record.
  const required = await requiredTrainingIds(req.user!.id);
  const isOwner = req.user!.isAdmin || training.ownerId === req.user!.id;
  const impersonated = Boolean(req.user!.impersonatorId);
  const preview = impersonated || (!required.has(training.id) && isOwner);
  if (!required.has(training.id) && !isOwner) {
    return res.status(403).json({ error: 'This training is not assigned to you' });
  }

  const users = await readStore<User>('users');
  const user = users.find((u) => u.id === req.user!.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { file, resumed } = await startOrResumeAttempt({
    userId: user.id,
    training,
    pkg,
    preview,
    restart: restart === true,
  });

  const nonce = randomBytes(16).toString('base64url');
  const token = mintLaunchToken({
    aid: file.attempt.id,
    pid: pkg.packageId,
    sub: user.id,
    jti: nonce,
  });
  const origin = contentOrigin(req.headers.host);
  const cmi = flattenCmi(pkg.version, file.cmi, {
    studentId: user.id, // the UUID — deliberately not the email (no PII to untrusted content)
    studentName: user.name,
    masteryScore: pkg.masteryScore,
    launchData: pkg.dataFromLms ?? '',
    mode: preview ? 'browse' : 'normal',
    credit: preview ? 'no-credit' : 'credit',
    entry: resumed ? 'resume' : 'ab-initio',
  });

  return res.json({
    attemptId: file.attempt.id,
    resumed,
    contentOrigin: origin,
    url: `${origin}/s/${token}/_lms/wrapper.html`,
    nonce,
    version: pkg.version,
    cmi,
    readOnly: readOnlyKeys(pkg.version),
    preview,
    completionRule: pkg.completionRule,
    masteryScore: pkg.masteryScore,
    expiresAt: new Date(Date.now() + LAUNCH_TTL_SEC * 1000).toISOString(),
  });
});

// GET /api/sessions/scorm/attempts/:attemptId — the caller's own attempt (resume UI, diagnostics).
router.get('/attempts/:attemptId', ownAttempt, async (req: AttemptRequest, res) => {
  const { attempt, cmi } = req.attemptFile!;
  return res.json({ attempt, suspendDataLength: cmi.suspendData.length });
});

// POST /api/sessions/scorm/attempts/:attemptId/commit { values?, terminate?, exit? } — persist a
// batch of raw SCORM element writes. Write-through: a 200 means durably on disk, which is the
// guarantee that lets the player's save indicator be honest. Scores/statuses arrive as raw element
// writes and are normalized server-side — no derived result is ever accepted from the client.
router.post('/attempts/:attemptId/commit', ownAttempt, async (req: AttemptRequest, res) => {
  if (rateLimited(req.params.attemptId)) return res.status(429).json({ error: 'Too many requests' });
  const b = req.body ?? {};
  const values: unknown = b.values ?? {};
  if (!isCmiPatch(values)) return res.status(400).json({ error: 'values must be a valid cmi patch' });

  const result = await commitAttempt(req.params.attemptId, values, {
    terminate: b.terminate === true,
    exit: typeof b.exit === 'string' ? b.exit : undefined,
  });
  // null = the attempt is closed or already consumed — a finished attempt is immutable.
  if (!result) return res.status(409).json({ error: 'This attempt is no longer open' });
  return res.json(result);
});

export default router;
