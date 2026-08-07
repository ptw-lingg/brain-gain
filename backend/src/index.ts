import express from 'express';
import cors from 'cors';
import http from 'http';
import https from 'https';
import path from 'path';
import { existsSync } from 'fs';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import roleRoutes from './routes/roles';
import orgUnitRoutes from './routes/orgUnits';
import trainingRoutes from './routes/trainings';
import sessionRoutes from './routes/sessions';
import settingsRoutes from './routes/settings';
import mailRoutes from './routes/mail';
import backupRoutes from './routes/backups';
import { seed } from './seed';
import { migrateOrgUnits } from './services/orgUnits';
import { migrateQuestions } from './services/questions';
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
app.use('/api/org-units', orgUnitRoutes);
app.use('/api/trainings', trainingRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/backups', backupRoutes);

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

// Bind a server, retrying briefly on EADDRINUSE instead of crashing. During a `tsx watch` reload the
// previous process may not have released the port yet; retry for a short window, then give up.
function listenWithRetry(
  server: http.Server | https.Server,
  port: number,
  onListening: () => void,
  retries = 20,
  delayMs = 250,
): void {
  let remaining = retries;
  server.on('listening', onListening);
  server.on('error', (err: Error) => {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && remaining > 0) {
      if (remaining === retries) {
        console.warn(`⏳ Port ${port} is busy (likely a reload in flight) — retrying…`);
      }
      remaining -= 1;
      setTimeout(() => server.listen(port), delayMs);
      return;
    }
    console.error(`Failed to bind port ${port}:`, err.message);
    process.exit(1);
  });
  server.listen(port);
}

seed()
  .then(() => migrateOrgUnits())
  .then(() => migrateQuestions())
  .then(async () => {
    const creds = await ensureCredentials();
    const httpsServer = https.createServer({ key: creds.key, cert: creds.cert, ca: creds.ca }, app);
    registerHttpsServer(httpsServer);
    listenWithRetry(httpsServer, HTTPS_PORT, () => {
      console.log(`🔒 BrainGain served over HTTPS at https://localhost:${HTTPS_PORT}`);
    });

    // HTTP listener: redirect everything to HTTPS (no app content is served over HTTP).
    const httpRedirect = http.createServer((req, res) => {
      const host = (req.headers.host ?? `localhost:${HTTP_PORT}`).split(':')[0];
      const suffix = HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`;
      res.writeHead(308, { Location: `https://${host}${suffix}${req.url ?? '/'}` });
      res.end();
    });
    listenWithRetry(httpRedirect, HTTP_PORT, () => {
      console.log(`↪  HTTP ${HTTP_PORT} redirects (308) to HTTPS`);
    });

    // On a watch-reload or Ctrl-C, close both servers so their ports free up before the next
    // process binds; force-exit if a lingering keep-alive connection holds them open.
    const shutdown = (signal: string): void => {
      console.log(`${signal} received — closing servers.`);
      let pending = 2;
      const done = (): void => {
        pending -= 1;
        if (pending <= 0) process.exit(0);
      };
      httpsServer.close(done);
      httpRedirect.close(done);
      setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  })
  .catch((err) => {
    console.error('Failed to seed/start:', err);
    process.exit(1);
  });
