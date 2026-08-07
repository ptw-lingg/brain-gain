// Shared helpers for handling untrusted filenames and ids arriving over HTTP, and for sending a file
// as a download. Used by every route that accepts an upload name or serves stored bytes, so the
// fiddly quoting and the path-traversal guard have exactly one owner.

import type { Response } from 'express';

/**
 * Server-issued ids are UUIDs. Validating a path segment against this allowlist is what keeps a
 * crafted id from escaping the directory it names — a UUID cannot contain '/', '\' or '..'.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep only a base filename — defeats path traversal and header injection via an upload name. */
export function sanitizeFileName(raw: unknown, fallback = 'file'): string {
  const base = (typeof raw === 'string' ? raw : fallback).split(/[/\\]/).pop() ?? fallback;
  const cleaned = base.replace(/[\r\n"]/g, '').trim();
  return cleaned.slice(0, 255) || fallback;
}

/**
 * Send bytes as a download. The filename goes out twice — an ASCII-folded form for old clients and
 * the RFC 5987 `filename*` form for everything else — so non-ASCII names survive intact.
 */
export function sendAttachment(res: Response, bytes: Buffer, fileName: string, contentType: string): void {
  const safeAscii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Type', contentType || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.setHeader('Content-Length', String(bytes.length));
  res.end(bytes);
}
