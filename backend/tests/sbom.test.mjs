// Automated check for the CycloneDX SBOM generation (SYS-ARCH-08 ← SR-175).
//
// Runs the real generator (`npm run sbom` in each package — the same command each package build
// executes as its last step) and inspects the emitted artifacts in sbom/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The root VERSION file is the app's single version source of truth; the SBOM must report it
// (VERSION → package.json via tools/sync-version.mjs → cyclonedx metadata.component.version).
const VERSION = readFileSync(join(repoRoot, 'VERSION'), 'utf8').trim();

function generateAndRead(pkg) {
  execSync('npm run sbom', { cwd: join(repoRoot, pkg), stdio: 'pipe', timeout: 120_000 });
  return JSON.parse(readFileSync(join(repoRoot, 'sbom', `${pkg}.cdx.json`), 'utf8'));
}

test('SYS-ARCH-08 / SR-175 / VT-192: the build generates CycloneDX SBOMs listing the runtime dependencies', () => {
  for (const [pkg, runtimeDeps, devOnlyDeps] of [
    ['backend', ['express', 'jsonwebtoken'], ['typescript', 'tsx']],
    // typescript is NOT a frontend dev-only marker: vue and pinia depend on it in production.
    ['frontend', ['vue', 'pinia'], ['vite', 'tailwindcss']],
  ]) {
    const sbom = generateAndRead(pkg);
    assert.equal(sbom.bomFormat, 'CycloneDX', `${pkg}: bomFormat`);
    assert.match(sbom.specVersion, /^1\.\d+$/, `${pkg}: CycloneDX 1.x spec`);
    assert.equal(sbom.metadata.component.name, `braingain-${pkg}`, `${pkg}: root component names the package`);
    assert.equal(sbom.metadata.component.version, VERSION, `${pkg}: root component carries the app version (SYS-VER-01)`);

    const names = new Set(sbom.components.map((c) => c.name));
    assert.ok(names.size > 0, `${pkg}: components listed`);
    for (const dep of runtimeDeps) assert.ok(names.has(dep), `${pkg}: runtime dependency ${dep} listed`);
    for (const dep of devOnlyDeps) assert.ok(!names.has(dep), `${pkg}: dev-only ${dep} excluded (--omit dev)`);
    // Every component must be identifiable for vulnerability screening — purl + version.
    for (const c of sbom.components) {
      assert.ok(c.purl?.startsWith('pkg:npm/'), `${pkg}: ${c.name} carries an npm purl`);
      assert.ok(c.version, `${pkg}: ${c.name} carries a version`);
    }
  }
});
