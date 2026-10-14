# Changelog

All notable changes to BrainGain are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`, no prerelease tags.

The root `VERSION` file is the single source of truth for the running version; `/release` bumps it and
adds the section below. Every release section carries a **Data migrations** subsection: the version-gated
step the backend applies at start-up when it finds data written by an older version, or "none".

## [Unreleased]

## [1.5.2] — 2026-10-14

### Fixed
- **Confirming a completed training with Microsoft failed for password accounts.** The confirmation
  demanded that the Microsoft account was already linked to the BrainGain account, but that link is only
  created by signing *in* with Microsoft. Anyone who signed in with their password and then chose
  "Confirm with Microsoft" was told their credentials were not correct. The first Microsoft confirmation
  is now accepted when the Microsoft email is the account's own email (the same rule the Microsoft sign-in
  uses), links the account at that moment and records the link in the audit trail; from then on only
  that Microsoft account confirms for it. A Microsoft identity already linked to a different account is
  still refused (SYS-SES-12).

### Data migrations
- none

## [1.5.1] — 2026-10-14

### Fixed
- **Microsoft sign-in never completed.** The sign-in popup returns to BrainGain with Microsoft's answer in
  the address; since msal-browser 4 that page has to pass the answer back to the main window itself. BrainGain
  started inside the popup instead, its router sent the popup to the login page and the answer was lost — the
  popup kept showing the login page. This affected both "Sign in with Microsoft" and the Microsoft
  re-confirmation when signing off a completed training. A page carrying a sign-in answer now relays it and
  closes instead of starting the app (SYS-SSO-10; same fix as MyDesk and SnagTag).
- **Clearer Microsoft sign-in errors.** A failure on Microsoft's side now shows its AADSTS code on the login
  page and in the sign-off message instead of a bare "failed", and closing the popup is no longer reported
  as an error when signing off a training.

### Data migrations
- none

## [1.5.0] — 2026-10-12

### Added
- **Pending activations can be completed or renewed by an administrator** (SR-193). The Users table badges
  accounts that are still pending activation, and the user dialog shows an activation panel with three
  actions: **Copy activation link** (a new link to hand over by any channel — no email server needed),
  **Send by email** (when SMTP is configured; disabled with the reason otherwise) and **Activate now**
  (with a password the admin types, keeping the password the account already has, or — when Microsoft
  sign-in is configured — without one). Every action is audited; the link never reaches the audit log.
  New endpoints: `POST /api/users/:id/activation-link`, `/activation-email` and `/activate`.
- **Activation links expire after 14 days** (SR-194). Every new link revokes the previous one at once. An
  expired link answers 410 and the activation page tells the user to ask the administrator for a new one.
- **Users change their own password** (SR-195). The user menu offers **Change password** to every account
  that signs in with a password: confirm the current one, choose a new one (at least 8 characters). No email
  is involved; a forgotten password is still reset by an administrator in the user editor. Accounts that sign
  in only with Microsoft have no password to change. New endpoint: `PUT /api/auth/password`.

### Changed
- `GET /api/users/:id/activation` (which re-served the original token) is replaced by
  `POST /api/users/:id/activation-link`, which issues a new one.
- `GET /api/users` also returns `hasPassword` and, for pending accounts, `activationExpiresAt`.

### Fixed
- **Setting a password for a pending account left it disabled — and locked out for good.** The password
  was stored, the account stayed disabled, and its activation link stopped working, so nothing in the app
  could enable it. Saving a password for a pending account now activates it.

### Data migrations
- none (no version-gated step). A boot normalizer gives activation links issued before 1.5.0 a 14-day
  window from the upgrade, and drops the already-dead link of a disabled account that holds a password
  (such an account stays disabled until an administrator uses **Activate now**, which keeps its password).

## [1.4.1] — 2026-10-09

### Fixed
- **SCORM courses could not start in a compiled deployment.** `tsc` emits only `.ts` files, so a build
  made with `npm run build` had no `dist/scorm/shim/` (the content origin's wrapper page and SCORM API
  shim) and every launch answered `wrapper.html` with a 500 — the course frame stayed blank. Development
  (`tsx`) and the test suites read the files from `src/`, which hid it. The backend build now copies the
  non-TypeScript assets from `src/` into `dist/` after `tsc` (`backend/scripts/copy-assets.mjs`, run by
  `npm run build`; `src/data` is never copied), and a backend test guards the wiring and the copied tree
  (SYS-SCO-05). An installation built from 1.4.0 can also recover without rebuilding by copying
  `backend/src/scorm/shim` to `backend/dist/scorm/shim`.

### Data migrations
- none

## [1.4.0] — 2026-10-09

### Added
- Audit entries for user role changes (edit and CSV import) record each role as `Name (id)` instead of a
  bare id, so the audit log reads without cross-referencing the roles store and stays meaningful after a
  role is renamed or deleted (SYS-AUD-02). Older entries keep their bare ids.

### Changed
- New SVG favicon replaces the PNG.
- Settings page: responsive sizing fix for narrow viewports.

### Fixed
- **Lost updates under concurrent use.** Every read-modify-write of a JSON store now runs inside
  `fileStore.transaction()` / `updateStore()`, one process-wide re-entrant store lock. Before, two
  requests writing the same store at the same moment lost one of them: ten simultaneous user creations
  persisted one; eight learners passing a training at once persisted two completions (SR-192).
- **Torn reads crashing the server.** Store, settings, marker, attempt and sidecar writes go through
  temp+rename (`writeJsonAtomic` / `writeFileAtomic`), so a reader never sees a half-written file and a
  crash never truncates one. Leftover temp files are swept at boot.
- **Async handler errors exiting the process.** Route modules use `asyncRouter()`, which forwards a
  rejected handler to the JSON error middleware; an escaped `unhandledRejection` is logged, not fatal.
- **SCORM double submit.** Consuming an attempt and writing its session is one atomic step and
  `closeAttempt` is a compare-and-set, so two simultaneous grade requests record exactly one session
  (the second gets 409). Two simultaneous launches share one attempt; a resumed attempt is loaded
  inside its write queue so a concurrent commit is not overwritten.
- **Restore and migrations vs. live traffic.** The backup snapshot, the restore swap and the data
  migrations run under the store lock; a request that read a store before a restore can no longer
  write its stale copy over the restored data. Backups are consistent snapshots.
- `GET /api/trainings` no longer writes on a read path; the `order`/`materials` backfill is a boot
  migration (`migrateTrainingOrder`).

### Data migrations
- none (no persisted shape changed; the new boot normalizer is idempotent and not version-gated).

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
