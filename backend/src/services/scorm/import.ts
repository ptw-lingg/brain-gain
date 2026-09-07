// SCORM package import: unzip → census → locate + parse imsmanifest.xml → validate → extract to
// DATA_DIR/scorm/<packageId>/ → persist the descriptor. The archive is ATTACKER-SUPPLIED: every
// entry path is validated before anything touches the filesystem (zip-slip), symlinks and
// encrypted entries are rejected, and the size caps are re-checked DURING extraction so a lying
// central directory cannot get past the census. On any failure the half-extracted directory is
// deleted — an import either completes or leaves nothing.

import { createHash, randomUUID } from 'crypto';
import JSZip from 'jszip';
import type { ScormPackageRef } from '../../types';
import {
  deleteScormPackageFiles,
  readStore,
  resolveScormEntry,
  writeScormEntry,
  writeStore,
} from '../fileStore';
import { PREVIEW_IMAGE_MAX_BYTES } from '../materials';
import { parseManifest, ScormManifestError } from './manifest';
import { META_XML_MAX_BYTES, META_XML_NAME, pickThumbnailCandidate } from './thumbnail';

/** An unusable upload → HTTP 422 with a stable `code` the frontend maps to an i18n string. */
export class ScormImportError extends Error {
  constructor(readonly code: string, message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'ScormImportError';
  }
}

export const IMPORT_LIMITS = {
  maxFiles: 2000,
  maxTotalUncompressedBytes: 500 * 1024 * 1024,
  maxEntryBytes: 200 * 1024 * 1024,
  maxManifestBytes: 4 * 1024 * 1024,
  maxPathLength: 400,
  maxDepth: 20,
  // A zip whose contents inflate to >200× its size (and past 50 MB) is a bomb, not a course.
  suspiciousRatio: 200,
  suspiciousRatioMinBytes: 50 * 1024 * 1024,
} as const;

const MANIFEST_NAME = 'imsmanifest.xml';

interface CensusEntry {
  name: string; // path as stored in the archive (normalized to forward slashes)
  rel: string; // path relative to the package root (the manifest's directory)
  entry: JSZip.JSZipObject;
}

/** True when the zip entry's unix mode says "symbolic link" (its content is the target path —
 *  extracting it as a file is harmless, but restoring it into a tree is exactly the shape we ban). */
const isSymlink = (entry: JSZip.JSZipObject): boolean => {
  const perms = (entry as unknown as { unixPermissions?: number | null }).unixPermissions;
  return typeof perms === 'number' && (perms & 0xf000) === 0xa000;
};

/**
 * The cover-image CANDIDATE inside the archive (rules in ./thumbnail.ts): the Storyline meta.xml is
 * read from the zip here; the size cap is enforced by the caller once the bytes inflate.
 */
async function detectThumbnail(rebased: Map<string, CensusEntry>, packageId: string): Promise<string | undefined> {
  const meta = rebased.get(META_XML_NAME);
  let metaXml: string | undefined;
  if (meta) {
    try {
      const xml = await meta.entry.async('string');
      if (xml.length <= META_XML_MAX_BYTES) metaXml = xml;
    } catch {
      // Vendor metadata — unreadable simply means "no hint"; the manifest is what must parse.
    }
  }
  return pickThumbnailCandidate(packageId, rebased.keys(), metaXml);
}

export async function importScormPackage(args: {
  zipBytes: Buffer;
  uploadedBy: string;
  originalFileName: string;
}): Promise<ScormPackageRef> {
  const { zipBytes, uploadedBy, originalFileName } = args;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBytes);
  } catch {
    throw new ScormImportError('not-a-zip', 'Not a readable ZIP archive');
  }

  // ── Census: validate every entry name BEFORE extracting anything ────────────────────────────────
  const names = Object.entries(zip.files)
    .filter(([, entry]) => !entry.dir)
    .map(([name, entry]) => ({ name: name.replace(/\\/g, '/'), entry }));

  if (names.length === 0) throw new ScormImportError('not-a-zip', 'The ZIP archive is empty');
  if (names.length > IMPORT_LIMITS.maxFiles) {
    throw new ScormImportError('too-many-entries', `Package has too many files (max ${IMPORT_LIMITS.maxFiles})`);
  }
  for (const { name, entry } of names) {
    if (name.length > IMPORT_LIMITS.maxPathLength) {
      throw new ScormImportError('path-traversal', 'Package contains a file path that is too long', [name.slice(0, 200)]);
    }
    if (isSymlink(entry)) {
      throw new ScormImportError('symlink', 'Package contains a symbolic link', [name]);
    }
    const segments = name.split('/');
    if (
      name.startsWith('/') ||
      /^[a-zA-Z]:/.test(name) ||
      name.startsWith('//') ||
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1f\x7f]/.test(name) ||
      segments.some((s) => s === '' || s === '.' || s === '..')
    ) {
      throw new ScormImportError('path-traversal', 'Package contains an unsafe file path', [name.slice(0, 200)]);
    }
    if (segments.length > IMPORT_LIMITS.maxDepth) {
      throw new ScormImportError('path-traversal', 'Package directory nesting is too deep', [name.slice(0, 200)]);
    }
  }

  // ── Locate the manifest: at the root, or exactly one directory level deep ───────────────────────
  // (several authoring tools wrap their export in a single folder). The manifest's directory
  // becomes the package root; entries outside it are discarded, paths re-based onto it.
  const manifestCandidates = names.filter(
    ({ name }) =>
      name.toLowerCase() === MANIFEST_NAME ||
      (name.toLowerCase().endsWith(`/${MANIFEST_NAME}`) && name.split('/').length === 2),
  );
  if (manifestCandidates.length === 0) {
    // cmi5/xAPI packages get uploaded and mislabelled as SCORM constantly — say so specifically.
    const otherStandard = names.find(({ name }) => /(^|\/)(cmi5\.xml|tincan\.xml)$/i.test(name));
    if (otherStandard) {
      throw new ScormImportError(
        'cmi5-not-scorm',
        'This is a cmi5/xAPI package, not SCORM — export it as SCORM 1.2 or 2004 instead',
      );
    }
    throw new ScormImportError('no-manifest', 'imsmanifest.xml not found in the package');
  }
  if (manifestCandidates.length > 1) {
    throw new ScormImportError('bad-manifest', 'Package contains more than one imsmanifest.xml');
  }
  const manifestEntry = manifestCandidates[0];
  const rootPrefix = manifestEntry.name.includes('/')
    ? manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf('/') + 1)
    : '';

  // ── Parse the manifest ───────────────────────────────────────────────────────────────────────────
  let manifestXml: string;
  try {
    manifestXml = await manifestEntry.entry.async('string');
  } catch {
    throw new ScormImportError('encrypted', 'Package entries are encrypted — encrypted ZIPs are not supported');
  }
  if (Buffer.byteLength(manifestXml, 'utf-8') > IMPORT_LIMITS.maxManifestBytes) {
    throw new ScormImportError('bad-manifest', 'imsmanifest.xml is too large');
  }
  let info;
  try {
    info = parseManifest(manifestXml);
  } catch (err) {
    if (err instanceof ScormManifestError) throw new ScormImportError(err.code, err.message, err.details);
    throw err;
  }

  // ── Resolve + verify the entry file within the archive ─────────────────────────────────────────
  const packageId = randomUUID();
  const entryHref = info.entryHref;
  if (!entryHref || resolveScormEntry(packageId, entryHref) === null) {
    throw new ScormImportError('path-traversal', `The course launch path is unsafe: ${entryHref.slice(0, 200)}`);
  }
  if (!/\.(html?|xhtml)$/i.test(entryHref)) {
    // We iframe the entry — a .swf/.exe entry point is unplayable, and failing at import (with the
    // real path in hand) beats failing at launch. Also blocks a javascript:/data: href outright.
    throw new ScormImportError('entry-not-html', `The launch file must be an HTML page (got "${entryHref.slice(0, 200)}")`);
  }
  const rebased = new Map<string, CensusEntry>();
  for (const { name, entry } of names) {
    if (rootPrefix && !name.startsWith(rootPrefix)) continue; // outside the package root — discarded
    const rel = name.slice(rootPrefix.length);
    if (rel) rebased.set(rel, { name, rel, entry });
  }
  if (!rebased.has(entryHref)) {
    throw new ScormImportError('entry-missing', `Entry file "${entryHref.slice(0, 200)}" is missing from the package`);
  }

  // The cover candidate is resolved before extraction (it reads meta.xml from the archive); its
  // size is checked as its bytes inflate below.
  let thumbnailHref = await detectThumbnail(rebased, packageId);

  // ── Extract, re-checking sizes as bytes actually inflate ────────────────────────────────────────
  let totalBytes = 0;
  let fileCount = 0;
  try {
    for (const { rel, entry } of rebased.values()) {
      let bytes: Buffer;
      try {
        bytes = await entry.async('nodebuffer');
      } catch {
        throw new ScormImportError('encrypted', 'Package entries are encrypted — encrypted ZIPs are not supported');
      }
      if (bytes.length > IMPORT_LIMITS.maxEntryBytes) {
        throw new ScormImportError('uncompressed-too-large', 'A single package file is too large (max 200 MB)');
      }
      if (rel === thumbnailHref && bytes.length > PREVIEW_IMAGE_MAX_BYTES) thumbnailHref = undefined;
      totalBytes += bytes.length;
      if (totalBytes > IMPORT_LIMITS.maxTotalUncompressedBytes) {
        throw new ScormImportError('uncompressed-too-large', 'Package is too large when unpacked (max 500 MB)');
      }
      if (
        totalBytes > IMPORT_LIMITS.suspiciousRatioMinBytes &&
        totalBytes / zipBytes.length > IMPORT_LIMITS.suspiciousRatio
      ) {
        throw new ScormImportError('ratio-suspicious', 'Package inflates suspiciously — refused as a zip bomb');
      }
      await writeScormEntry(packageId, rel, bytes);
      fileCount += 1;
    }
  } catch (err) {
    await deleteScormPackageFiles(packageId); // never leave a half-extracted directory
    throw err;
  }

  const ref: ScormPackageRef = {
    packageId,
    title: info.title,
    version: info.scormVersion,
    entryHref,
    ...(info.parameters ? { launchParameters: info.parameters } : {}),
    masteryScore: info.masteryScore,
    ...(info.dataFromLms ? { dataFromLms: info.dataFromLms } : {}),
    manifestIdentifier: info.identifier,
    thumbnailHref: thumbnailHref ?? null, // always written: null = scanned, nothing qualifies
    fileCount,
    bytes: totalBytes,
    sha256: createHash('sha256').update(zipBytes).digest('hex'),
    originalFileName,
    uploadedBy,
    uploadedAt: new Date().toISOString(),
    completionRule: 'status',
    allowExternal: false,
  };

  const packages = await readStore<ScormPackageRef>('scormPackages');
  packages.push(ref);
  await writeStore('scormPackages', packages);
  return ref;
}
