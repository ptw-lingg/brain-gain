# Changelog

All notable changes to BrainGain are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`, no prerelease tags.

The root `VERSION` file is the single source of truth for the running version; `/release` bumps it and
adds the section below. Every release section carries a **Data migrations** subsection: the version-gated
step the backend applies at start-up when it finds data written by an older version, or "none".

## [Unreleased]

## [1.3.0] — 2026-09-07

### Added
- Semantic versioning: root `VERSION` file, propagated into both `package.json` files, both lockfiles,
  the requirements catalog and the SBOMs by `tools/sync-version.mjs` (drift is gated by `npm run verify`).
- Data-version marker `DATA_DIR/_meta.json` recording which version's shape the stored data is in, with a
  history of every initialization, adoption, migration and restore.
- Version-gated migration runner: steps registered per version run exactly once at start-up, after an
  automatic `pre-migration` backup; a step failure stops the start with the marker left unadvanced.
- Downgrade protection: a data directory written by a newer version refuses to boot (override with
  `ALLOW_DATA_DOWNGRADE=1` in an emergency); restoring an archive from a newer version is refused with 409.
- `GET /api/health` now reports `version`; new admin-only `GET /api/version` reports the app and data
  versions plus the migration history.
- **About** dialog in the user menu showing the running version (and, for admins, the data version).
- Audit-trail actions `data-migrated` and `data-migration-failed`.
- `/release` skill and this changelog.

### Changed
- Backup archives are `formatVersion` 2: the manifest records `dataVersion` and `appVersion`, and the
  archive carries `data/_meta.json` as a read-only passenger. Version-1 archives still restore (treated as
  data version 1.2.0 and migrated right after the restore).

### Data migrations
- **1.3.0** — `settings.json`: drop keys that are no longer part of the settings shape (removes the stale
  `materialLocales` list that survived every save).

## [1.2.0] — 2026-09-02

Baseline. The state of the application when versioning was introduced; every installation without a
`_meta.json` marker is adopted at this version on its first start of 1.3.0 or later.
