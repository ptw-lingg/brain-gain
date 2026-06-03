# BrainGain — Requirements Traceability Matrix

> **Status:** Living document · **Last updated:** 2026-06-03
>
> Maps each **system requirement** ([`system-requirements.md`](./system-requirements.md), `SYS-…`) to the
> code that implements it, and back to the originating **stakeholder requirement(s)**
> ([`stakeholder-requirements.md`](./stakeholder-requirements.md), `SR-…`). Paths are relative to the repo
> root. Use this to find where a requirement lives, to assess change impact, and to spot gaps.

**Legend:** `path · symbol/endpoint` identifies the file plus the function, route, or component that
realizes the requirement.

---

## A. Architecture & Technology

| SYS | Implemented by | SR |
|---|---|---|
| SYS-ARCH-01 | `backend/` + `frontend/` workspaces | SR-100, SR-102 |
| SYS-ARCH-02 | `backend/package.json` · scripts `dev`/`start` (`tsx`); UUIDs via `crypto.randomUUID()` across route files | SR-100, SR-106 |
| SYS-ARCH-03 | `frontend/src/main.ts` (Pinia+Router); `frontend/src/api/client.ts`; `frontend/vite.config.ts` · `server.proxy['/api']` | SR-102 |
| SYS-ARCH-04 | `frontend/tailwind.config.js`; `frontend/index.html` (Google Fonts); `frontend/src/style.css` | SR-090, SR-091, SR-092 |
| SYS-ARCH-05 | `backend/src/services/fileStore.ts`; `backend/src/data/*.json` | SR-101 |
| SYS-ARCH-06 | `backend/src/seed.ts` · `seed()`; invoked in `backend/src/index.ts` | SR-106 |
| SYS-ARCH-07 | `backend/tsconfig.json` / `frontend/tsconfig.json` (`strict`) | SR-100 |

## B. Data Model & Persistence

| SYS | Implemented by | SR |
|---|---|---|
| SYS-DATA-01 | `backend/src/services/fileStore.ts` · `readStore`/`writeStore`/`readSettings`/`writeSettings` | SR-101, SR-103 |
| SYS-DATA-02 | `backend/src/types.ts` · `User`; mirror `frontend/src/types/index.ts` | SR-001, SR-009, SR-021, SR-022 |
| SYS-DATA-03 | `backend/src/types.ts` · `JobRole` | SR-030, SR-031 |
| SYS-DATA-04 | `backend/src/types.ts` · `Training` | SR-040–SR-046 |
| SYS-DATA-05 | `backend/src/types.ts` · `Question`/`PublicTraining`; `backend/src/routes/trainings.ts` · `toPublic()` | SR-042, SR-051 |
| SYS-DATA-06 | `backend/src/types.ts` · `Settings`/`EntraSsoSettings`; `backend/src/services/fileStore.ts` · `DEFAULT_SETTINGS` + merge in `readSettings` | SR-080, SR-008 |
| SYS-DATA-07 | `backend/src/types.ts` · `SafeUser`; `backend/src/routes/auth.ts` · `toSafeUser()` | SR-003, SR-105 |
| SYS-DATA-08 | `backend/src/types.ts` · `TrainingSession`; `backend/src/routes/sessions.ts` (persist-if-passed) | SR-052, SR-053 |

## C. Authentication — Email/Password

| SYS | Implemented by | SR |
|---|---|---|
| SYS-AUTH-01 | `backend/src/routes/auth.ts` · `POST /login` | SR-001, SR-002 |
| SYS-AUTH-02 | `backend/src/routes/auth.ts` & `users.ts` · `bcrypt.hash(..., 10)` | SR-001, SR-104 |
| SYS-AUTH-03 | `backend/src/middleware/auth.ts` · `signToken()`, `JWT_SECRET` | SR-005 |
| SYS-AUTH-04 | `backend/src/routes/auth.ts` · `GET /me`; `frontend/src/stores/auth.ts` · `fetchMe()` | SR-005 |
| SYS-AUTH-05 | `frontend/src/api/client.ts` · request + 401 interceptors; `frontend/src/stores/auth.ts` | SR-005 |
| SYS-AUTH-06 | (Absence of a register route) `backend/src/routes/auth.ts` | SR-001 |
| SYS-AUTH-07 | `backend/src/routes/auth.ts` · `POST /login` guard `!user.passwordHash` | SR-009, SR-010 |

## D. Authentication — Microsoft Entra ID SSO

| SYS | Implemented by | SR |
|---|---|---|
| SYS-SSO-01 | `frontend/src/auth/msal.ts` · `signInWithEntra()` (`loginPopup`, scopes) | SR-006 |
| SYS-SSO-02 | `backend/src/routes/auth.ts` · `GET /sso/config`; `frontend/src/pages/LoginPage.vue` · `onMounted` fetch + `v-if="ssoEnabled"` | SR-006, SR-007 |
| SYS-SSO-03 | `backend/src/routes/auth.ts` · `POST /sso/entra` (503/400 guards) | SR-007 |
| SYS-SSO-04 | `backend/src/services/entra.ts` · `verifyEntraIdToken()`, `jwksClientFor()` | SR-104, SR-006 |
| SYS-SSO-05 | `backend/src/services/entra.ts` · claim extraction (`oid`/`email`/`preferred_username`/`name`) | SR-009 |
| SYS-SSO-06 | `backend/src/routes/auth.ts` · `POST /sso/entra` resolution (entraOid → email-link → domain-provision → 403; 409 conflict) | SR-009 |
| SYS-SSO-07 | `backend/src/routes/auth.ts` · `signToken()` + `toSafeUser()` response; `frontend/src/stores/auth.ts` · `loginWithEntra()` | SR-006, SR-010 |
| SYS-SSO-08 | `backend/src/services/entra.ts` · `isEntraConfigured()` (no secret); admin config via Settings (Section H) | SR-007, SR-008, SR-105 |
| SYS-SSO-09 | `frontend/src/auth/msal.ts` · `redirectUri: window.location.origin`; hint in `SettingsPage.vue`; docs in `brain-gain.md` | SR-006 |

## E. Authorization & Access Control

| SYS | Implemented by | SR |
|---|---|---|
| SYS-AC-01 | `backend/src/middleware/auth.ts` · `authenticate`/`requireAdmin`/`requireTrainerOrAdmin`/`requireAdminOrOwner` | SR-003, SR-004, SR-045 |
| SYS-AC-02 | `backend/src/routes/users.ts` (`router.use(authenticate, requireAdmin)`), `roles.ts`, `settings.ts` (`PUT`) | SR-003 |
| SYS-AC-03 | `backend/src/routes/trainings.ts` · `requireTrainerOrAdmin` (POST), `requireAdminOrOwner` (PUT/DELETE), `requireAdmin` (reorder) | SR-045, SR-046 |
| SYS-AC-04 | `frontend/src/router/index.ts` · `beforeEach` guard + route `meta` | SR-003, SR-004 |
| SYS-AC-05 | `frontend/src/components/AppSidebar.vue` · role-gated nav `v-if` | SR-003, SR-004 |
| SYS-AC-06 | Matrix in `brain-gain.md`; enforced by the rows above | SR-003, SR-004 |

## F. Users, Roles & their UIs

| SYS | Implemented by | SR |
|---|---|---|
| SYS-USR-01 | `backend/src/routes/users.ts` · CRUD (create requires password; update password optional) | SR-020, SR-022 |
| SYS-USR-02 | `frontend/src/pages/UsersPage.vue` · table + drawer + role multiselect + toggles | SR-020, SR-021, SR-022 |
| SYS-ROL-01 | `backend/src/routes/roles.ts` · CRUD (mutations `requireAdmin`) | SR-030 |
| SYS-ROL-02 | `frontend/src/components/RoleForm.vue` · training multiselect → `trainingIds`; `frontend/src/pages/RolesPage.vue` | SR-031 |
| SYS-ROL-03 | `frontend/src/pages/RolesPage.vue` loads `GET /trainings` (server-ordered) | SR-047 |

## G. Trainings, Ordering & Due Status

| SYS | Implemented by | SR |
|---|---|---|
| SYS-TRN-01 | `backend/src/routes/trainings.ts` · `GET /` (`readOrderedTrainings`, `?mine`, `toPublic`) | SR-040, SR-047, SR-051 |
| SYS-TRN-02 | `backend/src/routes/trainings.ts` · `GET /:id` | SR-050 |
| SYS-TRN-03 | `backend/src/routes/trainings.ts` · `POST /` (`order = max+1`, owner rules) | SR-045, SR-046 |
| SYS-TRN-04 | `backend/src/routes/trainings.ts` · `PUT /:id` (`order` preserved; admin-only `ownerId`) | SR-045 |
| SYS-TRN-05 | `backend/src/routes/trainings.ts` · `DELETE /:id` | SR-045 |
| SYS-TRN-06 | `backend/src/routes/trainings.ts` · `PUT /reorder` (registered before `/:id`) | SR-046 |
| SYS-TRN-07 | `backend/src/routes/trainings.ts` · `readOrderedTrainings()` (backfill + sort), used by `/`, `/mine`, `/trainees` | SR-046, SR-047 |
| SYS-TRN-08 | `frontend/src/pages/TrainingsPage.vue` · drag handlers (`onDragStart/Over/End`, `persistOrder`), grip `v-if="isAdmin"` | SR-046 |
| SYS-TRN-09 | `frontend/src/components/TrainingForm.vue` (cycle/window/links/questions/owner) | SR-041–SR-045 |
| SYS-DUE-01 | `backend/src/services/due.ts` · `computeDue()`, `sessionsFor()` | SR-053 |
| SYS-DUE-02 | `backend/src/routes/trainings.ts` · `GET /mine` (`requiredTrainingIds` + `computeDue`) | SR-032, SR-060, SR-047 |

## H. Sessions & Settings

| SYS | Implemented by | SR |
|---|---|---|
| SYS-SES-01 | `frontend/src/pages/SessionPage.vue` · material→quiz→result; route in `router/index.ts` | SR-050 |
| SYS-SES-02 | `backend/src/routes/sessions.ts` · `POST /grade` (server grade vs `correctIndex`, compare `passThreshold`, persist if passed) | SR-051, SR-052 |
| SYS-SES-03 | `backend/src/routes/sessions.ts` · `POST /grade` (no persist on fail); `SessionPage.vue` retry | SR-052 |
| SYS-SES-04 | `backend/src/routes/sessions.ts` · `GET /mine` | SR-053 |
| SYS-SET-01 | `backend/src/routes/settings.ts` · `GET /` | SR-080 |
| SYS-SET-02 | `backend/src/routes/settings.ts` · `PUT /` (partial merge, clamp, `sanitizeDomains`) | SR-080, SR-008 |
| SYS-SET-03 | `frontend/src/pages/SettingsPage.vue` · threshold card + Entra SSO card (`save`/`saveSso`) | SR-080, SR-081, SR-008 |

## I. Dashboard & Trainee Oversight

| SYS | Implemented by | SR |
|---|---|---|
| SYS-DSH-01 | `frontend/src/pages/DashboardPage.vue` + `frontend/src/components/TrainingCard.vue`; `frontend/src/utils/display.ts` · `dueLabel`/`dueClasses` | SR-060, SR-061 |
| SYS-OVS-01 | `backend/src/routes/trainings.ts` · `GET /trainees` (`requireTrainerOrAdmin`, grouped, ordered) | SR-070, SR-047 |
| SYS-OVS-02 | `frontend/src/pages/TraineesPage.vue` · groups, "only due" filter, copy-emails (clipboard) | SR-070, SR-071 |

## J. UX, Design & Cross-cutting Quality

| SYS | Implemented by | SR |
|---|---|---|
| SYS-UI-01 | `frontend/src/style.css` (CSS vars) + `frontend/tailwind.config.js` (palette) | SR-091 |
| SYS-UI-02 | `frontend/index.html` (font links) + `frontend/tailwind.config.js` (`fontFamily`) | SR-092 |
| SYS-UI-03 | `frontend/src/components/BrainGainLogo.vue` | SR-090 |
| SYS-UI-04 | `frontend/src/components/AppLayout.vue` + `AppSidebar.vue` | SR-093 |
| SYS-UI-05 | `frontend/src/components/*`, `frontend/src/pages/*` (responsive/aria/focus) | SR-093 |
| SYS-UI-06 | `frontend/src/stores/toast.ts` + `frontend/src/App.vue` (toast host); per-page `loading` skeletons | SR-094 |
| SYS-NFR-01 | `backend/src/middleware/auth.ts`, `routes/sessions.ts` (grading), `services/entra.ts` (token validation) | SR-104 |
| SYS-NFR-02 | `backend/src/routes/auth.ts` · `toSafeUser`; `trainings.ts` · `toPublic`; `services/entra.ts` (no secret) | SR-051, SR-105 |

---

## K. Reverse index — stakeholder requirement → system requirements → code areas

| SR | SYS | Primary code areas |
|---|---|---|
| SR-001, SR-002, SR-005 | SYS-AUTH-01…06 | `backend/src/routes/auth.ts`, `middleware/auth.ts`, `frontend/src/stores/auth.ts`, `api/client.ts` |
| SR-003, SR-004, SR-045 | SYS-AC-01…06 | `backend/src/middleware/auth.ts`, all `backend/src/routes/*`, `frontend/src/router/index.ts`, `AppSidebar.vue` |
| SR-006–SR-010 | SYS-SSO-01…09, SYS-AUTH-07 | `backend/src/services/entra.ts`, `routes/auth.ts`, `frontend/src/auth/msal.ts`, `LoginPage.vue`, `SettingsPage.vue` |
| SR-008, SR-080, SR-081 | SYS-SET-01…03, SYS-DATA-06 | `backend/src/routes/settings.ts`, `services/fileStore.ts`, `frontend/src/pages/SettingsPage.vue` |
| SR-020–SR-022 | SYS-USR-01…02 | `backend/src/routes/users.ts`, `frontend/src/pages/UsersPage.vue` |
| SR-030–SR-032 | SYS-ROL-01…03, SYS-DUE-02 | `backend/src/routes/roles.ts`, `trainings.ts`, `frontend/src/pages/RolesPage.vue`, `RoleForm.vue` |
| SR-040–SR-047 | SYS-TRN-01…09 | `backend/src/routes/trainings.ts`, `frontend/src/pages/TrainingsPage.vue`, `TrainingForm.vue` |
| SR-050–SR-053 | SYS-SES-01…04, SYS-DUE-01…02 | `backend/src/routes/sessions.ts`, `services/due.ts`, `frontend/src/pages/SessionPage.vue` |
| SR-060–SR-061 | SYS-DSH-01 | `frontend/src/pages/DashboardPage.vue`, `TrainingCard.vue`, `utils/display.ts` |
| SR-070–SR-071 | SYS-OVS-01…02 | `backend/src/routes/trainings.ts` (`/trainees`), `frontend/src/pages/TraineesPage.vue` |
| SR-090–SR-094 | SYS-UI-01…06 | `frontend/src/style.css`, `tailwind.config.js`, `index.html`, `BrainGainLogo.vue`, `stores/toast.ts`, `App.vue` |
| SR-100–SR-106 | SYS-ARCH-01…07, SYS-NFR-01…02 | `*/package.json`, `*/tsconfig.json`, `backend/src/index.ts`, `seed.ts`, `services/*` |

> **Notes on verification:** the functional rows were exercised during development — endpoint probes for
> auth/SSO/settings, a settings round-trip, drag-reorder persistence, and self-signed-key checks of
> `verifyEntraIdToken`. UI rows (`SYS-UI-*`) are verified by running the app. There are currently **no
> automated unit/integration tests** in the repo; adding them is the recommended next step to keep this
> matrix green over time.
