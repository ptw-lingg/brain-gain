// Fetch bytes from the API with the auth header and save them as a file. Used wherever the server
// streams an attachment (learning-material files, backup archives) — the browser cannot follow such a
// URL directly because it would carry no Authorization header.
import client from '@/api/client';

/** The filename the server asked for in Content-Disposition, if it sent one. */
function serverFileName(disposition: unknown): string | null {
  if (typeof disposition !== 'string') return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* fall through to the ASCII form */
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] ?? null;
}

/**
 * Download `url` and save it. The server's Content-Disposition name wins when present — it is the
 * authoritative one — with `fallbackName` used only when the response carries none.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await client.get(url, { responseType: 'blob' });
  const name = serverFileName(res.headers?.['content-disposition']) ?? fallbackName;
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/**
 * Fetch `url` with the auth header and expose the bytes as a blob: URL, so an <iframe>/<video> can
 * render them — those elements issue their own request and cannot carry an Authorization header.
 * The caller OWNS the returned URL and must URL.revokeObjectURL() it when the viewer closes.
 * Note the blob: URL inherits the app's origin; only types that cannot execute script there are
 * ever rendered this way (see utils/embed.ts).
 */
export async function fetchBlobUrl(url: string): Promise<string> {
  const res = await client.get(url, { responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}

/** Message from a failed API call, unwrapping the Blob body that a responseType:'blob' error carries. */
export async function apiErrorMessage(err: unknown): Promise<string> {
  const data = (err as { response?: { data?: unknown } }).response?.data;
  if (data instanceof Blob) {
    try {
      return (JSON.parse(await data.text()) as { error?: string }).error ?? '';
    } catch {
      return '';
    }
  }
  return (data as { error?: string } | undefined)?.error ?? '';
}
