import { asyncRouter } from '../middleware/asyncRouter';
import { authenticate, requireAdmin } from '../middleware/auth';
import { appVersion } from '../services/appVersion';
import { readDataMeta } from '../services/dataVersion';

const router = asyncRouter();

// GET /api/version — admin only. The app version is public on /api/health (every user's About dialog
// reads it there); this adds the data-version marker with its migration history — the fast answer to
// "is this installation half-migrated?" — which is diagnostics, not something every user needs.
router.get('/', authenticate, requireAdmin, async (_req, res) => {
  const meta = await readDataMeta();
  res.json({
    app: appVersion(),
    data: meta?.dataVersion ?? null,
    migratedAt: meta?.migratedAt || null,
    history: meta?.history ?? [],
  });
});

export default router;
