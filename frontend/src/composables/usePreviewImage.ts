// Resolve a training's preview-image upload to a displayable URL. The bytes sit behind the
// authenticated material endpoint, which an <img src> cannot reach (no Authorization header), so
// they are fetched through the axios client and handed to the image as a blob: URL. One fetch per
// file id for the app's lifetime — the dashboard renders the same covers on every visit and the
// object URLs are tiny, so nothing is revoked.

import { computed, ref, watch, type Ref } from 'vue';
import client from '@/api/client';

const urls = new Map<string, Promise<string | null>>();

function fetchUrl(fileId: string): Promise<string | null> {
  let pending = urls.get(fileId);
  if (!pending) {
    pending = client
      .get<Blob>(`/trainings/materials/${fileId}`, { responseType: 'blob' })
      .then(({ data }) => URL.createObjectURL(data))
      .catch(() => {
        urls.delete(fileId); // a failed fetch may be retried on the next mount
        return null;
      });
    urls.set(fileId, pending);
  }
  return pending;
}

/** Reactive blob: URL for the given upload id (null while loading, when absent, or on failure). */
export function usePreviewImage(fileId: Ref<string | null | undefined>): Ref<string | null> {
  const url = ref<string | null>(null);
  watch(
    fileId,
    (id) => {
      url.value = null;
      if (!id) return;
      void fetchUrl(id).then((resolved) => {
        // Ignore a late answer for an id the caller has moved away from.
        if (fileId.value === id) url.value = resolved;
      });
    },
    { immediate: true },
  );
  return computed(() => url.value);
}
