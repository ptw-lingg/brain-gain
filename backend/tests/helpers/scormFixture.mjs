// SCORM test fixtures, built as zips AT TEST TIME with jszip (a runtime dependency of backend/).
// No binaries in the repo: reviewers of a Class B system can't diff a zip, and every rejection
// case gets a purpose-built archive whose exact shape is readable here.

import JSZip from 'jszip';

/**
 * The stub SCO: does the REAL parent-walk API discovery (so it proves the wrapper/nested-frame
 * design), exposes buttons for the e2e suite and logs every API return value into #sco-log.
 */
export function stubScoHtml(api = 'API') {
  const isV12 = api === 'API';
  const call = (fn12, fn2004) => (isV12 ? fn12 : fn2004);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Stub SCO</title></head>
<body>
<pre id="log" data-testid="sco-log"></pre>
<button data-testid="sco-init" onclick="doInit()">init</button>
<button data-testid="sco-set-passed" onclick="setPassed()">set passed</button>
<button data-testid="sco-set-incomplete" onclick="setIncomplete()">set incomplete</button>
<button data-testid="sco-commit" onclick="doCommit()">commit</button>
<button data-testid="sco-finish" onclick="doFinish()">finish</button>
<script>
var api = null;
function log(s) { document.getElementById('log').textContent += s + '\\n'; }
function findAPI(win) { // the standard SCORM finder: walk parents, then the opener
  var tries = 0;
  while (win && tries < 500) {
    try { if (win.${api}) return win.${api}; } catch (e) { log('finder-error:' + e.name); return null; }
    if (win === win.parent) break;
    win = win.parent; tries++;
  }
  return null;
}
function doInit() {
  api = findAPI(window) || (window.opener ? findAPI(window.opener) : null);
  if (!api) { log('${api}=notfound'); return; }
  log('${call('LMSInitialize', 'Initialize')}=' + api.${call('LMSInitialize', 'Initialize')}(''));
  log('student_name=' + api.${call('LMSGetValue', 'GetValue')}('${call('cmi.core.student_name', 'cmi.learner_name')}'));
  log('entry=' + api.${call('LMSGetValue', 'GetValue')}('${call('cmi.core.entry', 'cmi.entry')}'));
  log('suspend_data=' + api.${call('LMSGetValue', 'GetValue')}('cmi.suspend_data'));
}
function setPassed() {
  ${
    isV12
      ? `log('set-status=' + api.LMSSetValue('cmi.core.lesson_status', 'passed'));
  log('set-score=' + api.LMSSetValue('cmi.core.score.raw', '92'));`
      : `log('set-completion=' + api.SetValue('cmi.completion_status', 'completed'));
  log('set-success=' + api.SetValue('cmi.success_status', 'passed'));
  log('set-score=' + api.SetValue('cmi.score.scaled', '0.92'));`
  }
  log('set-suspend=' + api.${call('LMSSetValue', 'SetValue')}('cmi.suspend_data', 'bookmark-slide-7'));
}
function setIncomplete() {
  ${
    isV12
      ? `log('set-status=' + api.LMSSetValue('cmi.core.lesson_status', 'incomplete'));`
      : `log('set-completion=' + api.SetValue('cmi.completion_status', 'incomplete'));`
  }
}
function doCommit() { log('${call('LMSCommit', 'Commit')}=' + api.${call('LMSCommit', 'Commit')}('')); }
function doFinish() { log('${call('LMSFinish', 'Terminate')}=' + api.${call('LMSFinish', 'Terminate')}('')); }
</script>
</body></html>`;
}

const MANIFEST_12 = ({ scoCount = 1, entryHref = 'index.html', masteryScore = 80, schemaVersion = '1.2' } = {}) => {
  const items = Array.from({ length: scoCount }, (_, i) =>
    `      <item identifier="ITEM-${i + 1}" identifierref="RES-${i + 1}">
        <title>Lesson ${i + 1}</title>
        ${masteryScore != null ? `<adlcp:masteryscore>${masteryScore}</adlcp:masteryscore>` : ''}
      </item>`).join('\n');
  const resources = Array.from({ length: scoCount }, (_, i) =>
    `    <resource identifier="RES-${i + 1}" type="webcontent" adlcp:scormtype="sco" href="${i === 0 ? entryHref : `sco${i + 1}.html`}">
      <file href="${i === 0 ? entryHref : `sco${i + 1}.html`}"/>
    </resource>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="BG-FIXTURE-12" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>${schemaVersion}</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Fixture Course 1.2</title>
${items}
    </organization>
  </organizations>
  <resources>
${resources}
  </resources>
</manifest>`;
};

const MANIFEST_2004 = ({ scoCount = 1, entryHref = 'index.html', minNormalizedMeasure = 0.8, schemaVersion = '2004 4th Edition' } = {}) => {
  const items = Array.from({ length: scoCount }, (_, i) =>
    `      <item identifier="ITEM-${i + 1}" identifierref="RES-${i + 1}">
        <title>Lesson ${i + 1}</title>
        ${minNormalizedMeasure != null ? `<imsss:sequencing><imsss:objectives>
          <imsss:primaryObjective objectiveID="PRIMARY" satisfiedByMeasure="true">
            <imsss:minNormalizedMeasure>${minNormalizedMeasure}</imsss:minNormalizedMeasure>
          </imsss:primaryObjective>
        </imsss:objectives></imsss:sequencing>` : ''}
      </item>`).join('\n');
  const resources = Array.from({ length: scoCount }, (_, i) =>
    `    <resource identifier="RES-${i + 1}" type="webcontent" adlcp:scormType="sco" href="${i === 0 ? entryHref : `sco${i + 1}.html`}">
      <file href="${i === 0 ? entryHref : `sco${i + 1}.html`}"/>
    </resource>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="BG-FIXTURE-2004" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schema>ADL SCORM</schema><schemaversion>${schemaVersion}</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Fixture Course 2004</title>
${items}
    </organization>
  </organizations>
  <resources>
${resources}
  </resources>
</manifest>`;
};

async function toBuffer(zip) {
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** A minimal, valid SCORM 1.2 package. */
export async function buildScorm12({
  scoCount = 1,
  entryHref = 'index.html',
  masteryScore = 80,
  schemaVersion = '1.2',
  nested = false, // wrap everything in 'course/' — exercises the nested-manifest path
  extraFiles = {}, // { 'img/a.png': Buffer | string, … }
  manifestXml, // override — for malformed-manifest cases
} = {}) {
  const zip = new JSZip();
  const prefix = nested ? 'course/' : '';
  zip.file(`${prefix}imsmanifest.xml`, manifestXml ?? MANIFEST_12({ scoCount, entryHref, masteryScore, schemaVersion }));
  zip.file(`${prefix}${entryHref}`, stubScoHtml('API'));
  for (let i = 1; i < scoCount; i++) zip.file(`${prefix}sco${i + 1}.html`, stubScoHtml('API'));
  for (const [name, content] of Object.entries(extraFiles)) zip.file(`${prefix}${name}`, content);
  return toBuffer(zip);
}

/** A minimal, valid SCORM 2004 package. */
export async function buildScorm2004({
  scoCount = 1,
  entryHref = 'index.html',
  minNormalizedMeasure = 0.8,
  schemaVersion = '2004 4th Edition',
  extraFiles = {},
  manifestXml,
} = {}) {
  const zip = new JSZip();
  zip.file('imsmanifest.xml', manifestXml ?? MANIFEST_2004({ scoCount, entryHref, minNormalizedMeasure, schemaVersion }));
  zip.file(entryHref, stubScoHtml('API_1484_11'));
  for (let i = 1; i < scoCount; i++) zip.file(`sco${i + 1}.html`, stubScoHtml('API_1484_11'));
  for (const [name, content] of Object.entries(extraFiles)) zip.file(name, content);
  return toBuffer(zip);
}

/**
 * Rewrite an entry NAME inside generated zip bytes. JSZip refuses to write genuinely hostile names
 * (it normalizes ../ away), so hostile fixtures are built with a same-length placeholder and the
 * raw bytes are patched afterwards — the name appears verbatim in the local header and the central
 * directory, and the length fields don't change.
 */
function renameEntryRaw(buf, from, to) {
  if (from.length !== to.length) throw new Error('renameEntryRaw needs equal-length names');
  const f = Buffer.from(from, 'utf-8');
  const t = Buffer.from(to, 'utf-8');
  let i = buf.indexOf(f);
  if (i === -1) throw new Error(`placeholder ${from} not found in archive`);
  while (i !== -1) {
    t.copy(buf, i);
    i = buf.indexOf(f, i + 1);
  }
  return buf;
}

/** Deliberately hostile/broken archives, one shape per rejection path. */
export async function buildEvilPackage(kind) {
  const zip = new JSZip();
  const valid = () => {
    zip.file('imsmanifest.xml', MANIFEST_12({}));
    zip.file('index.html', stubScoHtml('API'));
  };
  switch (kind) {
    case 'not-a-zip':
      return Buffer.from('this is definitely not a zip archive, not even close');
    case 'traversal':
      valid();
      zip.file('AA/evil.txt', 'escape attempt');
      return renameEntryRaw(await toBuffer(zip), 'AA/evil.txt', '../evil.txt');
    case 'absolute':
      valid();
      zip.file('Aabs/evil.txt', 'escape attempt');
      return renameEntryRaw(await toBuffer(zip), 'Aabs/evil.txt', '/abs/evil.txt');
    case 'backslash':
      valid();
      zip.file('AABevil.txt', 'escape attempt');
      return renameEntryRaw(await toBuffer(zip), 'AABevil.txt', '..\\evil.txt');
    case 'symlink':
      valid();
      zip.file('link.html', '/etc/passwd', { unixPermissions: 0o120777 });
      // unixPermissions only lands in the archive when the writer targets the UNIX platform.
      return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
    case 'no-manifest':
      zip.file('index.html', stubScoHtml('API'));
      return toBuffer(zip);
    case 'cmi5':
      zip.file('cmi5.xml', '<courseStructure/>');
      zip.file('index.html', '<html></html>');
      return toBuffer(zip);
    case 'two-manifests':
      valid();
      zip.file('course/imsmanifest.xml', MANIFEST_12({}));
      return toBuffer(zip);
    case 'missing-entry':
      zip.file('imsmanifest.xml', MANIFEST_12({ entryHref: 'absent.html' }));
      zip.file('index.html', stubScoHtml('API'));
      return toBuffer(zip);
    case 'non-html-entry':
      zip.file('imsmanifest.xml', MANIFEST_12({ entryHref: 'main.swf' }));
      zip.file('main.swf', 'FWS...');
      return toBuffer(zip);
    case 'traversal-entry':
      zip.file('imsmanifest.xml', MANIFEST_12({ entryHref: '../../outside.html' }));
      zip.file('index.html', stubScoHtml('API'));
      return toBuffer(zip);
    case 'multi-sco':
      return buildScorm12({ scoCount: 3 });
    case 'unsupported-version':
      return buildScorm12({ schemaVersion: '1.1' });
    case 'too-many-files': {
      valid();
      for (let i = 0; i < 2100; i++) zip.file(`assets/f${i}.txt`, 'x');
      return toBuffer(zip);
    }
    case 'huge': {
      // A single entry over the per-entry cap; zeros compress to ~nothing, so the FIXTURE stays
      // small and the test exercises the UNPACKED guard, not the request body limit.
      valid();
      zip.file('video/blob.bin', Buffer.alloc(201 * 1024 * 1024));
      return toBuffer(zip);
    }
    default:
      throw new Error(`unknown evil package kind: ${kind}`);
  }
}
