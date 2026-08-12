import { Router, raw } from 'express';
import { authenticate, requireAdmin, type AuthRequest } from '../middleware/auth';
import { sanitizeFileName, sendAttachment, UUID_RE } from './http';
import {
  BackupError,
  BackupNotFound,
  bundleAll,
  createBackup,
  deleteBackup,
  listBackups,
  readBackup,
  RestoreFailed,
  restoreBackup,
  storeUploadedBackup,
} from '../services/backup';
import { runDataMigrations } from '../services/migrations';

const router = Router();

// Backups contain every record in the system, including password hashes and the SMTP password, and a
// restore overwrites all data — so every endpoint here is administrator-only.
router.use(authenticate, requireAdmin);

// Ids are server-issued UUIDs. Declaring the guard once means a later /:id endpoint cannot ship without
// it — the allowlist is what stops a crafted id escaping the backups directory.
router.param('id', (req, res, next, id) => {
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'bad backup id' });
    return;
  }
  next();
});

const ZIP = 'application/zip';

// GET /api/backups — list stored backups, newest first.
router.get('/', async (_req: AuthRequest, res) => {
  try {
    return res.json(await listBackups());
  } catch (err) {
    console.error('Backup list error:', err);
    return res.status(500).json({ error: 'Could not read the backup list' });
  }
});

// POST /api/backups — snapshot all app data into a new backup.
router.post('/', async (_req: AuthRequest, res) => {
  try {
    return res.status(201).json(await createBackup('manual'));
  } catch (err) {
    console.error('Backup create error:', err);
    return res.status(500).json({ error: 'Could not create the backup' });
  }
});

// GET /api/backups/download-all — every backup bundled into a single ZIP.
// Registered before /:id/... so the literal path is never taken for an id.
router.get('/download-all', async (_req: AuthRequest, res) => {
  try {
    const { bytes, count, fileName } = await bundleAll();
    if (!count) return res.status(404).json({ error: 'There are no backups to download' });
    return sendAttachment(res, bytes, fileName, ZIP);
  } catch (err) {
    console.error('Backup bundle error:', err);
    return res.status(500).json({ error: 'Could not bundle the backups' });
  }
});

// POST /api/backups/upload — store an archive produced elsewhere, after validating it.
// The raw parser sits after the auth middleware so an unauthenticated body is rejected before buffering.
router.post('/upload', raw({ type: '*/*', limit: '200mb' }), async (req: AuthRequest, res) => {
  const bytes = req.body;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return res.status(400).json({ error: 'empty upload' });
  }
  try {
    const meta = await storeUploadedBackup(bytes, sanitizeFileName(req.query.name, 'backup.zip'));
    return res.status(201).json(meta);
  } catch (err) {
    if (err instanceof BackupError) return res.status(400).json({ error: err.message });
    console.error('Backup upload error:', err);
    return res.status(500).json({ error: 'Could not store the uploaded backup' });
  }
});

// GET /api/backups/:id/download — one archive.
router.get('/:id/download', async (req: AuthRequest, res) => {
  try {
    const stored = await readBackup(req.params.id);
    if (!stored) return res.status(404).json({ error: 'Not found' });
    return sendAttachment(res, stored.bytes, stored.meta.fileName, ZIP);
  } catch (err) {
    console.error('Backup download error:', err);
    return res.status(500).json({ error: 'Could not read the backup' });
  }
});

// POST /api/backups/:id/restore — replace ALL app data with this backup's contents.
router.post('/:id/restore', async (req: AuthRequest, res) => {
  try {
    const result = await restoreBackup(req.params.id);
    // An archive may carry records in any historical shape — normalize them right away rather
    // than waiting for the next boot (which is when the migrations otherwise run).
    await runDataMigrations();
    return res.json({
      restored: true,
      fileName: result.meta.fileName,
      files: result.files,
      materials: result.materials,
      safetyBackupId: result.safetyBackupId,
    });
  } catch (err) {
    // Refused before any write: the dataset is untouched.
    if (err instanceof BackupNotFound) return res.status(404).json({ error: err.message });
    if (err instanceof BackupError) return res.status(400).json({ error: err.message });
    // Failed mid-restore: the data may be partially updated, so hand back the recovery point.
    if (err instanceof RestoreFailed) {
      console.error('Backup restore failed after the safety snapshot:', err.cause);
      return res.status(500).json({ error: err.message, safetyBackupId: err.safetyBackupId });
    }
    console.error('Backup restore error:', err);
    return res.status(500).json({ error: 'Could not restore the backup' });
  }
});

// DELETE /api/backups/:id
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const removed = await deleteBackup(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Not found' });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('Backup delete error:', err);
    return res.status(500).json({ error: 'Could not delete the backup' });
  }
});

export default router;
