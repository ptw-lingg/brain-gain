---
name: release
description: Cut a BrainGain release — bump the root VERSION (patch | minor | major, or an explicit X.Y.Z), sync every descriptor, write the CHANGELOG section, scaffold a version-gated data-migration step when the persisted shape changed, run npm run verify, commit and tag. Use when the user says a version is ready, types /release, or asks to bump/tag/cut a release.
---

# /release — cut a BrainGain release

Usage: `/release patch|minor|major` or `/release 1.4.0`.
Flags: `--no-tag` · `--skip-verify` (dry runs only — say so loudly) · `--allow-dirty` · `--push`.

The root `VERSION` file is the single source of truth. Everything else — both `package.json`, both
lockfiles, `requirements.json` `meta.version`, the SBOMs — is derived from it by `tools/sync-version.mjs`.
The backend reads `VERSION` at boot, gates data migrations on it and reports it on `/api/health`.

Work through the steps in order. Stop at the first refusal; never skip `verify` silently.

## 1. Preflight — refuse early

```bash
git status --porcelain          # must be empty (unless --allow-dirty)
git rev-parse --abbrev-ref HEAD # print the branch; do not release from a detached HEAD without asking
cat VERSION                     # current version
git tag -l 'v*' --sort=-v:refname | head -1   # last release tag, if any
```

Compute the target with `tools/version.mjs` (`bump(current, kind)`), or take the explicit `X.Y.Z`.
Refuse when: the target is not strict `MAJOR.MINOR.PATCH`; the target is not greater than `VERSION`
(`compareVersions`); `git rev-parse -q --verify refs/tags/v<target>` succeeds (tag exists).

## 2. Decide whether a data-migration step is needed

Inspect what changed in the persisted shape since the last release:

```bash
git diff <lastTag-or-root>..HEAD -- backend/src/types.ts backend/src/services/fileStore.ts backend/src/services/migrations.ts
```

Rule of thumb (the contract in `backend/src/services/migrationSteps/index.ts`):

- **No step** — an added field with a default (`readSettings`' shallow merge and the shape-normalizers
  already cover it), or anything a record can be inspected for structurally (write a normalizer in
  `migrations.ts` instead).
- **Step required** — a removed or renamed persisted field, a destructive prune, a value
  re-interpretation (unit or encoding change), or any transform that must not repeat on a downgrade.

If a step is required: copy `templates/step.ts.tmpl` to
`backend/src/services/migrationSteps/<target>-<slug>.ts`, fill in `version: '<target>'`, the one-line
`description` and an **idempotent, re-runnable** `up()`, and add it to `registered` in
`migrationSteps/index.ts`. If not: create nothing — a release with no step still advances the marker
and takes no backup.

## 3. Bump

```bash
printf '<target>\n' > VERSION
node tools/sync-version.mjs      # package.json ×3, package-lock.json ×2, requirements meta.version
git diff --stat                  # only version lines (and the requirements file) should move
```

## 4. CHANGELOG.md (Keep a Changelog)

Keep `## [Unreleased]` at the top; insert `## [<target>] — YYYY-MM-DD` directly below it with the
subsections `### Added`, `### Changed`, `### Fixed` (omit empty ones) and the **mandatory**
`### Data migrations` — either the step's description or `- none`. Draft from
`git log <lastTag>..HEAD --oneline` and confirm the wording with the user before continuing.

## 5. Verify

```bash
npm run verify     # sync-version --check → build.mjs → backend + Playwright suites → build.mjs --check → drift-check
```

Run it in the background — it takes ~10 minutes and a foreground timeout orphans the suites. Any
failure aborts the release before anything is committed. `--skip-verify` prints a loud warning.

## 6. Commit and tag

```bash
git add VERSION CHANGELOG.md package.json backend/package.json backend/package-lock.json \
        frontend/package.json frontend/package-lock.json requirements/requirements.json \
        backend/src/services/migrationSteps/
git commit -m "chore(release): <target>"        # never --no-verify, never amend
git tag -a v<target> -m "<the new CHANGELOG section>"   # skipped with --no-tag
```

Push only with `--push` (`git push && git push --tags`); otherwise print those two commands.

## 7. Print the upgrade note

Tell the user what existing installations will do on their first start of `<target>`: read
`DATA_DIR/_meta.json` (an unmarked directory is adopted at 1.2.0); if a step is due, take one
`pre-migration` backup, apply the steps in order and advance the marker; if none is due, only advance
the marker. Rollback = restore the pre-migration backup **while still on the new version**, then check
out the previous tag — or `ALLOW_DATA_DOWNGRADE=1` in an emergency. Deployments upgrade with
`git checkout v<target>` (INSTALLATION.md §12).

## 8. Package the distributable

```bash
npm run package        # node tools/package-release.mjs — builds v<target> in a temp worktree
```

Produces `release/braingain-<target>.tgz` (+ `.sha256`): compiled backend, built SPA and production
`node_modules` — the target needs only Node.js, no build and no network. Never contains data. The bundle
is boot-checked before packing; `node tools/package-release.mjs --smoke <extracted dir>` re-checks an
extracted bundle. Run it after tagging (it builds from the tag, not the working tree).
