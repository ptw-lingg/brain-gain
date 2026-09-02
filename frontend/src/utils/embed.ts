// Which learning materials BrainGain can show INSIDE the app, and how to render them.
//
// The two material sources differ fundamentally in what we control:
//
//  - UPLOADED FILES — we serve the bytes ourselves, so anything the browser renders natively can be
//    shown reliably. The bytes are fetched with the Authorization header into a blob: URL first (an
//    <iframe>/<video> cannot send that header on its own). A blob: URL inherits the APP's origin,
//    so anything that could execute script there (HTML, SVG) is deliberately NOT embeddable — it
//    stays a download.
//
//  - LINKS — only the target host decides whether it may be framed. Any response carrying
//    X-Frame-Options or a frame-ancestors CSP refuses, and script CANNOT detect that: the frame just
//    stays blank (the load event fires either way). So a link is embedded only when it points
//    DIRECTLY at a document or media file, and opens in a new tab otherwise. Even then the viewer
//    always offers "open in new tab", because the host may still refuse.

import type { MaterialFile, MaterialVariant } from '@/types';

/** How the viewer renders a material: an iframe (documents) or a native media element. */
export type EmbedKind = 'pdf' | 'image' | 'video' | 'audio' | 'text';

/** Native media elements beat an iframe for these: real controls, and X-Frame-Options never applies. */
export const MEDIA_KINDS: readonly EmbedKind[] = ['image', 'video', 'audio'];

const EXTENSION_KIND: [RegExp, EmbedKind][] = [
  [/\.pdf$/i, 'pdf'],
  [/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i, 'image'],
  [/\.(mp4|m4v|webm|ogv|mov)$/i, 'video'],
  [/\.(mp3|m4a|wav|oga|ogg|flac|aac)$/i, 'audio'],
  [/\.(txt|log|csv)$/i, 'text'],
];

const MIME_KIND: [RegExp, EmbedKind][] = [
  [/^application\/pdf$/i, 'pdf'],
  [/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon)$/i, 'image'], // svg+xml excluded on purpose
  [/^video\//i, 'video'],
  [/^audio\//i, 'audio'],
  [/^text\/(plain|csv)$/i, 'text'],
];

/**
 * Sharing links from SharePoint / OneDrive: they END in .pdf or .mp4 but serve an AUTHENTICATED
 * HTML viewer page (`/:b:/` document, `/:v:/` video, `/:w:/` Word, …, or an explicit `?web=1`),
 * which sends X-Frame-Options and would need the viewer's own session cookies in a third-party
 * frame. They are pages, not files — treat them as such so they keep opening in a new tab where
 * they actually work, instead of embedding into a permanently blank frame.
 */
const HOSTED_VIEWER = /\/:[a-z]:\/|[?&]web=1(?:&|$)/i;

/** Strip the query/fragment so the extension test sees the real path. */
function pathOf(url: string): string {
  try {
    return new URL(url, window.location.href).pathname;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/** True when the URL is on another origin — the only case where sandboxing may grant same-origin. */
export function isCrossOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** How an embedded link should render, or null when it must open in a new tab instead. */
export function linkEmbedKind(url: string): EmbedKind | null {
  if (!/^https?:/i.test(url.trim())) return null; // mailto:, file:, … are not ours to render
  if (HOSTED_VIEWER.test(url)) return null;
  const path = pathOf(url);
  return EXTENSION_KIND.find(([re]) => re.test(path))?.[1] ?? null;
}

/** How an embedded uploaded file should render, or null when it stays a download. */
export function fileEmbedKind(file: MaterialFile): EmbedKind | null {
  // The browser-reported type wins; a missing/blank one falls back to the filename.
  const byMime = file.type ? MIME_KIND.find(([re]) => re.test(file.type))?.[1] : undefined;
  if (byMime) return byMime;
  if (file.type && !/^application\/octet-stream$/i.test(file.type)) return null; // a real, non-embeddable type
  return EXTENSION_KIND.find(([re]) => re.test(file.name))?.[1] ?? null;
}

/** How a material variant should render in the app, or null when it opens/downloads as before. */
export function variantEmbedKind(v: MaterialVariant): EmbedKind | null {
  if (v.file) return fileEmbedKind(v.file);
  if (v.url) return linkEmbedKind(v.url);
  return null;
}

/**
 * The iframe sandbox for embedded material. `allow-same-origin` is granted ONLY for cross-origin
 * sources, where it merely gives the content its own (foreign) origin; for a same-origin or blob:
 * source it would hand the content our origin — and with allow-scripts that is a sandbox escape.
 * `allow-top-navigation` is never granted: framed content must not be able to navigate the app away.
 */
export function materialSandbox(src: string): string {
  const tokens = ['allow-scripts', 'allow-popups', 'allow-downloads', 'allow-forms'];
  if (/^https?:/i.test(src) && isCrossOrigin(src)) tokens.splice(1, 0, 'allow-same-origin');
  return tokens.join(' ');
}
