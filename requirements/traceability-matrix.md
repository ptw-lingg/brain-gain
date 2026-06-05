# BrainGain — Requirements Traceability Matrix

<!-- GENERATED FROM requirements.json by requirements/tools/build.mjs — DO NOT EDIT BY HAND -->

> Generated from `requirements.json` · updated 2026-06-03. Maps every system requirement to
> the code that implements it, and back to the stakeholder requirement(s) it satisfies.

### Architecture & Technology

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-ARCH-01 | `backend/`; `frontend/` | SR-100, SR-102 | — |
| SYS-ARCH-02 | `backend/package.json` · scripts dev/start (tsx); `backend/src/` · crypto.randomUUID() | SR-100, SR-106 | — |
| SYS-ARCH-03 | `frontend/src/main.ts` · Pinia+Router; `frontend/src/api/client.ts`; `frontend/vite.config.ts` · server.proxy['/api'] | SR-102 | — |
| SYS-ARCH-04 | `frontend/tailwind.config.js`; `frontend/index.html` · Google Fonts; `frontend/src/style.css` | SR-090, SR-091, SR-092 | — |
| SYS-ARCH-05 | `backend/src/services/fileStore.ts`; `backend/src/data/*.json` | SR-101 | — |
| SYS-ARCH-06 | `backend/src/seed.ts` · seed(); `backend/src/index.ts` | SR-106 | — |
| SYS-ARCH-07 | `backend/tsconfig.json`; `frontend/tsconfig.json` · strict | SR-100 | — |

### Data Model & Persistence

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-DATA-01 | `backend/src/services/fileStore.ts` · readStore/writeStore/readSettings/writeSettings | SR-101, SR-103 | — |
| SYS-DATA-02 | `backend/src/types.ts` · User; `frontend/src/types/index.ts` | SR-001, SR-009, SR-021, SR-022 | — |
| SYS-DATA-03 | `backend/src/types.ts` · JobRole | SR-030, SR-031 | — |
| SYS-DATA-04 | `backend/src/types.ts` · Training | SR-040, SR-041, SR-042, SR-043, SR-044, SR-045, SR-046 | — |
| SYS-DATA-05 | `backend/src/types.ts` · Question/PublicTraining; `backend/src/routes/trainings.ts` · toPublic() | SR-042, SR-051 | — |
| SYS-DATA-06 | `backend/src/types.ts` · Settings/EntraSsoSettings; `backend/src/services/fileStore.ts` · DEFAULT_SETTINGS + readSettings merge | SR-080, SR-008 | endpoint-probe |
| SYS-DATA-07 | `backend/src/types.ts` · SafeUser; `backend/src/routes/auth.ts` · toSafeUser() | SR-003, SR-105 | — |
| SYS-DATA-08 | `backend/src/types.ts` · TrainingSession; `backend/src/routes/sessions.ts` · persist-if-passed | SR-052, SR-053 | — |

### Authentication — Email/Password

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-AUTH-01 | `backend/src/routes/auth.ts` · POST /login | SR-001, SR-002 | endpoint-probe |
| SYS-AUTH-02 | `backend/src/routes/auth.ts` · bcrypt.hash(...,10); `backend/src/routes/users.ts` · bcrypt.hash(...,10) | SR-001, SR-104 | — |
| SYS-AUTH-03 | `backend/src/middleware/auth.ts` · signToken(), JWT_SECRET | SR-005 | — |
| SYS-AUTH-04 | `backend/src/routes/auth.ts` · GET /me; `frontend/src/stores/auth.ts` · fetchMe() | SR-005 | — |
| SYS-AUTH-05 | `frontend/src/api/client.ts` · request + 401 interceptors; `frontend/src/stores/auth.ts` | SR-005 | — |
| SYS-AUTH-06 | `backend/src/routes/auth.ts` · (no register route) | SR-001 | — |
| SYS-AUTH-07 | `backend/src/routes/auth.ts` · POST /login guard !user.passwordHash | SR-009, SR-010 | endpoint-probe |

### Authentication — Microsoft Entra ID SSO

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-SSO-01 | `frontend/src/auth/msal.ts` · signInWithEntra() (loginPopup, scopes) | SR-006 | — |
| SYS-SSO-02 | `backend/src/routes/auth.ts` · GET /sso/config; `frontend/src/pages/LoginPage.vue` · onMounted fetch + v-if ssoEnabled | SR-006, SR-007 | endpoint-probe |
| SYS-SSO-03 | `backend/src/routes/auth.ts` · POST /sso/entra (503/400 guards) | SR-007 | endpoint-probe |
| SYS-SSO-04 | `backend/src/services/entra.ts` · verifyEntraIdToken(), jwksClientFor() | SR-104, SR-006 | unit-check |
| SYS-SSO-05 | `backend/src/services/entra.ts` · claim extraction | SR-009 | unit-check |
| SYS-SSO-06 | `backend/src/routes/auth.ts` · POST /sso/entra resolution | SR-009 | code-review |
| SYS-SSO-07 | `backend/src/routes/auth.ts` · signToken() + toSafeUser(); `frontend/src/stores/auth.ts` · loginWithEntra() | SR-006, SR-010 | — |
| SYS-SSO-08 | `backend/src/services/entra.ts` · isEntraConfigured() | SR-007, SR-008, SR-105 | endpoint-probe |
| SYS-SSO-09 | `frontend/src/auth/msal.ts` · redirectUri window.location.origin; `frontend/src/pages/SettingsPage.vue` · redirect URI hint | SR-006 | — |

### Authorization & Access Control

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-AC-01 | `backend/src/middleware/auth.ts` · authenticate/requireAdmin/requireTrainerOrAdmin/requireAdminOrOwner | SR-003, SR-004, SR-045 | — |
| SYS-AC-02 | `backend/src/routes/users.ts` · router.use(authenticate, requireAdmin); `backend/src/routes/roles.ts`; `backend/src/routes/settings.ts` · PUT | SR-003 | — |
| SYS-AC-03 | `backend/src/routes/trainings.ts` · requireTrainerOrAdmin/requireAdminOrOwner/requireAdmin | SR-045, SR-046 | — |
| SYS-AC-04 | `frontend/src/router/index.ts` · beforeEach + meta | SR-003, SR-004 | — |
| SYS-AC-05 | `frontend/src/components/AppSidebar.vue` · role-gated nav v-if | SR-003, SR-004 | — |
| SYS-AC-06 | `brain-gain.md` · API permission matrix | SR-003, SR-004 | — |

### Users, Roles & their UIs

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-USR-01 | `backend/src/routes/users.ts` · CRUD | SR-020, SR-022 | — |
| SYS-USR-02 | `frontend/src/pages/UsersPage.vue` | SR-020, SR-021, SR-022 | — |
| SYS-ROL-01 | `backend/src/routes/roles.ts` · CRUD (mutations requireAdmin) | SR-030 | — |
| SYS-ROL-02 | `frontend/src/components/RoleForm.vue`; `frontend/src/pages/RolesPage.vue` | SR-031 | — |
| SYS-ROL-03 | `frontend/src/pages/RolesPage.vue` · GET /trainings (server-ordered) | SR-047 | — |

### Trainings, Ordering & Due Status

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-TRN-01 | `backend/src/routes/trainings.ts` · GET / (readOrderedTrainings, ?mine, toPublic) | SR-040, SR-047, SR-051 | endpoint-probe |
| SYS-TRN-02 | `backend/src/routes/trainings.ts` · GET /:id | SR-050 | — |
| SYS-TRN-03 | `backend/src/routes/trainings.ts` · POST / (order = max+1, owner rules) | SR-045, SR-046 | — |
| SYS-TRN-04 | `backend/src/routes/trainings.ts` · PUT /:id (order preserved; admin-only ownerId) | SR-045 | — |
| SYS-TRN-05 | `backend/src/routes/trainings.ts` · DELETE /:id | SR-045 | — |
| SYS-TRN-06 | `backend/src/routes/trainings.ts` · PUT /reorder (before /:id) | SR-046 | endpoint-probe |
| SYS-TRN-07 | `backend/src/routes/trainings.ts` · readOrderedTrainings() (backfill + sort) | SR-046, SR-047 | endpoint-probe |
| SYS-TRN-08 | `frontend/src/pages/TrainingsPage.vue` · onDragStart/Over/End, persistOrder; grip v-if isAdmin | SR-046 | — |
| SYS-TRN-09 | `frontend/src/components/TrainingForm.vue` | SR-041, SR-042, SR-043, SR-044, SR-045 | — |
| SYS-DUE-01 | `backend/src/services/due.ts` · computeDue(), sessionsFor() | SR-053 | — |
| SYS-DUE-02 | `backend/src/routes/trainings.ts` · GET /mine (requiredTrainingIds + computeDue) | SR-032, SR-060, SR-047 | — |

### Sessions & Settings

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-SES-01 | `frontend/src/pages/SessionPage.vue`; `frontend/src/router/index.ts` · session/:trainingId route | SR-050 | — |
| SYS-SES-02 | `backend/src/routes/sessions.ts` · POST /grade | SR-051, SR-052 | — |
| SYS-SES-03 | `backend/src/routes/sessions.ts` · POST /grade (no persist on fail); `frontend/src/pages/SessionPage.vue` · retry | SR-052 | — |
| SYS-SES-04 | `backend/src/routes/sessions.ts` · GET /mine | SR-053 | — |
| SYS-SET-01 | `backend/src/routes/settings.ts` · GET / | SR-080 | endpoint-probe |
| SYS-SET-02 | `backend/src/routes/settings.ts` · PUT / (merge, clamp, sanitizeDomains) | SR-080, SR-008 | endpoint-probe |
| SYS-SET-03 | `frontend/src/pages/SettingsPage.vue` · save/saveSso | SR-080, SR-081, SR-008 | endpoint-probe |

### Dashboard & Trainee Oversight

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-DSH-01 | `frontend/src/pages/DashboardPage.vue`; `frontend/src/components/TrainingCard.vue`; `frontend/src/utils/display.ts` · dueLabel/dueClasses | SR-060, SR-061 | — |
| SYS-OVS-01 | `backend/src/routes/trainings.ts` · GET /trainees (requireTrainerOrAdmin, grouped, ordered) | SR-070, SR-047 | — |
| SYS-OVS-02 | `frontend/src/pages/TraineesPage.vue` · groups, only-due filter, copy-emails | SR-070, SR-071 | — |

### UX, Design & Cross-cutting Quality

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-UI-01 | `frontend/src/style.css`; `frontend/tailwind.config.js` | SR-091 | — |
| SYS-UI-02 | `frontend/index.html` · font links; `frontend/tailwind.config.js` · fontFamily | SR-092 | — |
| SYS-UI-03 | `frontend/src/components/BrainGainLogo.vue` | SR-090 | — |
| SYS-UI-04 | `frontend/src/components/AppLayout.vue`; `frontend/src/components/AppSidebar.vue` | SR-093 | — |
| SYS-UI-05 | `frontend/src/components/*`; `frontend/src/pages/*` | SR-093 | — |
| SYS-UI-06 | `frontend/src/stores/toast.ts`; `frontend/src/App.vue` · toast host | SR-094 | — |
| SYS-NFR-01 | `backend/src/middleware/auth.ts`; `backend/src/routes/sessions.ts` · grading; `backend/src/services/entra.ts` · token validation | SR-104 | — |
| SYS-NFR-02 | `backend/src/routes/auth.ts` · toSafeUser; `backend/src/routes/trainings.ts` · toPublic; `backend/src/services/entra.ts` · no client secret | SR-051, SR-105 | — |

### HTTPS & TLS

| SYS | Implemented by | Derived from | Verified |
|---|---|---|---|
| SYS-TLS-01 | `backend/src/index.ts` · https.createServer + express.static SPA fallback | SR-110 | api |
| SYS-TLS-02 | `backend/src/index.ts` · http.createServer 308 redirect | SR-110 | api |
| SYS-TLS-03 | `backend/src/services/tls.ts` · ensureCredentials / generateSelfSigned (selfsigned) | SR-110 | manual |
| SYS-TLS-04 | `backend/src/services/tls.ts` · storeUploadedCredentials, data/tls files; `backend/src/types.ts` · TlsSettings (metadata only); `backend/.gitignore` · src/data/tls/ | SR-111, SR-105 | api |
| SYS-TLS-05 | `backend/src/routes/settings.ts` · POST /certificate; `backend/src/services/tls.ts` · validateCredentials, applyCredentials (setSecureContext) | SR-111 | api |
| SYS-TLS-06 | `backend/src/routes/settings.ts` · GET/POST /certificate (authenticate + requireAdmin) | SR-111, SR-105 | api |
| SYS-TLS-07 | `frontend/src/pages/SettingsPage.vue` · HTTPS/TLS card (onFile, saveCertificate, regenerateSelfSigned) | SR-111 | — |
| SYS-TLS-08 | `frontend/vite.config.ts` · basicSsl() + proxy https target | SR-110 | — |
| SYS-TLS-09 | `backend/src/index.ts` · HSTS middleware | SR-110 | — |

## Reverse index — stakeholder requirement → system requirements → code

| SR | Title | Satisfied by | Code areas |
|---|---|---|---|
| SR-001 | Email/password authentication | SYS-DATA-02, SYS-AUTH-01, SYS-AUTH-02, SYS-AUTH-06 | `backend/src/types.ts`, `frontend/src/types/index.ts`, `backend/src/routes/auth.ts`, `backend/src/routes/users.ts` |
| SR-002 | Land on relevant trainings after sign-in | SYS-AUTH-01 | `backend/src/routes/auth.ts` |
| SR-003 | Admin-only editing, reliably enforced | SYS-DATA-07, SYS-AC-01, SYS-AC-02, SYS-AC-04, SYS-AC-05, SYS-AC-06 | `backend/src/types.ts`, `backend/src/routes/auth.ts`, `backend/src/middleware/auth.ts`, `backend/src/routes/users.ts`, `backend/src/routes/roles.ts`, `backend/src/routes/settings.ts`, `frontend/src/router/index.ts`, `frontend/src/components/AppSidebar.vue`, `brain-gain.md` |
| SR-004 | Three access levels | SYS-AC-01, SYS-AC-04, SYS-AC-05, SYS-AC-06 | `backend/src/middleware/auth.ts`, `frontend/src/router/index.ts`, `frontend/src/components/AppSidebar.vue`, `brain-gain.md` |
| SR-005 | Persistent session | SYS-AUTH-03, SYS-AUTH-04, SYS-AUTH-05 | `backend/src/middleware/auth.ts`, `backend/src/routes/auth.ts`, `frontend/src/stores/auth.ts`, `frontend/src/api/client.ts` |
| SR-006 | Sign in with Microsoft Entra ID | SYS-SSO-01, SYS-SSO-02, SYS-SSO-04, SYS-SSO-07, SYS-SSO-09 | `frontend/src/auth/msal.ts`, `backend/src/routes/auth.ts`, `frontend/src/pages/LoginPage.vue`, `backend/src/services/entra.ts`, `frontend/src/stores/auth.ts`, `frontend/src/pages/SettingsPage.vue` |
| SR-007 | SSO optional & configurable | SYS-SSO-02, SYS-SSO-03, SYS-SSO-08 | `backend/src/routes/auth.ts`, `frontend/src/pages/LoginPage.vue`, `backend/src/services/entra.ts` |
| SR-008 | Configure SSO in-app | SYS-DATA-06, SYS-SSO-08, SYS-SET-02, SYS-SET-03 | `backend/src/types.ts`, `backend/src/services/fileStore.ts`, `backend/src/services/entra.ts`, `backend/src/routes/settings.ts`, `frontend/src/pages/SettingsPage.vue` |
| SR-009 | Domain-restricted provisioning & linking | SYS-DATA-02, SYS-AUTH-07, SYS-SSO-05, SYS-SSO-06 | `backend/src/types.ts`, `frontend/src/types/index.ts`, `backend/src/routes/auth.ts`, `backend/src/services/entra.ts` |
| SR-010 | Keep password login alongside SSO | SYS-AUTH-07, SYS-SSO-07 | `backend/src/routes/auth.ts`, `frontend/src/stores/auth.ts` |
| SR-020 | Admin manages users | SYS-USR-01, SYS-USR-02 | `backend/src/routes/users.ts`, `frontend/src/pages/UsersPage.vue` |
| SR-021 | User belongs to several roles | SYS-DATA-02, SYS-USR-02 | `backend/src/types.ts`, `frontend/src/types/index.ts`, `frontend/src/pages/UsersPage.vue` |
| SR-022 | Mark trainer/administrator | SYS-DATA-02, SYS-USR-01, SYS-USR-02 | `backend/src/types.ts`, `frontend/src/types/index.ts`, `backend/src/routes/users.ts`, `frontend/src/pages/UsersPage.vue` |
| SR-030 | Editable job-role list | SYS-DATA-03, SYS-ROL-01 | `backend/src/types.ts`, `backend/src/routes/roles.ts` |
| SR-031 | Role requires trainings | SYS-DATA-03, SYS-ROL-02 | `backend/src/types.ts`, `frontend/src/components/RoleForm.vue`, `frontend/src/pages/RolesPage.vue` |
| SR-032 | Required trainings derived from roles | SYS-DUE-02 | `backend/src/routes/trainings.ts` |
| SR-040 | Editable training list | SYS-DATA-04, SYS-TRN-01 | `backend/src/types.ts`, `backend/src/routes/trainings.ts` |
| SR-041 | Learning material links | SYS-DATA-04, SYS-TRN-09 | `backend/src/types.ts`, `frontend/src/components/TrainingForm.vue` |
| SR-042 | Multiple-choice quiz | SYS-DATA-04, SYS-DATA-05, SYS-TRN-09 | `backend/src/types.ts`, `backend/src/routes/trainings.ts`, `frontend/src/components/TrainingForm.vue` |
| SR-043 | Recurrence cycle | SYS-DATA-04, SYS-TRN-09 | `backend/src/types.ts`, `frontend/src/components/TrainingForm.vue` |
| SR-044 | Due window | SYS-DATA-04, SYS-TRN-09 | `backend/src/types.ts`, `frontend/src/components/TrainingForm.vue` |
| SR-045 | Trainer owns their trainings | SYS-DATA-04, SYS-AC-01, SYS-AC-03, SYS-TRN-03, SYS-TRN-04, SYS-TRN-05, SYS-TRN-09 | `backend/src/types.ts`, `backend/src/middleware/auth.ts`, `backend/src/routes/trainings.ts`, `frontend/src/components/TrainingForm.vue` |
| SR-046 | Admin reorders via drag-and-drop | SYS-DATA-04, SYS-AC-03, SYS-TRN-03, SYS-TRN-06, SYS-TRN-07, SYS-TRN-08 | `backend/src/types.ts`, `backend/src/routes/trainings.ts`, `frontend/src/pages/TrainingsPage.vue` |
| SR-047 | Order respected everywhere | SYS-ROL-03, SYS-TRN-01, SYS-TRN-07, SYS-DUE-02, SYS-OVS-01 | `frontend/src/pages/RolesPage.vue`, `backend/src/routes/trainings.ts` |
| SR-050 | Material → quiz → result flow | SYS-TRN-02, SYS-SES-01 | `backend/src/routes/trainings.ts`, `frontend/src/pages/SessionPage.vue`, `frontend/src/router/index.ts` |
| SR-051 | Server-side grading | SYS-DATA-05, SYS-TRN-01, SYS-SES-02, SYS-NFR-02 | `backend/src/types.ts`, `backend/src/routes/trainings.ts`, `backend/src/routes/sessions.ts`, `backend/src/routes/auth.ts`, `backend/src/services/entra.ts` |
| SR-052 | Unlimited retries; record only passes | SYS-DATA-08, SYS-SES-02, SYS-SES-03 | `backend/src/types.ts`, `backend/src/routes/sessions.ts`, `frontend/src/pages/SessionPage.vue` |
| SR-053 | Computed due status | SYS-DATA-08, SYS-DUE-01, SYS-SES-04 | `backend/src/types.ts`, `backend/src/routes/sessions.ts`, `backend/src/services/due.ts` |
| SR-060 | Dashboard of required trainings | SYS-DUE-02, SYS-DSH-01 | `backend/src/routes/trainings.ts`, `frontend/src/pages/DashboardPage.vue`, `frontend/src/components/TrainingCard.vue`, `frontend/src/utils/display.ts` |
| SR-061 | Friendly empty state | SYS-DSH-01 | `frontend/src/pages/DashboardPage.vue`, `frontend/src/components/TrainingCard.vue`, `frontend/src/utils/display.ts` |
| SR-070 | Who must take each training | SYS-OVS-01, SYS-OVS-02 | `backend/src/routes/trainings.ts`, `frontend/src/pages/TraineesPage.vue` |
| SR-071 | Filter due & copy emails | SYS-OVS-02 | `frontend/src/pages/TraineesPage.vue` |
| SR-080 | Global pass threshold | SYS-DATA-06, SYS-SET-01, SYS-SET-02, SYS-SET-03 | `backend/src/types.ts`, `backend/src/services/fileStore.ts`, `backend/src/routes/settings.ts`, `frontend/src/pages/SettingsPage.vue` |
| SR-081 | Manage SSO from Settings | SYS-SET-03 | `frontend/src/pages/SettingsPage.vue` |
| SR-090 | Polished, professional UI + icon | SYS-ARCH-04, SYS-UI-03 | `frontend/tailwind.config.js`, `frontend/index.html`, `frontend/src/style.css`, `frontend/src/components/BrainGainLogo.vue` |
| SR-091 | Pastel-blue palette | SYS-ARCH-04, SYS-UI-01 | `frontend/tailwind.config.js`, `frontend/index.html`, `frontend/src/style.css` |
| SR-092 | Technical typography | SYS-ARCH-04, SYS-UI-02 | `frontend/tailwind.config.js`, `frontend/index.html`, `frontend/src/style.css` |
| SR-093 | Responsive & accessible | SYS-UI-04, SYS-UI-05 | `frontend/src/components/AppLayout.vue`, `frontend/src/components/AppSidebar.vue`, `frontend/src/components/*`, `frontend/src/pages/*` |
| SR-094 | Clear operation feedback | SYS-UI-06 | `frontend/src/stores/toast.ts`, `frontend/src/App.vue` |
| SR-100 | TypeScript everywhere | SYS-ARCH-01, SYS-ARCH-02, SYS-ARCH-07 | `backend/`, `frontend/`, `backend/package.json`, `backend/src/`, `backend/tsconfig.json`, `frontend/tsconfig.json` |
| SR-101 | JSON-file persistence | SYS-ARCH-05, SYS-DATA-01 | `backend/src/services/fileStore.ts`, `backend/src/data/*.json` |
| SR-102 | Vue frontend | SYS-ARCH-01, SYS-ARCH-03 | `backend/`, `frontend/`, `frontend/src/main.ts`, `frontend/src/api/client.ts`, `frontend/vite.config.ts` |
| SR-103 | All entities editable via UI | SYS-DATA-01 | `backend/src/services/fileStore.ts` |
| SR-104 | Server-side security enforcement | SYS-AUTH-02, SYS-SSO-04, SYS-NFR-01 | `backend/src/routes/auth.ts`, `backend/src/routes/users.ts`, `backend/src/services/entra.ts`, `backend/src/middleware/auth.ts`, `backend/src/routes/sessions.ts` |
| SR-105 | No secrets to clients | SYS-DATA-07, SYS-SSO-08, SYS-NFR-02, SYS-TLS-04, SYS-TLS-06 | `backend/src/types.ts`, `backend/src/routes/auth.ts`, `backend/src/services/entra.ts`, `backend/src/routes/trainings.ts`, `backend/src/services/tls.ts`, `backend/.gitignore`, `backend/src/routes/settings.ts` |
| SR-106 | Easy to run; seed demo data | SYS-ARCH-02, SYS-ARCH-06 | `backend/package.json`, `backend/src/`, `backend/src/seed.ts`, `backend/src/index.ts` |
| SR-110 | HTTPS-only delivery | SYS-TLS-01, SYS-TLS-02, SYS-TLS-03, SYS-TLS-08, SYS-TLS-09 | `backend/src/index.ts`, `backend/src/services/tls.ts`, `frontend/vite.config.ts` |
| SR-111 | Admin-managed TLS certificate | SYS-TLS-04, SYS-TLS-05, SYS-TLS-06, SYS-TLS-07 | `backend/src/services/tls.ts`, `backend/src/types.ts`, `backend/.gitignore`, `backend/src/routes/settings.ts`, `frontend/src/pages/SettingsPage.vue` |
