// The cover-image CANDIDATE of a SCORM package. Neither SCORM nor LOM defines a cover, so two vendor
// conventions are read, in order: Articulate Storyline's meta.xml at the package root
// (`<project thumburl="…">` — the course's first slide), then a conventionally named image file
// (thumbnail/thumb/poster/cover/preview.*), shallowest path first. A candidate must be a package
// entry with a raster extension (never SVG — the learner's browser renders the cover inline), pass
// the same containment check as every other entry, and stay under the preview-image size cap.
// The candidate is only OFFERED to the trainer in the editor; nothing applies it on its own.
//
// Two entry points share the rules: the import (which has the archive in hand) and the boot-time
// migration that backfills packages imported before the field existed by scanning their extracted
// directory.

import { promises as fs } from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { ScormPackageRef } from '../../types';
import { readStore, resolveScormEntry, scormPackageDir, writeStore } from '../fileStore';
import { PREVIEW_IMAGE_MAX_BYTES } from '../materials';

export const THUMBNAIL_EXT = /\.(png|jpe?g|webp|gif)$/i;
const THUMBNAIL_NAME = /(^|\/)(thumbnail|thumb|poster|cover|preview)\.(png|jpe?g|webp|gif)$/i;
export const META_XML_NAME = 'meta.xml';
export const META_XML_MAX_BYTES = 256 * 1024;

/** The `thumburl` Storyline writes into meta.xml, normalized to a POSIX-relative path; else undefined. */
export function thumbnailHintFromMeta(xml: string): string | undefined {
  const text = xml.replace(/^﻿/, '');
  if (text.length > META_XML_MAX_BYTES) return undefined;
  try {
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(text) as {
      meta?: { project?: { '@_thumburl'?: unknown } };
    };
    const thumb = parsed?.meta?.project?.['@_thumburl'];
    return typeof thumb === 'string' ? thumb.replace(/\\/g, '/').replace(/^\.\//, '') : undefined;
  } catch {
    return undefined; // vendor metadata — unreadable simply means "no hint"
  }
}

/**
 * Pick the candidate among a package's POSIX-relative entry paths: the meta.xml hint first, then
 * conventionally named images (shallowest first). Every candidate is checked for a raster extension,
 * existence in the entry set and path containment; the size cap is the caller's (it needs bytes).
 */
export function pickThumbnailCandidate(
  packageId: string,
  rels: Iterable<string>,
  metaXml: string | undefined,
): string | undefined {
  const entries = new Set(rels);
  const candidates: string[] = [];
  const hint = metaXml !== undefined ? thumbnailHintFromMeta(metaXml) : undefined;
  if (hint) candidates.push(hint);
  candidates.push(
    ...[...entries]
      .filter((rel) => THUMBNAIL_NAME.test(rel))
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)),
  );
  for (const rel of candidates) {
    if (!THUMBNAIL_EXT.test(rel) || !entries.has(rel)) continue;
    if (resolveScormEntry(packageId, rel) === null) continue;
    return rel;
  }
  return undefined;
}

/**
 * Scan an EXTRACTED package directory for its cover candidate — for packages imported before the
 * field existed. Same rules as the import, with the size cap checked against the file on disk.
 * null = scanned, nothing qualifies.
 */
export async function detectThumbnailOnDisk(packageId: string): Promise<string | null> {
  const dir = scormPackageDir(packageId);
  let names: string[];
  try {
    names = (await fs.readdir(dir, { recursive: true })) as string[];
  } catch {
    return null; // directory missing (gcScorm will sweep the record) — nothing to offer
  }
  const rels = names.map((n) => n.split(path.sep).join('/'));
  let metaXml: string | undefined;
  if (rels.includes(META_XML_NAME)) {
    try {
      const stat = await fs.stat(path.join(dir, META_XML_NAME));
      if (stat.size <= META_XML_MAX_BYTES) metaXml = await fs.readFile(path.join(dir, META_XML_NAME), 'utf-8');
    } catch {
      metaXml = undefined;
    }
  }
  const rel = pickThumbnailCandidate(packageId, rels, metaXml);
  if (!rel) return null;
  const abs = resolveScormEntry(packageId, rel);
  if (!abs) return null;
  try {
    const stat = await fs.stat(abs);
    return stat.isFile() && stat.size <= PREVIEW_IMAGE_MAX_BYTES ? rel : null;
  } catch {
    return null;
  }
}

/**
 * One-time backfill of `thumbnailHref` on package records that predate the field (absent key —
 * an import since then always writes a string or null). Runs with the other data migrations (boot
 * + after a backup restore); a no-op once every record carries the key, so it is safe to repeat.
 */
export async function migrateScormThumbnails(): Promise<void> {
  const packages = await readStore<ScormPackageRef>('scormPackages');
  let migrated = 0;
  for (const pkg of packages) {
    if ('thumbnailHref' in pkg) continue;
    pkg.thumbnailHref = await detectThumbnailOnDisk(pkg.packageId);
    migrated += 1;
  }
  if (!migrated) return;
  await writeStore('scormPackages', packages);
  console.log(`↪  scanned ${migrated} SCORM package(s) for a cover image`);
}
