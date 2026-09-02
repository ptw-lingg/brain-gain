// Security response headers for BOTH origins. Hand-rolled rather than helmet: the two policies are
// origin-parameterised at runtime (each origin must name the other), the codebase already sets
// headers directly (HSTS in index.ts), and a runtime dependency in the SBOM buys nothing here.
//
// App origin: a strict policy — the SPA runs only its own code, frames only the content origin,
// and cannot be framed at all (clickjacking is a real attack here: a package could otherwise frame
// the app and overlay the signature dialog).
// Content origin: permissive about EXECUTING (authoring-tool output is full of inline script,
// new Function and blob workers — the isolation comes from the origin boundary and the sandbox,
// not this CSP) but restrictive about EGRESS: connect-src 'self' is what stops package JS
// exfiltrating suspend_data to an attacker host.

import type { NextFunction, Request, Response } from 'express';
import { SCORM_SANDBOX } from '../scorm/protocol';

// The app CSP defaults to Report-Only so a policy gap can never take the app down; set
// CSP_ENFORCE=1 once the report-only phase (one release / a full e2e run) is clean. The companion
// headers below are always enforced — they carry the clickjacking/sniffing protections.
const CSP_ENFORCE = process.env.CSP_ENFORCE === '1' || process.env.CSP_ENFORCE === 'true';

/** Strict policy for the app origin. `contentOriginFor` names the only origin the SPA may frame
 *  (host-derived, matching how the HTTP→HTTPS redirect derives its target); '' = SCORM disabled. */
export function appSecurityHeaders(contentOriginFor: (host: string | undefined) => string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const frameSrc = contentOriginFor(req.headers.host) || "'none'";
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      // 'unsafe-inline' for styles only: Vue :style bindings and Tailwind arbitrary values need it;
      // scripts never get it. Google Fonts' stylesheet is loaded from index.html.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // https: on img/media/frame carries the learning-material viewer, which renders
      // trainer-supplied documents and videos in place: uploaded files through blob: (fetched with
      // the auth header), and links pointing straight at a file on their own host. The app is not
      // exposed by it — media elements execute nothing, and a framed document is cross-origin and
      // sandboxed WITHOUT allow-top-navigation (see frontend utils/embed.ts), labelled third-party
      // in the viewer chrome. Uploaded files never enter a frame at all — the app renders them itself.
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "media-src 'self' blob: https:",
      "worker-src 'self' blob:",
      // MSAL's endpoints for SSO sign-in and the SR-173 re-authentication popup.
      "connect-src 'self' https://login.microsoftonline.com https://*.login.microsoftonline.com https://graph.microsoft.com",
      `frame-src 'self' https: ${frameSrc}`,
      `child-src 'self' https: ${frameSrc}`,
      'upgrade-insecure-requests',
    ].join('; ');
    res.setHeader(CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', csp);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // same-origin-allow-popups, NOT same-origin: plain same-origin severs the popup↔opener
    // relationship and breaks the MSAL re-auth popup — which is on the SR-173 completion-signature
    // critical path. An easy way to break signatures while "hardening"; don't.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()',
    );
    next();
  };
}

/**
 * Policy for the content origin's package responses. `allowExternal` (per package, trainer-set,
 * default off) widens the egress directives to https: for courses that genuinely need a CDN or
 * telemetry endpoint. The CSP `sandbox` directive is included so the same flags apply when a
 * leaked launch URL is opened TOP-LEVEL, and it must stay byte-identical to the player's iframe
 * attribute (one exported constant, SCORM_SANDBOX — an e2e spec asserts they match).
 */
export function contentSecurityHeaders(res: Response, appOrigin: string, allowExternal: boolean): void {
  const ext = allowExternal ? ' https:' : '';
  const csp = [
    "default-src 'self' blob: data:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:",
    "style-src 'self' 'unsafe-inline' data: blob:",
    `img-src 'self' data: blob:${ext}`,
    `media-src 'self' data: blob:${ext}`,
    `font-src 'self' data:${ext}`,
    "worker-src 'self' blob:",
    "object-src 'self'", // legacy packages still <embed> PDFs/SVGs from within the package
    "frame-src 'self'",
    `connect-src 'self'${ext}`,
    "form-action 'self'",
    "base-uri 'self'",
    // The app frames the wrapper; the wrapper frames the SCO (same content origin) — both must be
    // allowed, so 'self' AND the app origin. No third party can frame package pages.
    `frame-ancestors ${appOrigin} 'self'`,
    `sandbox ${SCORM_SANDBOX}`,
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Keeps the launch token out of Referer on every outbound request a course makes — a package
  // loading a Google Font would otherwise ship the token to a third party.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
