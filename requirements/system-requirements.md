# BrainGain — System Requirements

<!-- GENERATED FROM requirements.json by requirements/tools/build.mjs — DO NOT EDIT BY HAND -->

> Generated from `requirements.json` · 80 requirements · updated 2026-06-03.

Each system requirement is **derived from** one or more stakeholder requirements (`SR-…`).

### Architecture & Technology

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-ARCH-01 | **Monorepo backend + frontend** — The product shall be a monorepo with a backend/ (Express + TypeScript) and a frontend/ (Vue 3 + TypeScript, Vite). | SR-100, SR-102 | Implemented |
| SYS-ARCH-02 | **Run via tsx; UUID ids** — The backend shall run via tsx (tsx watch in dev, tsx in prod) with no build step required; IDs shall be generated with crypto.randomUUID(). | SR-100, SR-106 | Implemented |
| SYS-ARCH-03 | **Vue 3 + Pinia + Router + axios** — The frontend shall use Vue 3 Composition API, Pinia for state, Vue Router 4, and axios (baseURL /api); Vite shall proxy /api to the backend. | SR-102 | Implemented |
| SYS-ARCH-04 | **Tailwind + lucide + fonts** — Styling shall use Tailwind CSS v3, icons lucide-vue-next, and Google Fonts Space Grotesk + DM Mono; no external UI component library. | SR-090, SR-091, SR-092 | Implemented |
| SYS-ARCH-05 | **JSON-file persistence** — Persistence shall be JSON files via fs/promises; there shall be no external database. | SR-101 | Implemented |
| SYS-ARCH-06 | **First-run seed** — On first run only (when no users exist), the backend shall seed an admin, a trainer, a member, a job role, two trainings, and the settings file. | SR-106 | Implemented |
| SYS-ARCH-07 | **Strict TypeScript, no any** — The codebase shall use strict TypeScript with no any types (use unknown + guards). | SR-100 | Implemented |

### Data Model & Persistence

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-DATA-01 | **Generic JSON stores** — The store shall keep users/roles/trainings/sessions as JSON arrays and settings as a single object; generic helpers auto-initialize missing files and serialize with 2-space indentation. | SR-101, SR-103 | Implemented |
| SYS-DATA-02 | **User entity** — User = { id, email, passwordHash?, name, roleIds[], isAdmin, isTrainer, entraOid?, createdAt }. passwordHash optional (SSO-only users); entraOid is the linked Entra object id. | SR-001, SR-009, SR-021, SR-022 | Implemented |
| SYS-DATA-03 | **JobRole entity** — JobRole = { id, name, description, trainingIds[] }. | SR-030, SR-031 | Implemented |
| SYS-DATA-04 | **Training entity** — Training = { id, name, description, durationHours, category, ownerId, cycleYears (1-5), windowBeforeMonths (0-3), windowAfterMonths (0-3), order, materialLinks[], questions[], createdAt }. | SR-040, SR-041, SR-042, SR-043, SR-044, SR-045, SR-046 | Implemented |
| SYS-DATA-05 | **Question; answer key stripped** — Question = { id, text, options[], correctIndex }; correctIndex shall never be sent to a non-owner (a PublicTraining shape strips it). | SR-042, SR-051 | Implemented |
| SYS-DATA-06 | **Settings entity** — Settings = { passThreshold (0-1, default 0.8), entra: { enabled, tenantId, clientId, allowedDomains[] } }; reading backfills defaults onto older files via a shallow merge. | SR-080, SR-008 | Verified |
| SYS-DATA-07 | **SafeUser strips secrets** — The client-facing SafeUser shall be Omit&lt;User, 'passwordHash' \| 'entraOid'&gt;; a shared toSafeUser() shall strip both before any user is returned. | SR-003, SR-105 | Implemented |
| SYS-DATA-08 | **TrainingSession; passes only** — TrainingSession = { id, userId, trainingId, completedAt, scorePct }; only passing attempts shall be persisted. | SR-052, SR-053 | Implemented |

### Authentication — Email/Password

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-AUTH-01 | **POST /login** — POST /api/auth/login { email, password } shall match email case-insensitively, verify with bcrypt.compare, and on success return { token, user: SafeUser }; 400 on missing fields, 401 on bad credentials. | SR-001, SR-002 | Verified |
| SYS-AUTH-02 | **bcrypt rounds 10** — Passwords shall be hashed with bcryptjs, salt rounds 10. | SR-001, SR-104 | Implemented |
| SYS-AUTH-03 | **JWT 7d** — The session token shall be a JWT signed with JWT_SECRET, payload { id, email, isAdmin, isTrainer }, expiry 7d. | SR-005 | Implemented |
| SYS-AUTH-04 | **GET /me rehydrate** — GET /api/auth/me (authenticated) shall return the current SafeUser, used to rehydrate the user after a page refresh. | SR-005 | Implemented |
| SYS-AUTH-05 | **Token storage + interceptors** — The frontend shall store the token in localStorage; axios shall attach Authorization: Bearer &lt;token&gt; to every request; on a 401 it shall clear the token and redirect to /login. | SR-005 | Implemented |
| SYS-AUTH-06 | **No registration endpoint** — There shall be no public registration endpoint. | SR-001 | Implemented |
| SYS-AUTH-07 | **SSO-only cannot password-login** — A user without a passwordHash (SSO-only) shall be unable to log in with a password (login returns 401). | SR-009, SR-010 | Verified |

### Authentication — Microsoft Entra ID SSO

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-SSO-01 | **MSAL popup → ID token** — The browser shall obtain an Entra ID token using MSAL.js (@azure/msal-browser) popup flow with scopes openid profile email. | SR-006 | Implemented |
| SYS-SSO-02 | **Public /sso/config** — GET /api/auth/sso/config (public) shall return { enabled: false }, or { enabled: true, clientId, authority } when configured; the login page shows the Microsoft button only when enabled. | SR-006, SR-007 | Verified |
| SYS-SSO-03 | **POST /sso/entra guards** — POST /api/auth/sso/entra { idToken } shall return 503 when SSO is disabled/unconfigured, 400 when idToken is absent. | SR-007 | Verified |
| SYS-SSO-04 | **ID-token validation** — The backend shall validate the ID token server-side with jwks-rsa + jsonwebtoken: enforce RS256, aud = client id, iss = https://login.microsoftonline.com/{tenant}/v2.0, tid = tenant, expiry with 300s clock tolerance; JWKS cached per tenant. Invalid tokens → 401. | SR-104, SR-006 | Verified |
| SYS-SSO-05 | **Claim extraction** — From the validated token the system shall read oid, email (email then preferred_username), and name; a token missing oid or any email shall be rejected. | SR-009 | Verified |
| SYS-SSO-06 | **Link / provision resolution** — User resolution: (1) match by entraOid; else (2) match by email and link entraOid without changing roles/admin/trainer flags — 409 if the email is already linked to a different entraOid; else (3) if the email domain is in allowedDomains, auto-create a member; else (4) 403. | SR-009 | Implemented |
| SYS-SSO-07 | **Issue same app JWT** — On success the endpoint shall issue the same app JWT (signToken) and return { token, user: SafeUser }, identical to password login, so all downstream session handling is unchanged. | SR-006, SR-010 | Implemented |
| SYS-SSO-08 | **No client secret; graceful off** — SSO shall require no client secret; its configuration shall be admin-editable and, when absent/disabled, the app shall behave exactly as a password-only app. | SR-007, SR-008, SR-105 | Verified |
| SYS-SSO-09 | **SPA registration assumptions** — Operation shall assume an Azure Single-Page Application registration, single-tenant, with the redirect URI set to the app origin and delegated permissions openid/profile/email. | SR-006 | Implemented |

### Authorization & Access Control

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-AC-01 | **Auth middleware set** — The backend shall provide middleware: authenticate (401), requireAdmin (403), requireTrainerOrAdmin (403), requireAdminOrOwner (403 unless admin or the training's owner). | SR-003, SR-004, SR-045 | Implemented |
| SYS-AC-02 | **Admin-only mutations** — All mutating endpoints on /api/roles and /api/users, and PUT /api/settings, shall require admin. | SR-003 | Implemented |
| SYS-AC-03 | **Training mutation guards** — POST /api/trainings shall require trainer-or-admin; PUT/DELETE /api/trainings/:id shall require admin-or-owner; only admins may set/change ownerId; PUT /api/trainings/reorder shall require admin. | SR-045, SR-046 | Implemented |
| SYS-AC-04 | **Router guard** — The frontend router shall enforce route meta requiresAuth/requiresAdmin/requiresTrainerOrAdmin, redirecting unauthenticated users to /login and unauthorized users to /dashboard; after a refresh it shall fetchMe() before role checks. | SR-003, SR-004 | Implemented |
| SYS-AC-05 | **Role-gated sidebar** — The sidebar shall render only the navigation items appropriate to the user's level (defense-in-depth, not the sole control). | SR-003, SR-004 | Implemented |
| SYS-AC-06 | **Permission matrix** — The system shall conform to the documented API permission matrix for every role/endpoint pair. | SR-003, SR-004 | Implemented |

### Users, Roles & their UIs

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-USR-01 | **/api/users CRUD** — /api/users shall provide admin-only CRUD: create { name, email, password, roleIds, isAdmin, isTrainer }; update with optional password (blank keeps the current one). | SR-020, SR-022 | Implemented |
| SYS-USR-02 | **Users page** — The Users page shall list users in a table and edit them in a slide-out drawer with a role multi-select and isAdmin/isTrainer toggles. | SR-020, SR-021, SR-022 | Implemented |
| SYS-ROL-01 | **/api/roles CRUD** — /api/roles shall provide admin-only CRUD. | SR-030 | Implemented |
| SYS-ROL-02 | **Role editor training multiselect** — The Role editor shall present a multi-select checkbox list of all trainings, writing the selection to trainingIds. | SR-031 | Implemented |
| SYS-ROL-03 | **Role editor honours order** — The Role editor's training list shall follow the admin-defined training order. | SR-047 | Implemented |

### Trainings, Ordering & Due Status

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-TRN-01 | **GET / ordered** — GET /api/trainings shall return trainings sorted by order ascending; admins see all, trainers may pass ?mine=1; correctIndex stripped for non-owners. | SR-040, SR-047, SR-051 | Verified |
| SYS-TRN-02 | **GET /:id** — GET /api/trainings/:id shall return one training, answer key stripped for non-owners (used by the session quiz). | SR-050 | Implemented |
| SYS-TRN-03 | **POST / append order** — POST /api/trainings shall set a trainer's own ownerId (admins may target any owner) and append the new training to the end of the order (order = max + 1). | SR-045, SR-046 | Implemented |
| SYS-TRN-04 | **PUT /:id preserves order** — PUT /api/trainings/:id shall update an owned/any training (admin-or-owner) without changing order; only admins may change ownerId. | SR-045 | Implemented |
| SYS-TRN-05 | **DELETE /:id** — DELETE /api/trainings/:id shall be permitted only to admin-or-owner. | SR-045 | Implemented |
| SYS-TRN-06 | **PUT /reorder** — PUT /api/trainings/reorder { ids[] } (admin-only) shall set each training's order to its position in the array; it shall be registered before the /:id route. | SR-046 | Verified |
| SYS-TRN-07 | **Order is single source** — The list endpoints (/, /mine, /trainees) shall sort by order; legacy records missing order shall be backfilled by file position and persisted, making order the single source of truth. | SR-046, SR-047 | Verified |
| SYS-TRN-08 | **Drag-and-drop reorder UI** — The Trainings page shall let admins reorder via drag-and-drop (grip handle); a normal row click still opens the editor; trainers shall not see the handle; dropping persists the new order via the reorder endpoint. | SR-046 | Implemented |
| SYS-TRN-09 | **Training editor fields** — The training editor shall manage cycleYears (1-5), windowBeforeMonths/windowAfterMonths (0-3), materialLinks (label+url), questions (text/options/correctIndex), and — admin only — ownerId. | SR-041, SR-042, SR-043, SR-044, SR-045 | Implemented |
| SYS-DUE-01 | **computeDue()** — A single computeDue() shall derive status from the last passing session: dueDate = lastPassed + cycleYears, windowOpen = dueDate − windowBeforeMonths, windowClose = dueDate + windowAfterMonths, yielding never/up-to-date/due/overdue; reused by both /mine and /trainees. | SR-053 | Implemented |
| SYS-DUE-02 | **GET /mine** — GET /api/trainings/mine shall return DueTraining[] for the current user's required trainings (union of role trainingIds, deduped), in order, with server-computed status. | SR-032, SR-060, SR-047 | Implemented |

### Sessions & Settings

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-SES-01 | **Session flow** — The Session page (/session/:trainingId) shall implement the flow material → quiz → result. | SR-050 | Implemented |
| SYS-SES-02 | **POST /grade server-side** — POST /api/sessions/grade { trainingId, answers[] } shall grade server-side against stored correctIndex, compare scorePct to Settings.passThreshold, persist a TrainingSession only if passed, and return { scorePct, passed, passThreshold }. | SR-051, SR-052 | Implemented |
| SYS-SES-03 | **Unlimited retries** — A learner shall be able to submit /grade repeatedly; failed attempts shall not be recorded and shall leave the due state unchanged. | SR-052 | Implemented |
| SYS-SES-04 | **GET /sessions/mine** — GET /api/sessions/mine shall return the current user's passing sessions. | SR-053 | Implemented |
| SYS-SET-01 | **GET /settings** — GET /api/settings (any authenticated user) shall return the full Settings. | SR-080 | Verified |
| SYS-SET-02 | **PUT /settings merge** — PUT /api/settings (admin) shall be a partial merge: validate/clamp passThreshold to 0.5–1 when present, and when entra is present coerce booleans, trim ids, and accept allowedDomains as an array or comma-separated string — so SSO and threshold save independently. | SR-080, SR-008 | Verified |
| SYS-SET-03 | **Settings page cards** — The Settings page shall present a pass-threshold card and an Entra ID SSO card (enable toggle; tenant id; client id; allowed domains; a hint showing the SPA redirect URI), each with its own save action. | SR-080, SR-081, SR-008 | Verified |

### Dashboard & Trainee Oversight

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-DSH-01 | **Dashboard cards** — The Dashboard shall load /api/trainings/mine and render a responsive card grid; each card shows name, description, duration, category, a due-status pill, and a Start action; an empty state shall be shown when nothing is assigned. | SR-060, SR-061 | Implemented |
| SYS-OVS-01 | **GET /trainees grouped** — GET /api/trainings/trainees shall return TraineeGroup[] (admins: all trainings; trainers: owned), grouped per training in order, each trainee carrying server-computed status and dueDate. | SR-070, SR-047 | Implemented |
| SYS-OVS-02 | **Trainees page** — The Trainees page shall show collapsible per-training groups, a 'only due/overdue' filter, and per-group + global copy-emails actions that write a '; '-separated recipient list to the clipboard with a confirming toast. | SR-070, SR-071 | Implemented |

### UX, Design & Cross-cutting Quality

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-UI-01 | **Pastel-blue palette** — The theme shall use the defined pastel-blue CSS-variable palette (background #F0F6FF, sidebar #E0EDFF, accent #2B78E4, pastel blue/cyan/mint/steel/sky/slate); no purple/rose/peach. | SR-091 | Implemented |
| SYS-UI-02 | **Typography pairing** — Headings/nav/buttons shall use Space Grotesk; body/inputs/badges/metadata shall use DM Mono (technical aesthetic). | SR-092 | Implemented |
| SYS-UI-03 | **Logo component** — A BrainGainLogo SVG component (stylized brain + upward arrow, pastel-blue gradient, size prop) shall render cleanly at 32 px, 48 px, and 256 px. | SR-090 | Implemented |
| SYS-UI-04 | **Sidebar + content layout** — The layout shall be a fixed 240 px sidebar + scrollable content, collapsing to a bottom tab bar on mobile. | SR-093 | Implemented |
| SYS-UI-05 | **Responsive & accessible** — The UI shall be responsive (375 px–1440 px) and accessible (keyboard navigable, visible focus rings, sensible aria-labels). | SR-093 | Implemented |
| SYS-UI-06 | **Loading + toasts** — Every data fetch shall show a loading/skeleton state; every API call shall be wrapped in try/catch surfacing success/error toasts via a global toast store. | SR-094 | Implemented |
| SYS-NFR-01 | **Server-side enforcement** — All security-sensitive logic — credential checks, quiz grading, ownership and access checks, and SSO token validation — shall be enforced on the server and never trusted from the client. | SR-104 | Implemented |
| SYS-NFR-02 | **No secret leakage** — The system shall never transmit passwordHash, entraOid, correctIndex, or any secret to clients, and SSO shall function without storing a client secret. | SR-051, SR-105 | Implemented |

### HTTPS & TLS

| ID | Requirement | Derived from | Status |
|---|---|---|---|
| SYS-TLS-01 | **Single HTTPS origin serves API + SPA** — The backend shall run an HTTPS server that serves both the /api routes and the built SPA (frontend/dist) from one origin; the SPA fallback returns index.html for non-/api GETs. | SR-110 | Verified |
| SYS-TLS-02 | **HTTP redirects to HTTPS** — A minimal HTTP listener shall answer every request with a 308 redirect to the HTTPS URL; no app/API content is served over HTTP. | SR-110 | Verified |
| SYS-TLS-03 | **Self-signed bootstrap on first run** — If no certificate exists at startup, the server shall generate and persist a self-signed certificate so HTTPS starts immediately (no lockout before an admin uploads a real cert). | SR-110 | Verified |
| SYS-TLS-04 | **Cert/key stored privately; metadata-only exposure** — The private key and certificate shall be stored under data/tls/ (git-ignored) and never returned by any API; only non-secret metadata (subject/issuer/validity/fingerprint/source) is surfaced via Settings. | SR-111, SR-105 | Verified |
| SYS-TLS-05 | **Upload validates + hot-swaps the certificate** — POST /api/settings/certificate (admin) shall validate the PEM and that the private key matches the certificate, then hot-swap the running server via setSecureContext (no restart). Invalid/mismatched input → 400. | SR-111 | Verified |
| SYS-TLS-06 | **Certificate endpoints are admin-only** — GET /api/settings/certificate returns metadata only; POST /api/settings/certificate and /certificate/self-signed require admin (403 otherwise). | SR-111, SR-105 | Verified |
| SYS-TLS-07 | **Settings TLS card** — The Settings page shall show the active certificate metadata and let an admin upload cert/key/chain PEM files (read client-side and POSTed) and regenerate a self-signed certificate. | SR-111 | Implemented |
| SYS-TLS-08 | **Dev server is HTTPS too** — The Vite dev server shall run over HTTPS (auto self-signed via @vitejs/plugin-basic-ssl) and proxy /api to the backend over HTTPS (secure:false). | SR-110 | Implemented |
| SYS-TLS-09 | **HSTS header** — Responses shall include a Strict-Transport-Security header so browsers only ever use HTTPS for this origin. | SR-110 | Implemented |

## Coverage (stakeholder area → system requirements)

| Stakeholder area | Stakeholder reqs | Covering system reqs |
|---|---|---|
| Authentication & Access Control | SR-001, SR-002, SR-003, SR-004, SR-005, SR-006, SR-007, SR-008, SR-009, SR-010 | SYS-DATA-02, SYS-DATA-06, SYS-DATA-07, SYS-AUTH-01, SYS-AUTH-02, SYS-AUTH-03, SYS-AUTH-04, SYS-AUTH-05, SYS-AUTH-06, SYS-AUTH-07, SYS-SSO-01, SYS-SSO-02, SYS-SSO-03, SYS-SSO-04, SYS-SSO-05, SYS-SSO-06, SYS-SSO-07, SYS-SSO-08, SYS-SSO-09, SYS-AC-01, SYS-AC-02, SYS-AC-04, SYS-AC-05, SYS-AC-06, SYS-SET-02, SYS-SET-03 |
| User Management | SR-020, SR-021, SR-022 | SYS-DATA-02, SYS-USR-01, SYS-USR-02 |
| Job Roles | SR-030, SR-031, SR-032 | SYS-DATA-03, SYS-ROL-01, SYS-ROL-02, SYS-DUE-02 |
| Trainings | SR-040, SR-041, SR-042, SR-043, SR-044, SR-045, SR-046, SR-047 | SYS-DATA-04, SYS-DATA-05, SYS-AC-01, SYS-AC-03, SYS-ROL-03, SYS-TRN-01, SYS-TRN-03, SYS-TRN-04, SYS-TRN-05, SYS-TRN-06, SYS-TRN-07, SYS-TRN-08, SYS-TRN-09, SYS-DUE-02, SYS-OVS-01 |
| Training Sessions & Assessment | SR-050, SR-051, SR-052, SR-053 | SYS-DATA-05, SYS-DATA-08, SYS-TRN-01, SYS-TRN-02, SYS-DUE-01, SYS-SES-01, SYS-SES-02, SYS-SES-03, SYS-SES-04, SYS-NFR-02 |
| Learner Dashboard | SR-060, SR-061 | SYS-DUE-02, SYS-DSH-01 |
| Trainee Oversight | SR-070, SR-071 | SYS-OVS-01, SYS-OVS-02 |
| Global Settings | SR-080, SR-081 | SYS-DATA-06, SYS-SET-01, SYS-SET-02, SYS-SET-03 |
| User Experience & Design | SR-090, SR-091, SR-092, SR-093, SR-094 | SYS-ARCH-04, SYS-UI-01, SYS-UI-02, SYS-UI-03, SYS-UI-04, SYS-UI-05, SYS-UI-06 |
| Non-Functional & Constraints | SR-100, SR-101, SR-102, SR-103, SR-104, SR-105, SR-106 | SYS-ARCH-01, SYS-ARCH-02, SYS-ARCH-03, SYS-ARCH-05, SYS-ARCH-06, SYS-ARCH-07, SYS-DATA-01, SYS-DATA-07, SYS-AUTH-02, SYS-SSO-04, SYS-SSO-08, SYS-NFR-01, SYS-NFR-02, SYS-TLS-04, SYS-TLS-06 |
| HTTPS & TLS | SR-110, SR-111 | SYS-TLS-01, SYS-TLS-02, SYS-TLS-03, SYS-TLS-04, SYS-TLS-05, SYS-TLS-06, SYS-TLS-07, SYS-TLS-08, SYS-TLS-09 |
