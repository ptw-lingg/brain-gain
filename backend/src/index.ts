import express from 'express';
import cors from 'cors';
import http from 'http';
import https from 'https';
import path from 'path';
import { existsSync } from 'fs';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import roleRoutes from './routes/roles';
import trainingRoutes from './routes/trainings';
import sessionRoutes from './routes/sessions';
import settingsRoutes from './routes/settings';
import { seed } from './seed';
import { ensureCredentials, registerHttpsServer } from './services/tls';

const app = express();
// HTTPS is the only delivery channel; HTTP only 308-redirects here.
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || Number(process.env.PORT) || 3001;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' })); // headroom for PEM certificate uploads

// HSTS — tell browsers to only ever reach this origin over HTTPS.
app.use((_req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/trainings', trainingRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/settings', settingsRoutes);

// Serve the built SPA from the same HTTPS origin (production). In dev the SPA is served by Vite,
// and `frontend/dist` may not exist — so only mount this when a build is present.
const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Generic error handler so unhandled rejections surface as JSON.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  },
);

seed()
  .then(async () => {
    const creds = await ensureCredentials();
    const server = https.createServer({ key: creds.key, cert: creds.cert, ca: creds.ca }, app);
    registerHttpsServer(server);
    server.listen(HTTPS_PORT, () => {
      console.log(`🔒 BrainGain served over HTTPS at https://localhost:${HTTPS_PORT}`);
    });

    // HTTP listener: redirect everything to HTTPS (no app content is served over HTTP).
    http
      .createServer((req, res) => {
        const host = (req.headers.host ?? `localhost:${HTTP_PORT}`).split(':')[0];
        const suffix = HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`;
        res.writeHead(308, { Location: `https://${host}${suffix}${req.url ?? '/'}` });
        res.end();
      })
      .listen(HTTP_PORT, () => {
        console.log(`↪  HTTP ${HTTP_PORT} redirects (308) to HTTPS`);
      });
  })
  .catch((err) => {
    console.error('Failed to seed/start:', err);
    process.exit(1);
  });
