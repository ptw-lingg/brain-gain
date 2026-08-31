// imsmanifest.xml parsing — version detection, SCO census, entry resolution, mastery score.
//
// The manifest is ATTACKER-SUPPLIED XML. fast-xml-parser is used deliberately: it processes no
// DTDs and resolves no external entities at all, so XXE and billion-laughs are out of scope by
// construction. Namespace prefixes are arbitrary (adlcp: is a convention, not a rule), so every
// element/attribute lookup here matches on the LOCAL name, case-insensitively — regex-scraping or
// exact-prefix matching is how parser-differential bugs happen (our reader sees one SCO, a real
// LMS sees seven).

import { XMLParser } from 'fast-xml-parser';
import type { ScormVersion } from '../../types';

/** A manifest problem the trainer can act on → HTTP 422 with a stable `code`. */
export class ScormManifestError extends Error {
  constructor(readonly code: string, message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'ScormManifestError';
  }
}

export interface ManifestInfo {
  scormVersion: ScormVersion;
  identifier: string;
  title: string;
  entryHref: string; // POSIX-relative to the package root, xml:base applied, URL-decoded
  parameters?: string; // <item parameters="…">
  masteryScore: number | null; // normalized 0–1
  dataFromLms?: string;
  scoCount: number;
}

type XmlNode = Record<string, unknown>;

// Every option is load-bearing:
//   ignoreAttributes:false + '@' prefix — we need identifier/identifierref/href/scormType;
//   removeNSPrefix:false               — the adlcp/imsss PREFIX text is matched by local name below;
//   parse*:false                       — keep everything a string, coerce deliberately;
//   isArray                            — item/organization/resource repeat, and one-element arrays
//                                        must not collapse into bare objects.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'organization', 'resource', 'file', 'dependency'].includes(localName(name).toLowerCase()),
});

/** 'adlcp:scormType' → 'scormtype'-comparable local name. */
function localName(tag: string): string {
  const i = tag.indexOf(':');
  return i === -1 ? tag : tag.slice(i + 1);
}

/** Child element values whose local name matches (case-insensitive), across any prefix. */
function childrenOf(node: XmlNode, local: string): unknown[] {
  const out: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@') || key === '#text') continue;
    if (localName(key).toLowerCase() !== local.toLowerCase()) continue;
    if (Array.isArray(value)) out.push(...value);
    else out.push(value);
  }
  return out;
}

function firstChild(node: XmlNode, local: string): XmlNode | null {
  const found = childrenOf(node, local);
  return found.length && typeof found[0] === 'object' && found[0] !== null ? (found[0] as XmlNode) : null;
}

/** Text content of the first matching child element ('' when absent). */
function childText(node: XmlNode, local: string): string {
  for (const value of childrenOf(node, local)) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const text = (value as XmlNode)['#text'];
      if (typeof text === 'string') return text;
    }
  }
  return '';
}

/** Attribute value by local name (case-insensitive), across any prefix ('' when absent). */
function attr(node: XmlNode, local: string): string {
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith('@')) continue;
    if (localName(key.slice(1)).toLowerCase() !== local.toLowerCase()) continue;
    if (typeof value === 'string') return value;
  }
  return '';
}

/** All namespace declaration values on a node (xmlns / xmlns:*). */
function namespacesOf(node: XmlNode): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === '@xmlns' || key.startsWith('@xmlns:')) {
      if (typeof value === 'string') out.push(value);
    }
  }
  return out;
}

/** Depth-first list of every <item> under a node (organizations nest items arbitrarily). */
function collectItems(node: XmlNode): XmlNode[] {
  const items: XmlNode[] = [];
  for (const item of childrenOf(node, 'item')) {
    if (!item || typeof item !== 'object') continue;
    items.push(item as XmlNode);
    items.push(...collectItems(item as XmlNode));
  }
  return items;
}

/** Join xml:base fragments + href into one normalized POSIX-relative path (still untrusted —
 *  the caller re-validates it against the archive and resolveScormEntry). */
function joinHref(parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, '/').replace(/\/+$/, ''))
    .join('/');
  // Strip a query/fragment an authoring tool put into href itself; decode %20 and friends.
  const noQuery = joined.split(/[?#]/)[0];
  try {
    return decodeURIComponent(noQuery);
  } catch {
    return noQuery;
  }
}

function detectVersion(manifest: XmlNode): ScormVersion {
  const schemaVersion = childText(firstChild(manifest, 'metadata') ?? {}, 'schemaversion').trim();
  const sv = schemaVersion.toLowerCase();
  if (sv === '1.2') return '1.2';
  if (sv.startsWith('2004') || sv === 'cam 1.3' || sv === '1.3') return '2004';
  if (sv === '1.1' || sv === '1.0') {
    throw new ScormManifestError(
      'unsupported-version',
      `Unsupported SCORM version "${schemaVersion}" — only SCORM 1.2 and 2004 are supported`,
    );
  }
  // No usable schemaversion — fall back on namespaces, then on the presence of sequencing.
  const ns = namespacesOf(manifest).join(' ');
  if (ns.includes('adlcp_v1p3') || ns.includes('imsss')) return '2004';
  if (ns.includes('adlcp_rootv1p2')) return '1.2';
  const orgs = firstChild(manifest, 'organizations');
  const hasSequencing = orgs !== null && JSON.stringify(orgs).toLowerCase().includes('sequencing');
  return hasSequencing ? '2004' : '1.2'; // 1.2 is the more permissive default runtime
}

/**
 * Parse and validate a manifest. Throws {@link ScormManifestError} with a stable code on anything
 * a trainer must fix; the caller (import pipeline) still owns archive-level checks (the entry file
 * existing, path containment, size caps).
 */
export function parseManifest(xml: string): ManifestInfo {
  let doc: XmlNode;
  try {
    doc = parser.parse(xml) as XmlNode;
  } catch {
    throw new ScormManifestError('bad-manifest', 'imsmanifest.xml is not well-formed XML');
  }
  const manifest = firstChild(doc, 'manifest');
  if (!manifest) throw new ScormManifestError('bad-manifest', 'imsmanifest.xml has no <manifest> root');

  const scormVersion = detectVersion(manifest);
  const identifier = attr(manifest, 'identifier') || 'unknown';

  // Resources, indexed by identifier, with their scormType and effective href.
  const resourcesNode = firstChild(manifest, 'resources') ?? {};
  const manifestBase = attr(manifest, 'base');
  const resourcesBase = attr(resourcesNode as XmlNode, 'base');
  interface Res { scormType: string; href: string; }
  const resources = new Map<string, Res>();
  for (const value of childrenOf(resourcesNode as XmlNode, 'resource')) {
    if (!value || typeof value !== 'object') continue;
    const res = value as XmlNode;
    const id = attr(res, 'identifier');
    if (!id) continue;
    resources.set(id, {
      scormType: attr(res, 'scormtype').toLowerCase(),
      href: joinHref([manifestBase, resourcesBase, attr(res, 'base'), attr(res, 'href')]),
    });
  }

  // SCO census over the DEFAULT organization's item tree.
  const organizationsNode = firstChild(manifest, 'organizations');
  const organizations = organizationsNode ? childrenOf(organizationsNode, 'organization') : [];
  const defaultOrgId = organizationsNode ? attr(organizationsNode, 'default') : '';
  const org =
    (organizations.find((o) => o && typeof o === 'object' && attr(o as XmlNode, 'identifier') === defaultOrgId) as
      | XmlNode
      | undefined) ?? (organizations[0] as XmlNode | undefined);

  interface Sco { item: XmlNode; res: Res; }
  const scos: Sco[] = [];
  if (org) {
    for (const item of collectItems(org)) {
      const ref = attr(item, 'identifierref');
      if (!ref) continue;
      const res = resources.get(ref);
      if (!res) continue;
      // An explicit asset is content, not a launchable lesson; an ABSENT scormType on a referenced
      // resource with an href is tolerated as a SCO (plenty of 1.2 exports omit it).
      if (res.scormType === 'asset') continue;
      if (!res.href) continue;
      scos.push({ item, res });
    }
  }
  // Resource-only fallback (no organization items): exactly one sco-typed resource is tolerated.
  if (scos.length === 0) {
    const scoResources = [...resources.values()].filter((r) => r.scormType === 'sco' && r.href);
    if (scoResources.length === 1) scos.push({ item: {}, res: scoResources[0] });
    else if (scoResources.length > 1) {
      throw new ScormManifestError(
        'multi-sco',
        `Multi-SCO packages are not supported — this course has ${scoResources.length} launchable parts`,
      );
    }
  }

  if (scos.length === 0) {
    throw new ScormManifestError('no-launchable-resource', 'The manifest names no launchable course (SCO)');
  }
  if (scos.length > 1) {
    // Reject rather than silently reduce to the first SCO: importing 1 of N lessons would create
    // false completion records — the one failure mode a training-records app must never produce.
    throw new ScormManifestError(
      'multi-sco',
      `Multi-SCO packages are not supported — this course has ${scos.length} launchable parts`,
    );
  }

  const { item, res } = scos[0];

  // Mastery score: 1.2 <adlcp:masteryscore> (0–100 → /100); 2004 <imsss:minNormalizedMeasure>
  // under sequencing/objectives/primaryObjective (already 0–1). Out-of-range → ignored, not rejected.
  let masteryScore: number | null = null;
  if (scormVersion === '1.2') {
    const raw = Number(childText(item, 'masteryscore'));
    if (Number.isFinite(raw) && raw >= 0 && raw <= 100 && childText(item, 'masteryscore') !== '') {
      masteryScore = raw / 100;
    }
  } else {
    const sequencing = firstChild(item, 'sequencing');
    const objectives = sequencing ? firstChild(sequencing, 'objectives') : null;
    const primary = objectives ? firstChild(objectives, 'primaryObjective') : null;
    const raw = primary ? Number(childText(primary, 'minNormalizedMeasure')) : NaN;
    if (Number.isFinite(raw) && raw >= 0 && raw <= 1) masteryScore = raw;
  }

  const dataFromLms = childText(item, 'datafromlms') || childText(item, 'dataFromLMS');
  const parameters = attr(item, 'parameters');
  const title =
    childText(item, 'title') || (org ? childText(org, 'title') : '') || identifier;

  return {
    scormVersion,
    identifier,
    title: title.slice(0, 300),
    entryHref: res.href,
    ...(parameters ? { parameters: parameters.slice(0, 1000) } : {}),
    masteryScore,
    ...(dataFromLms ? { dataFromLms: dataFromLms.slice(0, 4000) } : {}),
    scoCount: 1,
  };
}
