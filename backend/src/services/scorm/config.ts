// SCORM deployment configuration — the second (content) origin and the kill switch. Read once at
// boot. The frontend NEVER computes or hardcodes these: the launch response carries the resolved
// content origin, and the player pins every postMessage to it.

export const SCORM_ENABLED = process.env.SCORM_ENABLED !== '0' && process.env.SCORM_ENABLED !== 'false';

/** Port of the second HTTPS listener that serves package content on its own origin. */
export const SCORM_CONTENT_PORT = Number(process.env.SCORM_CONTENT_PORT) || 3002;

/**
 * The app origin as browsers see it — needed for the content origin's frame-ancestors and for the
 * wrapper's postMessage target. In production (express serves the SPA) it derives from the request
 * host; in dev the SPA lives on Vite's own HTTPS port, so APP_ORIGIN MUST be set explicitly there
 * (e.g. https://localhost:5173) or the content origin will refuse to be framed.
 */
export function appOrigin(requestHost: string | undefined, httpsPort: number): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN;
  const host = (requestHost ?? 'localhost').split(':')[0];
  return `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}`;
}

/**
 * The content origin handed to the player in the launch response. Prefer an explicit
 * SCORM_CONTENT_ORIGIN (a genuinely different hostname is more robustly isolated than a port);
 * otherwise derive host-from-request + the content port — mirroring how the HTTP→HTTPS redirect
 * derives its target.
 */
export function contentOrigin(requestHost: string | undefined): string {
  if (process.env.SCORM_CONTENT_ORIGIN) return process.env.SCORM_CONTENT_ORIGIN;
  const host = (requestHost ?? 'localhost').split(':')[0];
  return `https://${host}:${SCORM_CONTENT_PORT}`;
}
