// Client-side downscaling for the training cover image: the card shows it at ~250 px wide, so a
// multi-megapixel photo is scaled to fit 800 × 450 and re-encoded as JPEG BEFORE upload — small
// payloads, small backups, no image library on the server. Transparent areas land on white.

export const PREVIEW_IMAGE_MAX_WIDTH = 800;
export const PREVIEW_IMAGE_MAX_HEIGHT = 450;
export const PREVIEW_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image could not be decoded'));
    };
    img.src = url;
  });
}

/** Scale `file` to fit the cover box and return it as a JPEG blob. Throws when it is not an image. */
export async function downscalePreviewImage(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, PREVIEW_IMAGE_MAX_WIDTH / img.naturalWidth, PREVIEW_IMAGE_MAX_HEIGHT / img.naturalHeight);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encoding failed'))), 'image/jpeg', 0.86);
  });
}

// Profile pictures are shown at most ~64 px, so 128 px keeps them sharp on HiDPI at ~5–10 KB.
export const AVATAR_SIZE = 128;

/** Centre-crop `file` to a square, scale it to AVATAR_SIZE and return a JPEG data URL. Throws when it is not an image. */
export async function fileToAvatar(file: Blob): Promise<string> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return canvas.toDataURL('image/jpeg', 0.85);
}
