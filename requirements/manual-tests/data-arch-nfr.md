# Manual test procedures — Data, Architecture & NFR (SYS areas: DATA, ARCH, NFR)

Manual / inspection procedures for the things the automated backend tests
(`backend/tests/data-arch-nfr.test.mjs`) and the Playwright e2e spec
(`frontend/e2e/data-arch-nfr.spec.ts`) cannot mechanically cover. Everything observable
over the API — JSON-file round-trips, settings defaults backfill, no-secret-leakage,
server-side mutation enforcement — is asserted in the backend test; the
"all entities editable via UI" smoke (SR-103 / VT-103) is in the e2e spec. The procedures
below are **structural / code-inspection** (is it TypeScript? is it Vue? is there a DB driver?)
or require a clean-machine run, which are inherently human/inspection judgements.

System requirements in scope: **SYS-ARCH-01..07**, **SYS-DATA-01..08**, **SYS-NFR-01**, **SYS-NFR-02**.
Stakeholder requirements: **SR-100** (TypeScript everywhere), **SR-101** (JSON-file persistence),
**SR-102** (Vue frontend), **SR-103** (all entities editable via UI), **SR-104** (server-side
security enforcement), **SR-105** (no secrets to clients), **SR-106** (easy to run; seed demo data).

## Coverage split

| Requirement | Backend test | E2e spec | Manual (this doc) |
|---|---|---|---|
| SYS-ARCH-05 JSON-file persistence (no DB) ← SR-101 | round-trips prove persistence | — | **MT-DAN-02** (no DB driver; files on disk) |
| SYS-ARCH-06 First-run seed ← SR-106 | yes (3 accounts + role + trainings) | — | **MT-DAN-04** (clean-machine run) |
| SYS-DATA-01 Generic JSON stores ← SR-101/SR-103 | round-trips (users/roles/trainings/settings) | editors reachable | MT-DAN-02 |
| SYS-DATA-02..04 entity round-trips ← SR-020..046 | yes | editors reachable | — |
| SYS-DATA-05 answer key stripped ← SR-051 | yes (`/trainings/mine` no `correctIndex`) | — | — |
| SYS-DATA-06 settings defaults backfilled ← SR-080/SR-008 | yes (threshold 0.8, entra defaults, tls null) | settings cards present | — |
| SYS-DATA-07 SafeUser strips secrets ← SR-003/SR-105 | yes (login/me/users) | — | — |
| SYS-NFR-01 server-side enforcement ← SR-104 | yes (401 unauth, 403 non-admin) | — | MT-DAN-03 (defence-in-depth UI vs API) |
| SYS-NFR-02 no secret leakage ← SR-105/SR-051 | yes (no passwordHash/entraOid/correctIndex) | — | MT-DAN-03 (no client secret in SSO) |
| SR-100 TypeScript everywhere | — | — | **MT-DAN-01** (typecheck + no `any`) |
| SR-102 Vue frontend (not React) | — | — | **MT-DAN-05** (stack inspection) |
| SR-103 all entities editable via UI | API layer | **yes** (Users/Roles/Trainings/Settings editors) | — |

---

## MT-DAN-01 — TypeScript everywhere, strict, no `any` (SR-100, SYS-ARCH-01/02/07, VT-100)

Code-inspection of the constraint that both projects are TypeScript and typecheck cleanly with
no `any` leakage. Not mechanically testable in the API/e2e harness — verified by running the
typecheckers and inspecting config.

**Preconditions:** A checkout of the monorepo with dependencies installed in both `backend/`
and `frontend/`.

**Steps & expected:**

1. In `backend/`, run `npm run typecheck` (`tsc --noEmit`).
   - Expected: completes with **no type errors**.
2. In `frontend/`, run `npm run typecheck` (or `vue-tsc --noEmit`).
   - Expected: completes with **no type errors**.
3. Inspect `backend/tsconfig.json` and `frontend/tsconfig.json`.
   - Expected: `strict` (and `noImplicitAny`) is enabled in both.
4. Search both `src` trees for the `any` type (e.g. grep for `: any` / `as any`).
   - Expected: no `any` types in application code; `unknown` + type guards are used instead
     (see `fileStore.ts` `err: unknown` handling and `trainings.ts` `Record<string, unknown>`).
5. Confirm the backend has **no build step** and runs via tsx.
   - Expected: `backend/package.json` scripts use `tsx watch src/index.ts` (dev) and
     `tsx src/index.ts` (start); IDs are generated with `crypto.randomUUID()`.

---

## MT-DAN-02 — JSON-file persistence, no database (SR-101, SYS-ARCH-05 / SYS-DATA-01, VT-101)

Inspection that data lives in local JSON files via `fs/promises` and that no database engine
or driver is present. The backend test proves persistence by round-tripping created records;
this procedure confirms the *mechanism* (files on disk, no DB dependency).

**Preconditions:** A checkout of the monorepo; the backend has been started at least once so the
data directory is populated.

**Steps & expected:**

1. Inspect `backend/src/services/fileStore.ts`.
   - Expected: reads/writes use `fs/promises`; arrays (`users`/`roles`/`trainings`/`sessions`)
     and a single `settings` object are serialized with `JSON.stringify(data, null, 2)`
     (2-space indentation); missing files are auto-initialised (`[]` or `DEFAULT_SETTINGS`).
2. List `backend/src/data/` (or the configured `DATA_DIR`).
   - Expected: `users.json`, `roles.json`, `trainings.json`, `sessions.json`, `settings.json`
     exist and contain human-readable, 2-space-indented JSON.
3. Inspect `backend/package.json` dependencies.
   - Expected: **no** database engine or driver (no `pg`, `mysql`, `mongodb`, `sqlite`,
     `prisma`, `typeorm`, `sequelize`, `mongoose`, etc.). Storage is JSON files only.
4. Open `settings.json` and confirm it is a single object (not an array) with `passThreshold`
   and an `entra` block.
   - Expected: matches the `Settings` shape; defaults are backfilled on read (shallow merge in
     `readSettings`).

---

## MT-DAN-03 — Security enforced server-side; no secrets reach the client (SR-104/SR-105, SYS-NFR-01/02, VT-104/VT-105)

The API-observable parts (401 without auth, 403 for non-admins, no `passwordHash`/`entraOid`/
`correctIndex` in responses) are asserted in the backend test. This procedure documents the
defence-in-depth / no-client-secret aspects that are best confirmed by inspection plus a
live network capture.

**Preconditions:** App running over HTTPS; signed in as admin and (separately) as the member.

**Steps & expected:**

1. As the **member**, open browser dev-tools Network and load the dashboard, then attempt to
   navigate to `/users`, `/roles`, `/settings` via the address bar.
   - Expected: the member is redirected to `/dashboard` (router guard); the admin navigation is
     not rendered (sidebar is role-gated). UI hiding is defence-in-depth only.
2. With the member's token, replay a mutating request directly (e.g. `POST /api/users`,
   `PUT /api/settings`) using curl/Postman, bypassing the UI.
   - Expected: server responds **403** regardless of client behaviour (also asserted automatically
     in the backend test) — proving the check is server-side, not UI-only.
3. Inspect the response bodies of `GET /api/auth/me`, `GET /api/users`, and a learner's
   `GET /api/trainings/mine` in the Network panel.
   - Expected: no `passwordHash`, no `entraOid`, and no `correctIndex` anywhere (`toSafeUser` /
     `toPublic` strip them server-side).
4. Inspect the SSO code path (`backend/src/services/entra.ts`, `GET /api/auth/sso/config`).
   - Expected: the flow validates **ID tokens only** and stores/uses **no client secret**;
     `GET /sso/config` returns only `clientId` + `authority` (non-secret), so the config can be
     safely admin-editable (SR-105). The TLS private key is likewise never returned by any API.

---

## MT-DAN-04 — Easy to run; first-run seed on a clean machine (SR-106, SYS-ARCH-06, VT-106)

The seed content is asserted automatically (the backend test logs in as all three seeded
accounts and finds the seeded role + trainings against a fresh temp data dir). This procedure
validates the *evaluator experience*: starting from a clean checkout with no prior data.

**Preconditions:** A fresh clone of the repo on a machine with Node installed and an **empty**
data directory (no `backend/src/data/*.json`, or a fresh `DATA_DIR`).

**Steps & expected:**

1. Install dependencies in `backend/` and `frontend/` and start the backend (`npm run dev`)
   and the frontend dev server.
   - Expected: both start without manual data setup; the backend logs the seeded demo accounts.
2. Confirm the data files were created on first start.
   - Expected: `users.json`, `roles.json`, `trainings.json`, `sessions.json`, `settings.json`
     now exist; `settings.json` has `passThreshold: 0.8` and the default `entra` block.
3. Open the app and sign in with each seeded account.
   - Expected: `admin@braingain.app` / `admin123` (admin), `trainer@braingain.app` / `trainer123`
     (trainer), `user@braingain.app` / `user123` (member) all sign in. The member's dashboard
     shows the 2 trainings required by the seeded "Lab Technician" role.
4. Restart the backend with the now-populated data dir.
   - Expected: seeding does **not** run again (it only seeds when no users exist); existing data
     is preserved.

---

## MT-DAN-05 — Vue frontend (not React) (SR-102, SYS-ARCH-01/03, VT-102)

Inspection of the frontend stack constraint.

**Preconditions:** A checkout of the monorepo.

**Steps & expected:**

1. Inspect `frontend/package.json` dependencies.
   - Expected: `vue` (Vue 3) plus `pinia`, `vue-router`, `axios`, and Vite tooling are present;
     **no** `react` / `react-dom`.
2. Inspect `frontend/src/main.ts` and a few `*.vue` files (e.g. `pages/UsersPage.vue`).
   - Expected: Vue 3 Composition API (`<script setup lang="ts">`), Pinia for state, Vue Router 4;
     `frontend/src/api/client.ts` uses axios with `baseURL` `/api`.
3. Inspect `frontend/vite.config.ts`.
   - Expected: Vue plugin configured; the dev server proxies `/api` to the backend.
