// Shared serializer for requirements.json — one object per line, CRLF, so the file stays greppable
// and diff-friendly. Both build.mjs (catalog + coverage) and sync-tests.mjs (embedded test results)
// write through this, so their output is byte-identical and build.mjs --check stays a clean drift gate.
//
// NOTE: this file is maintained as an identical copy in the brain-gain and veri-trace repos
// (drift-check.mjs enforces that) — keep it repo-agnostic.

const NL = '\r\n';
const arr = (key, list, indent) =>
  !list || !list.length
    ? `${indent}"${key}": []`
    : `${indent}"${key}": [${NL}${list.map((o) => `${indent}  ${JSON.stringify(o)}`).join(',' + NL)}${NL}${indent}]`;
const block = (key, obj, indent) => `${indent}"${key}": ${JSON.stringify(obj, null, 2).split('\n').join(NL + indent)}`;

export function serialize(d) {
  const parts = [];
  parts.push(`  "$schema": ${JSON.stringify(d.$schema)}`);
  parts.push(block('meta', d.meta, '  '));
  const enumParts = Object.entries(d.enums).map(([k, v]) => arr(k, v, '    '));
  parts.push(`  "enums": {${NL}${enumParts.join(',' + NL)}${NL}  }`);
  parts.push(arr('actors', d.actors, '  '));
  if (d.outOfScope) parts.push(arr('outOfScope', d.outOfScope, '  '));
  parts.push(arr('requirements', d.requirements, '  '));
  parts.push(arr('tests', d.tests, '  '));
  parts.push(arr('testCases', d.testCases, '  '));
  // Live test results (sync-tests.mjs). Last key; build.mjs passes any existing block through unchanged.
  if (d.testRun) parts.push(block('testRun', d.testRun, '  '));
  return `{${NL}${parts.join(',' + NL)}${NL}}${NL}`;
}
