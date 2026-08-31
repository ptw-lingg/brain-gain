// Typed SCORM API calls (main origin, Bearer via the shared axios client). The commit path also
// has a keepalive variant for pagehide — axios cannot set `keepalive`, so that one uses fetch with
// the same Authorization header.

import client from '@/api/client';
import type { ScormLaunch } from '@/types';

export async function launchScorm(trainingId: string, restart = false): Promise<ScormLaunch> {
  const { data } = await client.post<ScormLaunch>('/sessions/scorm/launch', { trainingId, restart });
  return data;
}

export interface ScormCommitResult {
  errors: [string, number][];
  completion: string;
  success: string;
  scaled: number | null;
  terminated: boolean;
}

export async function commitScorm(
  attemptId: string,
  body: { values: Record<string, string>; terminate?: boolean; exit?: string },
): Promise<ScormCommitResult> {
  const { data } = await client.post<ScormCommitResult>(`/sessions/scorm/attempts/${attemptId}/commit`, body);
  return data;
}

/**
 * The last-gasp flush on pagehide: fetch with keepalive survives the closing tab (sendBeacon is
 * unusable — it cannot carry the Authorization header). Its body limit is 64 KB across all
 * in-flight keepalive requests, which is why callers trim to the completion-relevant subset.
 */
export function commitScormKeepalive(
  attemptId: string,
  body: { values: Record<string, string>; terminate?: boolean; exit?: string },
): void {
  const token = localStorage.getItem('token');
  void fetch(`/api/sessions/scorm/attempts/${attemptId}/commit`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}
