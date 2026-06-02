import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import roleRoutes from './routes/roles';
import trainingRoutes from './routes/trainings';
import sessionRoutes from './routes/sessions';
import settingsRoutes from './routes/settings';
import { seed } from './seed';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/trainings', trainingRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/settings', settingsRoutes);

// Generic error handler so unhandled rejections surface as JSON.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  },
);

seed()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🧠 BrainGain API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to seed/start:', err);
    process.exit(1);
  });
