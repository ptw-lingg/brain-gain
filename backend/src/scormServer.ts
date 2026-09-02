// The CONTENT origin — a second, deliberately dumb express app on its own HTTPS listener (default
// :3102) that serves nothing but SCORM package files and the wrapper/shim. Untrusted package
// HTML/JS executes on THIS origin, which is why it must hold nothing: it imports no auth
// middleware and no route modules, never sets a cookie, answers /api/* with 404 by construction,
// and sends no CORS headers — so package script cannot read app APIs even if it tries.
//
// Requests are authorized by the launch token in the URL PATH (/s/<token>/…): verified
// per-request, then checked against the live attempt (read-only!) so the URL dies the moment the
// attempt terminates or is signed — that revocation is what makes the multi-hour token TTL safe.

import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import type { ScormAttemptFile, ScormPackageRef } from './types';
import { readScormAttemptFile, readStore, resolveScormEntry } from './services/fileStore';
import { verifyLaunchToken } from './services/scorm/launch';
import { contentTypeFor } from './services/scorm/mime';
import { contentSecurityHeaders } from './middleware/securityHeaders';
import { appOrigin } from './services/scorm/config';

const HTTPS_PORT = Number(process.env.HTTPS_PORT) || Number(process.env.PORT) || 3101;
const SHIM_DIR = path.join(__dirname, 'scorm', 'shim');

// Per-request lookups are one small file/store read each; a 2 s cache keeps a media-heavy course
// (hundreds of asset requests) from hammering the disk while staying fresh enough that a signed or
// terminated attempt loses its URL within seconds.
const CACHE_TTL_MS = 2000;
const attemptCache = new Map<string, { at: number; file: ScormAttemptFile | null }>();
const packageCache = new Map<string, { at: number; pkg: ScormPackageRef | null }>();

async function cachedAttempt(attemptId: string): Promise<ScormAttemptFile | null> {
  const hit = attemptCache.get(attemptId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.file;
  const file = await readScormAttemptFile<ScormAttemptFile>(attemptId);
  attemptCache.set(attemptId, { at: Date.now(), file });
  if (attemptCache.size > 1000) attemptCache.clear(); // crude bound; refilled on demand
  return file;
}

async function cachedPackage(packageId: string): Promise<ScormPackageRef | null> {
  const hit = packageCache.get(packageId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.pkg;
  const packages = await readStore<ScormPackageRef>('scormPackages');
  const pkg = packages.find((p) => p.packageId === packageId) ?? null;
  packageCache.set(packageId, { at: Date.now(), pkg });
  if (packageCache.size > 1000) packageCache.clear();
  return pkg;
}

/** Escape for embedding JSON into an HTML <script> block: '<' must not open a tag. */
const jsonForHtml = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\u003c');

export function createScormApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => void res.json({ ok: true }));

  // Explicit: no API lives on this origin, ever — even if a future refactor mounts something here.
  app.use('/api', (_req, res) => void res.status(404).end());

  app.get('/s/:token/*', async (req, res) => {
    const claims = verifyLaunchToken(req.params.token);
    if (!claims) return res.status(403).json({ error: 'Forbidden' });

    // Revocation: the token is only as alive as its attempt (READ-ONLY lookups — the content
    // origin never writes app state).
    const file = await cachedAttempt(claims.aid);
    const attempt = file?.attempt;
    if (
      !attempt ||
      attempt.status !== 'in-progress' ||
      attempt.consumedBySessionId ||
      attempt.packageId !== claims.pid ||
      attempt.userId !== claims.sub
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const pkg = await cachedPackage(claims.pid);
    if (!pkg) return res.status(403).json({ error: 'Forbidden' });

    contentSecurityHeaders(res, appOrigin(req.headers.host, HTTPS_PORT), pkg.allowExternal);

    const rel = (req.params as unknown as Record<string, string>)[0] ?? '';

    if (rel === '_lms/wrapper.html') {
      const params = pkg.launchParameters
        ? pkg.launchParameters.startsWith('?')
          ? pkg.launchParameters
          : `?${pkg.launchParameters}`
        : '';
      const cfg = {
        appOrigin: appOrigin(req.headers.host, HTTPS_PORT),
        nonce: claims.jti,
        attemptId: claims.aid,
        // Relative to _lms/, so the token path prefix rides along without the wrapper knowing it.
        // Assigned to iframe.src as a property by the wrapper — entryHref is manifest-derived
        // (untrusted) and must never be interpolated into markup.
        entryUrl: `../${encodeURI(pkg.entryHref)}${params}`,
        version: pkg.version,
      };
      const html = (await fs.readFile(path.join(SHIM_DIR, 'wrapper.html'), 'utf-8'))
        .split('__CFG_JSON__')
        .join(jsonForHtml(cfg));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    if (rel === '_lms/scorm-api.js') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      return res.send(await fs.readFile(path.join(SHIM_DIR, 'scorm-api.js'), 'utf-8'));
    }

    const abs = resolveScormEntry(claims.pid, rel);
    if (!abs) return res.status(403).json({ error: 'Forbidden' });
    res.setHeader('Content-Type', contentTypeFor(abs));
    // sendFile streams from disk (O(1) memory) and answers Range requests — Chrome requires Range
    // to seek <video>, which authoring-tool output uses heavily.
    return res.sendFile(abs, { dotfiles: 'deny', acceptRanges: true }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  app.use((_req, res) => void res.status(404).end());
  return app;
}
