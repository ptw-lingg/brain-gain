# BrainGain

Mandatory-training management for regulated organizations. BrainGain assigns trainings to people
through **job roles**, drives each learner through a **material → quiz → result** flow with
**server-side grading**, and computes a per-user **due status** (never taken / up-to-date / due /
overdue) from each training's recurrence cycle and window. Administrators manage users, roles,
trainings and an **org-unit hierarchy**; unit heads oversee their teams; trainers own their own
trainings. It is served over **HTTPS** with an in-app manageable TLS certificate, and persists to
plain JSON files (no database).

## What it does

- **Authentication & access** — email/password (bcrypt) with optional **Microsoft Entra ID SSO**
  (single-tenant, domain-restricted provisioning), three access levels (Member / Trainer /
  Administrator), 7-day JWT sessions, and **admin impersonation** ("view as" another user).
- **Users** — admin CRUD, plus **clipboard bulk import** (paste a Name/Email/Roles/Org-unit table)
  with a dry-run preview; imported users default to Member and **activate via a one-time link** to
  set their own password.
- **Job roles & trainings** — roles require a set of trainings; a user's required trainings are the
  deduplicated union across their roles. Trainings carry material links, a multiple-choice quiz,
  a recurrence cycle and a due window; admins reorder them via drag-and-drop (order respected
  everywhere).
- **Sessions** — server grades the quiz against a configurable pass threshold (answers never leave
  the server); unlimited retries, only passes recorded.
- **Oversight** — a learner **dashboard**, a **Trainees** view (who must take a training, with email
  reminders over SMTP), and a **My Team** view for unit heads. Both controlled PDFs — the
  **Training Plan** and the **Training Status Report** — are previewed in-app before download for
  sign-off and filing in a document management system (DMS).
- **Settings (admin)** — pass threshold, company name, Entra SSO config, SMTP config, and **TLS
  certificate** upload / self-signed regeneration (hot-swapped, no restart).

> BrainGain has **no in-app requirements browser**. The requirements/DMS viewer lives in the
> standalone **VeriTrace** app; BrainGain only authors and generates the `requirements.json` it
> consumes (see below).

## Layout

```
backend/       Express + TypeScript API — HTTPS delivery, TLS cert management, JSON-file store
frontend/      Vue 3 SPA (English + German) + Playwright e2e
requirements/  BrainGain's requirements dataset (single source of truth) + tooling (build/sync)
```

- **backend/** — REST API ([`backend/src/routes/`](backend/src/routes/)) and services
  ([`backend/src/services/`](backend/src/services/)); serves the built SPA over **HTTPS only**
  (HTTP 308-redirects, HSTS), auto-generates a self-signed certificate on first run, and exposes a
  TLS settings API to upload/regenerate the certificate (hot-swapped; the private key never leaves
  the server). Persistence is plain JSON under [`backend/src/data/`](backend/src/data/).
- **frontend/** — the SPA ([`frontend/src/pages/`](frontend/src/pages/)) with role-guarded routes
  ([`frontend/src/router/index.ts`](frontend/src/router/index.ts)) and the controlled-document
  generators ([`frontend/src/utils/trainingPlan.ts`](frontend/src/utils/trainingPlan.ts),
  [`frontend/src/utils/teamReport.ts`](frontend/src/utils/teamReport.ts)).

## Develop

```
# backend (HTTPS API) — https://localhost:3101, http://localhost:3100 redirects
cd backend && npm install && npm run dev

# frontend (separate terminal) — https://localhost:5273 (self-signed; accept the warning), proxies /api
cd frontend && npm install && npm run dev
npm run typecheck
npm run build
```

For production, `npm --prefix frontend run build` then `npm --prefix backend start` serves the built
SPA over HTTPS at `https://localhost:3101`. The first run seeds an initial admin and writes a
self-signed certificate.

## Requirements & tests

BrainGain is the **product repo where the real requirements and test suites live**. The catalog is a
single machine-readable file, [`requirements/requirements.json`](requirements/requirements.json)
(stakeholder + system requirements, validation tests, parsed test-case catalog, and embedded live
results), generated and kept in sync by the tooling. That one file is the handoff to the standalone
**VeriTrace** viewer, which renders it and builds the IEC 62304 controlled documents — the repos
never reference each other.

From the repo root, `npm run verify` is the single entry point — it rebuilds the catalog, runs both
suites, embeds the results, and gates on drift:

```
npm run verify
  = node requirements/tools/build.mjs           # validate dataset + rebuild test-case catalog + coverage
  + node requirements/tools/sync-tests.mjs      # run the suites + embed results under testRun (fails hard on partial runs)
  + node requirements/tools/build.mjs --check   # drift gate: file must be byte-identical to a rebuild
  + node requirements/tools/drift-check.mjs     # tooling must match the veri-trace sibling checkout

npm run test:backend                            # backend suite only (node --test)
npm run e2e                                     # Playwright e2e only (builds the SPA, drives the app)
```

Authoring rule: edit `requirements.json`, then `npm run verify`. `build.mjs` rebuilds the catalog and
`meta.coverage` and stamps `meta.updated` on any content change; `sync-tests.mjs` refuses to embed a
partial or failed-to-launch run. Never hand-edit the generated catalog/coverage/result blocks. The
tools under `requirements/tools/` are identical copies shared with the VeriTrace repo — change them in
lockstep (drift-check enforces this when both checkouts sit side by side).
