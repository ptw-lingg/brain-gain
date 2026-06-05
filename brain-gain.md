
Claude hat die Antwort abgeschlossen
Prompt for a mondern web app called BrainGain with backend and frontend written in typescript. Datastorage is JSON file based. Need a very good icon and fantastic user interface. Simple editable list of Job Roles. Simple editable list of trainings. User management based on email adresses and password. Every User belongs to several job roles. A Job role demands for several trainings. All items are editable via user interface. If a user logs in, he should see a list of trainings. Colors in pastell

14:56

Reading frontend design skill
Reading frontend design skill
Now I'll create a comprehensive prompt document for the BrainGain web app:


BrainGain full-stack app prompt document
BrainGain full-stack app prompt document
Now let me also create a beautiful visual preview of what the app should look like:


Presented file
Presented file


Here's the complete BrainGain prompt — ready to use with any capable AI coding assistant (Claude Code, Cursor, Windsurf, etc.).

What's inside the prompt:

Full project structure — monorepo with backend/ (Express + TypeScript) and frontend/ (React + Vite + Tailwind)
JSON file storage — no database, just users.json, roles.json, trainings.json with generic read/write helpers
Auth — JWT login with bcrypt password hashing; one seeded admin (admin@braingain.app / admin123)
Complete data models — User, JobRole, Training with all relationships (roles → trainings, users → roles)
All 5 pages specified: Login, My Trainings (dashboard), Trainings admin, Job Roles admin, Users admin
Pastel design system — full CSS variable palette (lavender, mint, peach, rose, sky), Nunito + Fraunces fonts
BrainGain logo spec — brain + upward trend arrow SVG with gradient, works at all sizes
Reusable EditableList component — inline editing pattern for all admin pages
Zustand auth store + Axios interceptor for JWT
Quality requirements — no any types, loading states, responsive, accessible
The UI preview above shows the My Trainings dashboard — the pastel card grid with category pills and stat summary is exactly the target aesthetic.


Braingain prompt
Dokument · MD 
Use Vue instead of React

15:00

Datei angesehen, hat einen Befehl ausgeführt, datei lesen
Datei angesehen, hat einen Befehl ausgeführt, datei lesen
Done — the prompt is fully updated for Vue 3. Here's a summary of every React → Vue swap made:

Framework & tooling

React 18 → Vue 3.4 with @vitejs/plugin-vue (replaces @vitejs/plugin-react)
vue-tsc added for type-checking .vue files
lucide-react → lucide-vue-next
State management

Zustand → Pinia (defineStore with Composition API style using ref / computed)
Token persistence pattern kept identical (localStorage)
Routing

react-router-dom → Vue Router 4 with createRouter + createWebHistory
Navigation guards via router.beforeEach for auth + admin checks
<RouterView> with <Transition> wrapper for page animations
Components

All .tsx files → .vue Single File Components with <script setup lang="ts">
useState / useEffect → ref(), reactive(), computed(), onMounted()
Props: defineProps<{...}>() — no PropType casting
Emits: defineEmits<{...}>() with typed event signatures
v-model for two-way binding instead of controlled inputs
<TransitionGroup> for list animations, <Transition name="fade-slide"> for page transitions
Conventions section added — documents all Vue-specific rules (Composition API only, no Options API, PascalCase components, etc.) so the AI coding assistant generates idiomatic Vue 3 code.


Braingain prompt
Dokument · MD 
Pastell blue instead of purple and the fonts more technical

15:02

6 Dateien bearbeitet
6 Dateien bearbeitet
Now update the preview widget:


Presented file
Presented file


Done — prompt updated and preview refreshed. Here's what changed:

Colors — pastel blue palette

Background: 
#F0F6FF (ice blue) replacing lavender white
Sidebar: 
#E0EDFF (sky mist) replacing lavender
Accent: 
#2B78E4 (vivid sky blue) replacing purple
All pastel swatches shifted to blue/cyan/steel tones — no more rose, peach, or purple
Fonts — technical pairing

Space Grotesk (headings, nav, buttons, names) — geometric, engineered feel
DM Mono (body text, descriptions, metadata, badges) — monospaced, data-terminal aesthetic
The subtext in the preview now reads // 5 required trainings · 2 job roles · 14h total and role labels appear as product_manager — leaning into that technical tone intentionally
Border radius tightened slightly (24px → smaller) for a more precise, less bubbly feel

Braingain prompt
Dokument · MD 
Trainings, Job Roles and Users are only editable by the administrator

15:07

3 Dateien bearbeitet, datei lesen
3 Dateien bearbeitet, datei lesen
Updated. The prompt now enforces admin-only editing at all three layers — no single point of failure:

1. Vue Router guard — /trainings, /roles, /users carry meta: { requiresAdmin: true }. Any direct URL attempt by a non-admin redirects to /dashboard.

2. Sidebar v-if — the three admin nav items are not rendered in the DOM at all for regular users. No hidden elements that could be un-hidden via devtools.

3. Backend requireAdmin middleware — all POST, PUT, DELETE calls on those routes return 403 Forbidden regardless of what the frontend does. A clear API permission matrix is included showing exactly which endpoints each role can reach.

The navigation table was also updated with an "Edit access" column making the distinction explicit at a glance.


Braingain prompt
Dokument · MD 





Claude ist eine KI und kann Fehler machen. Bitte überprüfe die Antworten.


raw
Braingain prompt · MD
# BrainGain — Full-Stack Web Application Prompt
 
## Overview
 
Build **BrainGain**, a modern training management web application written entirely in **TypeScript** (frontend + backend). Data is persisted to local **JSON files**. The UI uses a **pastel color palette** with a fantastic, polished design and a distinctive app icon.
 
---
 
## Tech Stack
 
| Layer | Technology |
|---|---|
| Backend | Node.js + Express (TypeScript), run with **`tsx`** (`tsx watch` in dev) — CommonJS, no build step needed |
| Frontend | **Vue 3 + TypeScript (Vite)** |
| Styling | Tailwind CSS v3 |
| Auth | JWT (jsonwebtoken) stored in `localStorage` |
| Data | JSON file storage (no database) via `fs/promises`; IDs via Node's built-in `crypto.randomUUID()` |
| Icons | Lucide Vue Next (`lucide-vue-next`) |
| Fonts | Google Fonts — `DM Mono` (body/UI) + `Space Grotesk` (display/headings) |
| Delivery | **HTTPS only** — backend terminates TLS (`https` + `selfsigned` bootstrap) and serves the SPA; HTTP 308-redirects to HTTPS; admin uploads the certificate from Settings |
 
---
 
## Project Structure
 
```
braingain/
├── requirements/              # Requirements as linkable, traceable objects (see "Requirements & Traceability")
│   ├── requirements.json      # SINGLE SOURCE OF TRUTH — typed requirement objects + typed links
│   ├── schema/
│   │   └── requirements.schema.json   # JSON Schema (draft 2020-12) — the formal contract
│   ├── tools/
│   │   └── build.mjs          # validate + regenerate the Markdown views & the app's data copy (--check)
│   ├── README.md              # the model + maintenance workflow
│   ├── stakeholder-requirements.md   # GENERATED view — SR-… : what stakeholders need & why
│   ├── system-requirements.md        # GENERATED view — SYS-… : how the system behaves (traced to SR)
│   ├── traceability-matrix.md        # GENERATED view — SR ⇄ SYS ⇄ implementing code
│   └── validation-plan.md            # GENERATED view — VT-… : validation tests (acceptance/usability/accessibility) per SR
├── backend/
│   ├── src/
│   │   ├── index.ts            # Express app entry point + error handler
│   │   ├── seed.ts             # First-run demo seed (admin, trainer, learner, roles, trainings)
│   │   ├── types.ts            # Shared backend domain types
│   │   ├── routes/
│   │   │   ├── auth.ts         # POST /api/auth/login, GET /api/auth/me, toSafeUser()
│   │   │   ├── users.ts        # CRUD /api/users (admin) — admin creates users here
│   │   │   ├── roles.ts        # CRUD /api/roles
│   │   │   ├── trainings.ts    # /api/trainings (+ /mine, /trainees, owner rules)
│   │   │   ├── sessions.ts     # POST /api/sessions/grade, GET /api/sessions/mine
│   │   │   └── settings.ts     # GET/PUT /api/settings (+ /certificate TLS endpoints)
│   │   ├── middleware/
│   │   │   └── auth.ts         # authenticate, requireAdmin, requireTrainerOrAdmin, requireAdminOrOwner
│   │   ├── services/
│   │   │   ├── fileStore.ts    # JSON array helpers + readSettings/writeSettings
│   │   │   ├── due.ts          # computeDue() — cycle + window → DueStatus
│   │   │   ├── entra.ts        # Entra ID token verification (jwks-rsa) + provisioning helpers
│   │   │   └── tls.ts          # TLS cert load/generate/validate/store + HTTPS hot-swap (setSecureContext)
│   │   └── data/               # JSON data files (auto-created if missing)
│   │       ├── users.json
│   │       ├── roles.json
│   │       ├── trainings.json
│   │       ├── sessions.json
│   │       ├── tls/            # key.pem + cert.pem (+ chain) — git-ignored; never served or returned
│   │       └── settings.json   # single object: { passThreshold, entra }
│   ├── package.json
│   └── tsconfig.json           # CommonJS (see "Backend tsconfig" below)
│
└── frontend/
    ├── src/
    │   ├── main.ts
    │   ├── App.vue             # RouterView + global toast host
    │   ├── style.css           # Tailwind layers + CSS variables + component classes
    │   ├── env.d.ts            # vite/client + *.vue shim
    │   ├── api/
    │   │   └── client.ts       # Axios instance with JWT + 401 interceptors
    │   ├── auth/
    │   │   └── msal.ts         # MSAL.js wrapper for "Sign in with Microsoft" (popup → ID token)
    │   ├── data/
    │   │   └── requirements.generated.json  # GENERATED copy of requirements.json (imported by RequirementsPage)
    │   ├── components/
    │   │   ├── BrainGainLogo.vue   # SVG app icon component (size + wordmark props)
    │   │   ├── AppSidebar.vue
    │   │   ├── AppLayout.vue       # parent route: sidebar + nested <RouterView>
    │   │   ├── TrainingCard.vue    # dashboard card with due-status pill + Start
    │   │   ├── TrainingForm.vue    # training editor (links, questions, cycle, window, owner)
    │   │   └── RoleForm.vue        # role editor (name, desc, training multiselect)
    │   ├── pages/
    │   │   ├── LoginPage.vue
    │   │   ├── DashboardPage.vue   # User's personal training list ("My Trainings")
    │   │   ├── SessionPage.vue     # Run a training session: material → quiz → result
    │   │   ├── TrainingsPage.vue   # Admin/trainer: manage trainings (material, quiz, cycle, owner)
    │   │   ├── TraineesPage.vue    # Admin/trainer: who needs my trainings, grouped, with copy-emails
    │   │   ├── RolesPage.vue       # Admin: manage job roles
    │   │   ├── UsersPage.vue       # Admin: manage users (slide-out drawer) + role assignment
    │   │   ├── SettingsPage.vue    # Admin: edit global pass threshold + Entra SSO config
    │   │   └── RequirementsPage.vue # Admin: browse requirements objects + SR⇄SYS⇄code traces
    │   ├── stores/
    │   │   ├── auth.ts             # Pinia auth store (login, fetchMe, logout)
    │   │   └── toast.ts            # Pinia toast store (success/error)
    │   ├── router/
    │   │   └── index.ts            # Vue Router 4 routes + navigation guards
    │   ├── utils/
    │   │   └── display.ts          # due-status labels/colors, date + category helpers
    │   └── types/
    │       ├── index.ts            # Shared TypeScript types
    │       └── requirements.ts     # Types for the generated requirements dataset
    ├── public/
    │   └── favicon.svg
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    └── package.json
```

> **Note on `EditableList.vue`:** the original spec proposed one generic inline-edit list for all admin
> pages. In practice the training editor needs nested material-links and multiple-choice questions, which a
> generic list models poorly, so it was split into focused editors — **`TrainingForm.vue`**, **`RoleForm.vue`**,
> and a slide-out drawer inside **`UsersPage.vue`**. The inline expand/collapse + add/save/delete UX from the
> EditableList concept is preserved in each.
 
---
 
## Data Models (TypeScript)
 
```typescript
// types/index.ts
 
export interface Training {
  id: string;           // UUID
  name: string;
  description: string;
  durationHours: number;
  category: string;
  ownerId: string;          // trainer (User id) who owns & manages this training
  cycleYears: number;       // 1–5: how often a user must repeat the session
  windowBeforeMonths: number;  // 0–3: how many months BEFORE the due date the window opens (set by trainer)
  windowAfterMonths: number;   // 0–3: grace months AFTER the due date before it counts as overdue (set by trainer)
  order: number;            // admin-defined global display order (ascending); respected by every view
  materialLinks: MaterialLink[];   // links to OneDrive office documents
  questions: Question[];           // multiple-choice quiz for this training
  createdAt: string;
}
 
export interface MaterialLink {
  label: string;        // e.g. "Safety Handbook (OneDrive)"
  url: string;          // OneDrive office document URL
}
 
export interface Question {
  id: string;
  text: string;
  options: string[];        // 2+ answer options
  correctIndex: number;     // index into options of the single correct answer
}
 
export interface JobRole {
  id: string;
  name: string;
  description: string;
  trainingIds: string[];   // which trainings this role requires
}
 
export interface User {
  id: string;
  email: string;
  passwordHash?: string;  // bcrypt hash (never sent to frontend); absent for SSO-only users
  name: string;
  roleIds: string[];       // which job roles the user has
  isAdmin: boolean;        // can edit everything in the system
  isTrainer: boolean;      // owns & manages his own trainings only
  entraOid?: string;       // Microsoft Entra ID object id, set when an account is linked via SSO
  createdAt: string;
}
 
// A user's PASSED attempt at a training: read material, then pass the quiz.
// Only passing attempts are persisted — failed attempts are never recorded, so a
// session row always represents a completed, passing run. The user may retry the
// quiz as often as they like; until they pass, no session exists and the training
// stays in the "due" state.
export interface TrainingSession {
  id: string;
  userId: string;
  trainingId: string;
  completedAt: string;      // when the passing attempt was submitted
  scorePct: number;         // 0–1, fraction correct on the passing attempt (>= passThreshold)
}
 
// Global, admin-editable system settings (single object, not a list).
export interface EntraSsoSettings {
  enabled: boolean;
  tenantId: string;          // Directory (tenant) ID
  clientId: string;          // Application (client) ID
  allowedDomains: string[];  // email domains permitted to auto-provision a new member
}
export interface Settings {
  passThreshold: number;    // 0–1, default 0.8 — applies to ALL trainings at once
  entra: EntraSsoSettings;  // Microsoft Entra ID SSO config (admin-editable; holds no secrets)
}
 
// Frontend-safe user (no passwordHash, no entraOid)
export type SafeUser = Omit<User, 'passwordHash' | 'entraOid'>;

// Answer-stripped training — what a learner receives (no correctIndex on questions).
// Returned by GET /api/trainings (non-owners), GET /api/trainings/:id, and inside /mine.
export type PublicTraining = Omit<Training, 'questions'> & {
  questions: Omit<Question, 'correctIndex'>[];
};
```

> The backend `types.ts` mirrors these and adds the API helper types `DueStatus`, `DueTraining`, `TraineeGroup`,
> and `AuthUser` (the JWT payload). On the frontend, `Question.correctIndex` is declared **optional** since it is
> absent whenever the learner fetches a training.
 
---
 
## Backend Specification
 
### `fileStore.ts` — Generic JSON Store
 
```typescript
// Generic array helpers:
async function readStore<T>(file: 'users' | 'roles' | 'trainings' | 'sessions'): Promise<T[]>
async function writeStore<T>(file: 'users' | 'roles' | 'trainings' | 'sessions', data: T[]): Promise<void>
 
// Single-object helpers for settings.json (not an array):
async function readSettings(): Promise<Settings>            // auto-inits passThreshold 0.8 + disabled entra defaults
async function writeSettings(data: Settings): Promise<void>
```
 
- Array files stored at `backend/src/data/*.json` (`users`, `roles`, `trainings`, `sessions`)
- `settings.json` holds a single `Settings` object, not an array
- Auto-initialize with `[]` (arrays) or the default `Settings` (`passThreshold: 0.8` + disabled `entra`) if the file doesn't exist; the shallow merge backfills new fields onto older settings files
- Parse/stringify with 2-space indentation
### Auth Routes (`/api/auth`)
 
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/login` | `{ email, password }` | `{ token, user: SafeUser }` |
| GET | `/me` | — (auth) | `SafeUser` for the current token — used to rehydrate the user after a page refresh |
| GET | `/sso/config` | — (public) | `{ enabled: false }`, or `{ enabled: true, clientId, authority }` when Entra SSO is on. The login page reads this **before** authenticating to decide whether to show the Microsoft button and how to init MSAL |
| POST | `/sso/entra` | `{ idToken }` | Exchange a Microsoft Entra **ID token** (obtained in the browser via MSAL) for our own app JWT. Returns `{ token, user: SafeUser }` — same shape as `/login`. `503` if SSO is disabled, `401` if the token is invalid, `403` if the email's domain is not allowed, `409` if the email is already linked to a different Microsoft account |
 
- There is **no public `/register`** — admins create users via `POST /api/users` (below).
- Hash passwords with `bcryptjs` (salt rounds: 10)
- Sign JWT with `JWT_SECRET` env var (default `braingain-secret`)
- Token payload: `{ id, email, isAdmin, isTrainer }`
- Token expiry: `7d`
- A shared `toSafeUser()` helper strips `passwordHash` and `entraOid` before any user is returned.

#### Microsoft Entra ID (Azure AD) SSO

SSO is **optional and admin-configured** (see the Settings page) — when off, the app behaves exactly as a
password-only app. The flow reuses the existing JWT session end-to-end:

1. The browser signs in with **MSAL.js** (`@azure/msal-browser`, popup flow) and obtains an Entra **ID token**.
2. It POSTs the ID token to `POST /api/auth/sso/entra`.
3. The backend (`services/entra.ts`) **validates** the token against Microsoft's public keys via `jwks-rsa` +
   `jsonwebtoken`: RS256 signature, `aud` = client ID, `iss` = `https://login.microsoftonline.com/{tenant}/v2.0`,
   `tid` = tenant ID, expiry (5-min clock tolerance). It extracts `oid`, `email`/`preferred_username`, `name`.
4. **User resolution (domain-restricted auto-provision):** match a local user by `entraOid`, else by email
   (linking `entraOid` to the existing user — roles/admin flags are never changed). If no match and the email
   domain is in `Settings.entra.allowedDomains`, auto-create a **member-level** user (no password); otherwise
   reject. An empty allow-list means SSO only works for users that already exist.
5. The backend issues the same app JWT via `signToken(...)`, so the axios interceptor, router guard, `/me`, and
   all `require*` guards are unchanged. No client secret is used (ID-token validation only), which is why the
   config can safely live in admin-editable `Settings`.

**Azure app registration:** platform **Single-page application (SPA)**, redirect URI = the app origin (e.g.
`http://localhost:5173`), single-tenant, delegated permissions **openid / profile / email**.
### Users Routes (`/api/users`) — Admin only
 
| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/` | — | List all users (SafeUser) |
| GET | `/:id` | — | Single user |
| POST | `/` | `{ name, email, password, roleIds, isAdmin, isTrainer }` | Create user (this replaces `/register`) |
| PUT | `/:id` | `{ name, email, roleIds, isAdmin, isTrainer, password? }` | Update user (`password` optional — blank keeps current) |
| DELETE | `/:id` | — | Delete user |
 
### Roles Routes (`/api/roles`) — Admin only
 
| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/` | — | List all roles |
| POST | `/` | `{ name, description, trainingIds }` | Create role |
| PUT | `/:id` | `{ name, description, trainingIds }` | Update role |
| DELETE | `/:id` | — | Delete role |
 
### Trainings Routes (`/api/trainings`) — Auth required (mutations: admin OR owning trainer)
 
Create/update body: `{ name, description, durationHours, category, cycleYears, windowBeforeMonths, windowAfterMonths, materialLinks, questions, ownerId? }`.
 
| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/` | — | List trainings, **sorted by `order` ascending**. Admins see all; trainers may pass `?mine=1` to list only the trainings they own. Answer keys (`correctIndex`) are stripped for anyone who is not the owner/admin |
| PUT | `/reorder` | `{ ids: string[] }` | **Admin only.** Set the global display order — each training's `order` becomes its position in the supplied id array. Registered **before** `/:id`. Returns the full list sorted by the new order |
| GET | `/mine` | — | The **current user's required trainings** (derived via their job roles → trainingIds, deduped) each wrapped with its computed due status. Powers the My Trainings dashboard. Returns `DueTraining[]` (see shape below) |
| GET | `/trainees` | — | **Admin or trainer.** For each training (admin: all; trainer: only owned), the users who must do it — derived via job roles → trainingIds — each with their computed due status. See shape below |
| GET | `/:id` | — | Single training, answer key stripped for non-owners (used by the session quiz) |
| POST | `/` | create body | Create training. **Admin or trainer.** A trainer's new training gets `ownerId = req.user.id`; an admin may set any `ownerId`. New trainings are appended to the end of the order (`order = max(order) + 1`) |
| PUT | `/:id` | create body | Update training. **Admin or the owning trainer only** (`requireAdminOrOwner`). Only admins may change `ownerId`. `order` is **not** mutated here — it is managed only via `PUT /reorder` |
| DELETE | `/:id` | — | Delete training. **Admin or the owning trainer only** |
 
> Route order matters: the literal paths `/mine`, `/trainees`, and `/reorder` are registered **before** the `/:id`
> param route (otherwise `"reorder"` is captured as an id).
> Due-status logic lives in one place — `services/due.ts` `computeDue()` — and is reused by both `/mine` and
> `/trainees`, so the dashboard and the trainer view never drift apart.
>
> **Ordering is the single source of truth across every view.** `GET /`, `/mine`, and `/trainees` all return
> trainings sorted by `order`, so the dashboard, the trainings admin, the trainees view, and the role editor's
> training list stay consistently ordered. A shared read helper backfills `order` for any legacy record missing it
> (by current file position) and persists it once, so `order` becomes authoritative from then on.
 
`GET /api/trainings/mine` response shape:
```typescript
interface DueTraining {
  training: PublicTraining   // questions without correctIndex
  status: DueStatus
  dueDate: string | null
  lastPassedAt: string | null
}
```
 
`GET /api/trainings/trainees` response shape (server computes due status the same way the dashboard does — see
DashboardPage — reusing `cycleYears` + `windowBeforeMonths`/`windowAfterMonths` against each user's last passed session):
```typescript
type DueStatus = 'never' | 'up-to-date' | 'due' | 'overdue'
interface TraineeGroup {
  training: Training
  trainees: {
    user: SafeUser
    status: DueStatus
    dueDate: string | null      // null if never passed
  }[]
}
// Response: TraineeGroup[]
```
A user "needs" a training if any of their `roleIds` maps to a `JobRole` whose `trainingIds` includes that training.
 
### Sessions Routes (`/api/sessions`) — Auth required (each user's own sessions)
 
| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/grade` | `{ trainingId, answers: number[] }` | Grade `answers` against the training's `questions` **server-side**, compute `scorePct`, compare to the global `Settings.passThreshold`. **Only if passed**, persist a `TrainingSession` for the current user. Returns `{ scorePct, passed, passThreshold }` |
| GET | `/mine` | — | Current user's passed sessions (used to compute last-passed date and next-due per training) |
 
> The user may submit `/grade` **as often as they like**. A failed attempt is **not recorded** — nothing is
> persisted and the training stays in its current due state. Only a passing attempt creates a `TrainingSession`.
> Grading is done **on the server** from the stored `correctIndex` values. The client never submits a score, and
> `correctIndex` is not exposed via `GET /api/trainings` for non-owners (strip it from the quiz a user is about to take).
 
### Settings Routes (`/api/settings`)
 
| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/` | — | Any authenticated user — read the full `Settings` (`passThreshold` + `entra` + `tls` metadata). SSO/TLS fields are not secrets |
| PUT | `/` | `{ passThreshold?, entra? }` | **Admin only** — **partial merge**: only the fields present are updated, so saving SSO config and the pass threshold are independent. `entra` is sanitized (booleans coerced, ids trimmed, `allowedDomains` accepts an array or a comma-separated string). `tls` is **not** settable here |
| GET | `/certificate` | — | **Admin only** — current TLS certificate **metadata only** (subject/issuer/validity/fingerprint/source); never the key |
| POST | `/certificate` | `{ cert, key, chain? }` (PEM) | **Admin only** — validate the cert + that the key matches it, persist under `data/tls/`, **hot-swap** the running HTTPS server (`setSecureContext`), store metadata. 400 on invalid/mismatched |
| POST | `/certificate/self-signed` | — | **Admin only** — regenerate + apply a fresh self-signed certificate (revert) |
 
### HTTPS / TLS delivery
 
The app is delivered **only over HTTPS**. The backend terminates TLS and serves both the API and the built
SPA (`frontend/dist`) from one HTTPS origin (`services/tls.ts` + `index.ts`):
- **Bootstrap:** on first run, if no certificate exists, a **self-signed** cert is generated (`selfsigned`) and
  stored under `backend/src/data/tls/` so HTTPS starts immediately (no lockout before an upload).
- **Admin upload:** the Settings page posts cert/key/chain PEM to `POST /api/settings/certificate`; the server
  validates (PEM parses and the private key matches the cert), persists the files, and hot-swaps the live
  server via `setSecureContext` — no restart. The **private key is never returned** by any API; only `tls`
  metadata is exposed.
- **HTTP off:** a tiny HTTP listener (`HTTP_PORT`, default 3000) answers only with a **308 redirect** to the
  HTTPS URL — no app/API content is served over HTTP. An **HSTS** header is set on all responses.
- **Ports/env:** `HTTPS_PORT` (default 3001) and `HTTP_PORT` (default 3000). The Vite dev server also runs
  HTTPS (`@vitejs/plugin-basic-ssl`) and proxies `/api` to the HTTPS backend (`secure:false` for self-signed).
 
### Auth Middleware
 
```typescript
// authenticate:          attaches decoded JWT to req.user; 401 if missing/invalid token
// requireAdmin:          403 if user is not admin
// requireTrainerOrAdmin: 403 unless isAdmin || isTrainer (for POST /trainings, /trainees view)
// requireAdminOrOwner:   for training PUT/DELETE — allows req.user.isAdmin
//                        OR req.user.id === training.ownerId; else 403 (async: loads the training)
```
 
### Seed Data (auto-seed on first run — only when `users.json` is empty)

`seed.ts` creates three demo users, a job role, two trainings, and the settings file:

| Email | Password | Access |
|---|---|---|
| `admin@braingain.app` | `admin123` | `isAdmin: true` |
| `trainer@braingain.app` | `trainer123` | `isTrainer: true` — owns the seeded trainings |
| `user@braingain.app` | `user123` | member, holds the "Lab Technician" role |

- Role **Lab Technician** requires both seeded trainings.
- Trainings **"Laboratory Safety Basics"** (`cycleYears: 1`, `order: 0`) and **"Quality Management Intro"**
  (`cycleYears: 3`, `order: 1`), each owned by the trainer, with `materialLinks` (OneDrive URLs) and 2–3 `questions`.
- `settings.json` seeded with `{ passThreshold: 0.8 }`.
 
Seed `settings.json` with `{ passThreshold: 0.8 }`.
---
 
## Frontend Specification
 
### Design System — Pastel Blue Theme
 
```css
/* CSS Variables */
--bg-primary: #F0F6FF;        /* soft ice blue white */
--bg-card: #FFFFFF;
--bg-sidebar: #E0EDFF;        /* muted sky blue */
 
--pastel-blue: #B8D8FF;
--pastel-cyan: #B8F0F8;
--pastel-mint: #B8F0E0;
--pastel-steel: #C8DAEE;
--pastel-sky: #D0EEFF;
--pastel-slate: #D8E8F8;
 
--text-primary: #0F1E36;      /* deep navy */
--text-muted: #4A6080;
--text-light: #7A9AB8;
 
--accent: #2B78E4;            /* vivid sky blue accent */
--accent-light: #B8D8FF;
 
--border: #CCE0F8;
--shadow: rgba(43, 120, 228, 0.07);
 
--radius-sm: 6px;
--radius-md: 12px;
--radius-lg: 18px;
--radius-xl: 24px;
```
 
### App Icon / Logo (`BrainGainLogo.vue`)
 
Single-file component (`<template>` + no `<script>` needed, or a simple `defineComponent`).
Design an SVG icon showing a **stylized brain** with an **upward trend arrow** growing out of it — symbolizing knowledge growth. Use pastel blue gradients (ice blue → cyan). The brain outline is clean and slightly geometric — not soft/rounded, but with crisp technical edges. The arrow is precise and data-driven in style. Below the icon, the wordmark "BrainGain" uses `Space Grotesk` bold with a cool blue gradient. The icon should work at 32px (favicon), 48px (sidebar), and 256px (splash). Accept a `size` prop (default `48`).
 
### Layout
 
- **AppSidebar** (240px, fixed left): Logo at top, nav links, user avatar + name at bottom
- **Main content** area: scrollable, padded
- **Mobile**: Sidebar collapses to bottom tab bar
### Navigation
 
| Page | Icon | Visible to | Edit access |
|---|---|---|---|
| My Trainings | `BookOpen` | All users | Run sessions (personal view) |
| Trainings | `GraduationCap` | Admins + trainers | Admin: all trainings · Trainer: only his own |
| Trainees | `ClipboardList` | Admins + trainers | Read-only — who must do my trainings + copy emails |
| Job Roles | `Briefcase` | Admins only | Full CRUD |
| Users | `Users` | Admins only | Full CRUD |
| Settings | `SlidersHorizontal` | Admins only | Edit global pass threshold + Entra SSO config |
| Requirements | `ListChecks` | Admins only | Read-only — browse requirement objects + `SR⇄SYS⇄code` traces |
 
> Regular users (neither admin nor trainer) see **only** the "My Trainings" page. Trainers additionally see "Trainings" but their list is filtered to trainings they own. The "Job Roles", "Users", "Settings", and "Requirements" items appear for admins only. Navigating directly to a forbidden route redirects to `/dashboard`.
 
### Pages
 
#### `LoginPage.vue`
 
- Centered card on the ice-blue background
- Large BrainGain logo + tagline: *"Grow what you know."* in `DM Mono`
- Email + password inputs with floating labels, monospaced input text
- Animated submit button with loading state (use `ref<boolean>` for loading)
- Soft drop shadow, rounded card (`border-radius: 24px`)
- No registration form needed (admin creates users)
- On success: `router.push('/dashboard')`
- **"Sign in with Microsoft" button (Entra ID SSO):** on mount, fetch `GET /api/auth/sso/config`; only when
  `enabled` is the button shown (below an "or" divider). Clicking it opens the MSAL popup
  (`auth/msal.ts` → `signInWithEntra`), then calls `authStore.loginWithEntra(idToken)` and redirects to
  `/dashboard`. Backend errors (401/403/503) surface in the same error line as password login; a cancelled
  popup is ignored. The password form and demo accounts remain.
#### `DashboardPage.vue` — "My Trainings"
 
- Greeting: `"Good morning, [Name] 🌱"` (computed from `authStore.user.name`)
- Shows all trainings required by the user's assigned job roles
- Deduplicated (if multiple roles share a training, show once)
- **TrainingCard.vue**: pastel-blue-tinted card (color varies by `category` via a `computed` map)
  - Training name (bold, `Space Grotesk`)
  - Description (`DM Mono` at 13px for a data-terminal feel)
  - Duration badge (`durationHours h`) in monospaced pill
  - Category pill
  - **Due status** pill — the `status`/`dueDate` come straight from the server (`computeDue` in `services/due.ts`),
    so the card only renders them. The status is derived from the last *passed* session, `cycleYears`, and the
    per-training window: `dueDate = lastPassedAt + cycleYears`,
    `windowOpen = dueDate − windowBeforeMonths`, `windowClose = dueDate + windowAfterMonths`:
    - `never` (never passed) → "Due now" (warning tone)
    - `up-to-date` (`now < windowOpen`) → "Up to date · due {dueDate}" (mint tone — not yet actionable)
    - `due` (`windowOpen ≤ now ≤ windowClose`) → "Due now · by {dueDate}" (accent tone)
    - `overdue` (`now > windowClose`) → "Overdue" (warning tone)
    - the label/colour mapping lives in `utils/display.ts` (`dueLabel`, `dueClasses`) and is shared with the
      Trainees page so both views read identically.
  - **"Start session"** button → `router.push('/session/' + training.id)`. Softened (not hidden) while the
    training is still `up-to-date`, since it is not yet due.
- Cards arranged in a responsive grid (3 columns → 2 → 1)
- Empty state: friendly illustration + "No trainings yet. Ask your admin to assign you a role."
- Data: a single `GET /api/trainings/mine` in `onMounted` returns `DueTraining[]` with due status already
  computed server-side — no client-side merging of roles/sessions/settings needed.
#### `SessionPage.vue` — Run a training session
 
Route `/session/:trainingId`, auth required. A 3-step flow:
1. **Material** — list the training's `materialLinks` as clickable cards opening the OneDrive office documents in a
   new tab. A "Start test" button advances to the quiz.
2. **Quiz** — render each `Question` with its `options` as radio buttons (`v-model` an answers array). The
   `correctIndex` is **not** present in the data the client receives. "Submit" posts `{ trainingId, answers }` to
   `POST /api/sessions/grade`.
3. **Result** — show the returned `scorePct` vs `passThreshold`: a green "Passed 🎉" or a "Not passed — you need
   {threshold}%" state with a **"Retry" button that restarts at step 2 — the user can retry as often as they want**.
   Failed attempts are not recorded, so the training simply stays "due". On pass, link back to "My Trainings".
#### `TrainingsPage.vue` — Admin / Trainer
 
- Header with "Trainings" title + "Add Training" button
- Admins see all trainings; trainers fetch with `?mine=1` and see/edit only trainings they own
- Rows expand/collapse inline; the expanded editor is the reusable **`TrainingForm.vue`** component (used for both
  the "new" draft at the top and editing an existing row)
- Each row: name, description, duration, category — editable inline. Expanded editor also manages:
  - **`cycleYears`** — 1–5 selector (how often the session must be repeated)
  - **`windowBeforeMonths` / `windowAfterMonths`** — two 0–3 selectors defining the due window: how many months
    before the recurrence date the training becomes available, and the grace months after it before it is overdue
  - **`materialLinks`** — add/remove rows of `{ label, url }` (OneDrive document links)
  - **`questions`** — add/remove multiple-choice questions; each has editable `text`, a list of `options`, and a
    radio to pick the single `correctIndex`
  - **`ownerId`** — **admin only**: a select to assign the owning trainer. Trainers cannot reassign ownership.
- Click row to expand and edit; "Save" / "Cancel" buttons appear
- Delete with confirmation popover (use `v-if` toggle)
- Soft row hover: pastel highlight
- **Drag-and-drop reordering (admin only):** each row shows a grip handle (`GripVertical`) on the left. Admins drag
  rows to set the global training order using native HTML5 drag events (no extra dependency). A `dragEnabled` flag is
  flipped on the handle's `mousedown` so the row is only `:draggable` when grabbed by the handle — a normal click
  still expands the editor. Rows reorder live during `dragover`; on `drop` the new id sequence is persisted via
  `PUT /api/trainings/reorder` (toast on success; reload to restore the server order on failure). Trainers (who see
  only their own filtered subset) do not get the handle. Because every view reads the server's `order`, dragging here
  reorders the dashboard cards, the trainees groups, and the role editor's training list too.
#### `TraineesPage.vue` — Admin / Trainer
 
- Data: `GET /api/trainings/trainees` in `onMounted` → `TraineeGroup[]`. Trainers get only their owned trainings;
  admins get all.
- Rendered as **collapsible groups, one per training** (group header = training name + a count of trainees and how
  many are currently due/overdue).
- Within a group, a list of trainees: name, email (`DM Mono`), and a **due-status pill** reusing the same tones as
  the dashboard (`up-to-date` muted · `due` accent · `overdue`/`never` warning) plus the `dueDate`.
- Optional filter toggle: "Only show due / overdue" to focus on who actually needs reminding.
- **Copy emails button** per group (and a "Copy all" at the top): collects the trainee email addresses — by default
  only those who are `due`/`overdue`/`never`, all of them if the filter is off — and writes them to the clipboard as
  a `; `-separated list via `navigator.clipboard.writeText(...)`, ready to paste into a mail client's recipients
  field. Show a toast "Copied N email addresses".
- Empty state: "No one is currently assigned to your trainings."
#### `RolesPage.vue` — Admin
 
- Same expand-inline pattern as Trainings; the editor is the reusable **`RoleForm.vue`** component
- Each role row expands to show a **multi-select checkbox list** of all trainings (loaded via `onMounted`)
- User can check/uncheck which trainings this role demands
- Save updates `trainingIds` on the role
#### `UsersPage.vue` — Admin
 
- Table of all users: name, email, roles, and an access badge (admin / trainer / member)
- "Add User" opens the same drawer in create mode (name, email, **password**, role assignment, toggles)
- Click user → slide-out panel (right drawer, `Transition` + overlay)
- Drawer shows: name (editable), email (editable), optional new password, isAdmin toggle
- Multi-select checkboxes for job roles assignment
- **isTrainer** toggle (alongside the isAdmin toggle) — marks a user as a trainer who can own trainings
- Save / Delete buttons
#### `SettingsPage.vue` — Admin
 
- **Pass threshold card:** the global **pass threshold** for all trainings, shown as a percentage. Slider or
  number input (range 50–100%), bound to `passThreshold` (stored as a 0–1 fraction). "Save" calls
  `PUT /api/settings { passThreshold }`; a toast confirms the change applies to every training at once.
- **Microsoft Entra ID (SSO) card:** admin-editable SSO config — an **Enabled** toggle plus **Directory
  (tenant) ID**, **Application (client) ID**, and **Allowed email domains** (comma-separated). Shows the SPA
  redirect URI to register (the app origin). Its own "Save" calls `PUT /api/settings { entra }` (independent of
  the threshold via the partial-merge PUT). This is the single source of truth that drives both the login-page
  button (`/auth/sso/config`) and backend token validation.
- **HTTPS / TLS certificate card:** shows the active certificate metadata (source, subject, issuer, validity,
  fingerprint) with a warning when self-signed or expired, and file pickers for **Certificate**, **Private
  key**, and optional **Chain** (PEM, read client-side via `FileReader` and POSTed to
  `/settings/certificate`), plus a **Regenerate self-signed** action. The private key is sent to the server but
  never returned.
- `meta: { requiresAdmin: true }`
### Admin Guard — Three Layers of Enforcement
 
Access control must be enforced at all three levels — not just the UI:
 
**1. Vue Router guard (frontend routing)**
```typescript
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.token) return '/login'
  if (to.meta.requiresAdmin && !auth.user?.isAdmin) return '/dashboard'
  if (to.meta.requiresTrainerOrAdmin && !(auth.user?.isAdmin || auth.user?.isTrainer)) return '/dashboard'
})
```
`/roles`, `/users`, `/settings` carry `meta: { requiresAdmin: true }`; `/trainings` carries
`meta: { requiresTrainerOrAdmin: true }`.
 
**2. Sidebar visibility (frontend UI)**
```vue
<!-- AppSidebar.vue -->
<template v-if="authStore.user?.isAdmin || authStore.user?.isTrainer">
  <NavItem to="/trainings" icon="GraduationCap" label="Trainings" />
  <NavItem to="/trainees" icon="ClipboardList" label="Trainees" />
</template>
<template v-if="authStore.user?.isAdmin">
  <NavItem to="/roles" icon="Briefcase" label="Job Roles" />
  <NavItem to="/users" icon="Users" label="Users" />
  <NavItem to="/settings" icon="SlidersHorizontal" label="Settings" />
</template>
```
Regular users see only the "My Trainings" nav item; trainers also see "Trainings". Admin-only pages are not rendered in the DOM for anyone else.
 
**3. Backend middleware (API)**
Mutating endpoints on `/api/roles` and `/api/users` require `requireAdmin`. Mutating endpoints on
`/api/trainings` require `requireAdminOrOwner` (admin, or the trainer who owns that training). `PUT /api/settings`
requires `requireAdmin`.
```typescript
// middleware/auth.ts
export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Forbidden' })
  next()
}
// For training PUT/DELETE: load the training and check ownership.
export async function requireAdminOrOwner(req, res, next) {
  if (req.user?.isAdmin) return next()
  const training = (await readStore<Training>('trainings')).find(t => t.id === req.params.id)
  if (training && training.ownerId === req.user?.id) return next()
  return res.status(403).json({ error: 'Forbidden' })
}
```
`POST /api/trainings` allows admins and trainers (`req.user.isAdmin || req.user.isTrainer`). The `GET /api/users`
list endpoint requires admin — regular users may only call `GET /api/trainings`, `GET /api/roles` (read-only, to
resolve role names), `GET /api/settings`, and the `/api/sessions` endpoints for their own sessions.
 
**API permission matrix:**
 
| Endpoint | Regular user | Trainer | Admin |
|---|---|---|---|
| `GET /api/trainings` | ✅ Read | ✅ Read (`?mine=1` for own) | ✅ Read |
| `GET /api/trainings/trainees` | ❌ 403 | ✅ own trainings | ✅ all |
| `POST /api/trainings` | ❌ 403 | ✅ (owns result) | ✅ |
| `PUT/DELETE /api/trainings/:id` | ❌ 403 | ✅ own only | ✅ |
| `PUT /api/trainings/reorder` | ❌ 403 | ❌ 403 | ✅ |
| `GET /api/roles` | ✅ Read | ✅ Read | ✅ Read |
| `POST/PUT/DELETE /api/roles` | ❌ 403 | ❌ 403 | ✅ |
| `GET/PUT/DELETE /api/users` | ❌ 403 | ❌ 403 | ✅ |
| `POST /api/sessions/grade`, `GET /api/sessions/mine` | ✅ own | ✅ own | ✅ own |
| `GET /api/settings` | ✅ Read | ✅ Read | ✅ Read |
| `PUT /api/settings` | ❌ 403 | ❌ 403 | ✅ |
| `GET/POST /api/settings/certificate`, `POST …/self-signed` | ❌ 403 | ❌ 403 | ✅ (metadata only; key never returned) |
| `GET /api/auth/sso/config` | ✅ Public (pre-login) | ✅ | ✅ |
| `POST /api/auth/sso/entra` | ✅ Public (pre-login) | ✅ | ✅ |
| `GET /api/auth/me` | ✅ Own profile | ✅ | ✅ |
 
 
 
### Editor Components (in place of a generic EditableList)

Each admin page owns its list/row logic (fetch, add, expand, save, delete, confirm-delete) and delegates the
*form fields* to a focused, strongly-typed child component. The pages pass the editing buffer (`draft`) by
reference and the child mutates it via `v-model`; the page handles persistence.

```typescript
// TrainingForm.vue
defineProps<{ draft: Training; isAdmin: boolean; owners: SafeUser[] }>()
defineEmits<{
  'add-link': []; 'remove-link': [i: number]
  'add-question': []; 'remove-question': [i: number]
  'add-option': [q: Question]; 'remove-option': [q: Question, oi: number]
}>()

// RoleForm.vue
defineProps<{ draft: JobRole; trainings: Training[] }>()
defineEmits<{ toggle: [id: string] }>()
```

- Lists show items as rows; clicking a row expands it into the editor in place
- "Add new" opens an empty draft at the top of the list
- Each row has save / cancel and a delete with an inline confirm (`v-if` toggle)
- Animation: smooth expand/collapse via Vue `<Transition>` (`list` transition in `style.css`)
- The Users page uses the same idea but in a right-hand **drawer** rather than an inline row
### State Management (Pinia)
 
```typescript
// stores/auth.ts
export const useAuthStore = defineStore('auth', () => {
  const user = ref<SafeUser | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))
 
  async function login(email: string, password: string): Promise<void> { ... }
  async function fetchMe(): Promise<void> { ... }   // GET /auth/me — rehydrate user after refresh
  function logout(): void { ... }
 
  return { user, token, login, fetchMe, logout }
})
```
 
- Persist token to `localStorage`
- Axios interceptor attaches `Authorization: Bearer <token>` to all requests
- On 401 response → call `authStore.logout()` and `router.push('/login')`
### Vue Router 4
 
```typescript
// router/index.ts
const routes = [
  { path: '/login', component: LoginPage, meta: { public: true } },
  {
    path: '/',
    component: AppLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', component: DashboardPage },
      { path: 'session/:trainingId', component: SessionPage },
      { path: 'trainings', component: TrainingsPage, meta: { requiresTrainerOrAdmin: true } },
      { path: 'trainees', component: TraineesPage, meta: { requiresTrainerOrAdmin: true } },
      { path: 'roles', component: RolesPage, meta: { requiresAdmin: true } },
      { path: 'users', component: UsersPage, meta: { requiresAdmin: true } },
      { path: 'settings', component: SettingsPage, meta: { requiresAdmin: true } },
    ]
  }
]
 
// Navigation guard. NOTE: the guard is async because after a hard refresh the token
// exists in localStorage but `auth.user` is null — we must fetch /auth/me before the
// role checks, or requiresAdmin/requiresTrainerOrAdmin would wrongly bounce to /dashboard.
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (to.meta.public) return true
  if (to.meta.requiresAuth && !auth.token) return '/login'
  if (auth.token && !auth.user) {
    try { await auth.fetchMe() } catch { auth.logout(); return '/login' }
  }
  if (to.meta.requiresAdmin && !auth.user?.isAdmin) return '/dashboard'
  if (to.meta.requiresTrainerOrAdmin && !(auth.user?.isAdmin || auth.user?.isTrainer)) return '/dashboard'
  return true
})
```
 
### Animations & Micro-interactions
 
- Page transitions: `<RouterView v-slot="{ Component }"><Transition name="fade-slide">` — fade + slide up (150ms)
- Card hover: lift shadow (`translateY(-2px)`) via Tailwind `hover:` classes + `transition-transform`
- Button press: scale down (`active:scale-95`)
- List item add: `<TransitionGroup name="list">` slide down from top
- List item delete: `<TransitionGroup>` fade out + height collapse
- Sidebar nav active item: animated left border + background fill using Vue Router's `RouterLinkActive`
```css
/* Global transitions */
.fade-slide-enter-active, .fade-slide-leave-active { transition: all 0.15s ease; }
.fade-slide-enter-from { opacity: 0; transform: translateY(8px); }
.fade-slide-leave-to { opacity: 0; transform: translateY(-8px); }
 
.list-enter-active, .list-leave-active { transition: all 0.2s ease; overflow: hidden; }
.list-enter-from { opacity: 0; max-height: 0; }
.list-leave-to { opacity: 0; max-height: 0; }
```
 
---
 
## Setup & Running
 
### Backend
 
```bash
cd backend
npm install
npm run dev          # tsx watch src/index.ts
# Serves HTTPS on https://localhost:3001 (HTTPS_PORT); HTTP on 3000 (HTTP_PORT) 308-redirects to HTTPS.
# Auto-seeds demo data and generates a self-signed cert on first run (data/tls/). Use curl -k in dev.
```
 
Scripts: `dev` (`tsx watch src/index.ts`), `start` (`tsx src/index.ts`), `build` (`tsc`), `typecheck` (`tsc --noEmit`).
`tsx` runs TypeScript directly (no `ts-node` ESM friction on Windows); IDs use the built-in `crypto.randomUUID()`,
so `uuid`/`dotenv` are not needed. The backend terminates **TLS** (`https`) and, when `frontend/dist` exists,
serves the built SPA from the same HTTPS origin; the admin replaces the certificate from Settings.
 
**Dependencies:**
```json
{
  "dependencies": {
    "express": "^4.19",
    "cors": "^2.8",
    "bcryptjs": "^2.4",
    "jsonwebtoken": "^9.0",
    "jwks-rsa": "^4.0",
    "selfsigned": "^5.5"
  },
  "devDependencies": {
    "typescript": "^5.4",
    "tsx": "^4.16",
    "@types/express": "^4.17",
    "@types/bcryptjs": "^2.4",
    "@types/jsonwebtoken": "^9.0",
    "@types/cors": "^2.8",
    "@types/node": "^20.0"
  }
}
```
 
### Frontend
 
```bash
cd frontend
npm install
npm run dev
# Runs on https://localhost:5173 (self-signed via @vitejs/plugin-basic-ssl)
# Proxies /api/* to https://localhost:3001 (secure:false for the self-signed backend cert)
```
 
**Dependencies:**
```json
{
  "dependencies": {
    "vue": "^3.4",
    "vue-router": "^4.3",
    "pinia": "^2.1",
    "axios": "^1.7",
    "lucide-vue-next": "^0.400.0",
    "@azure/msal-browser": "^5.11"
  },
  "devDependencies": {
    "typescript": "^5.4",
    "vite": "^5.2",
    "@vitejs/plugin-vue": "^5.0",
    "vue-tsc": "^2.0",
    "tailwindcss": "^3.4",
    "autoprefixer": "^10.4",
    "postcss": "^8.4",
    "@vitejs/plugin-basic-ssl": "^1.2",
    "@types/node": "^20.0"
  }
}
```
 
> `@types/node` is needed because `vite.config.ts` imports `node:url` for the `@` alias; add `"node"` to the
> tsconfig `types` array (below). `clsx` from the original draft was dropped — not used.
 
**`vite.config.ts`:**
```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
 
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
})
```
 
**Google Fonts import (in `index.html`):**
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
```
 
**Tailwind config (`tailwind.config.js`, ESM):** in addition to the fonts below, the pastel palette, radii, and
`shadow-soft`/`shadow-lift` are mapped into the Tailwind theme so they're usable as utilities (`bg-pastel-mint`,
`text-ink-muted`, `text-accent`, etc.). PostCSS uses `tailwindcss` + `autoprefixer` (`postcss.config.js`).
```js
// tailwind.config.js
fontFamily: {
  sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
  mono: ['"DM Mono"', 'ui-monospace', 'monospace'],
}
```
 
**Typography rules:**
- Headings, nav labels, button labels: `Space Grotesk` (font-sans)
- Body text, descriptions, input values, badges, metadata: `DM Mono` (font-mono)
- This creates a clean technical/data-tool aesthetic throughout
 
**Frontend `tsconfig.json`** (note `"node"` added to `types` for `vite.config.ts`):
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"],
    "skipLibCheck": true,
    "noUnusedLocals": false,
    "isolatedModules": true,
    "useDefineForClassFields": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.vue", "vite.config.ts"]
}
```
 
**Backend `tsconfig.json`** — CommonJS at runtime (no `"type": "module"` in `package.json`), so `tsx` runs it
without any ESM configuration:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```
 
> **tsconfig gotchas (TypeScript 5.4+):** use **lowercase** `moduleResolution` values — the editor's JSON schema
> rejects `"Node"`/`"Bundler"`. Prefer `"nodenext"` over `"node"`/`"node10"` (the latter is deprecated and removed
> in TS 7.0; `nodenext` requires `module: "nodenext"` to match). Do **not** set `baseUrl` — it is likewise
> deprecated; modern TS resolves `paths` (the `@/*` alias) relative to the tsconfig file location on its own.
 
---
 
## Vue-Specific Conventions
 
- All components use **`<script setup lang="ts">`** (Composition API, no Options API)
- Props typed with `defineProps<{...}>()` — no `PropType` casting
- Emits typed with `defineEmits<{...}>()`
- Reactive state: `ref()` for primitives, `reactive()` for objects, `computed()` for derived values
- Async data loading in `onMounted()` hooks
- No `this` — everything accessed directly in `<script setup>`
- Template refs: `const el = ref<HTMLElement | null>(null)` + `ref="el"` in template
- Component names in templates use **PascalCase** (`<TrainingCard />`)
- Use `v-model` for two-way binding on form inputs
---
 
## Quality Requirements
 
1. **No `any` types** — full TypeScript coverage; use `unknown` + type guards where needed
2. **Error handling** — all API calls wrapped in try/catch; user-visible toasts via a small Pinia `toast` store (`success`/`error`) rendered by a fixed-position host (`TransitionGroup`) in `App.vue`
3. **Loading states** — skeleton loaders on all data fetches (use `v-if="loading"` + placeholder shimmer divs)
4. **Responsive** — works on 375px mobile and 1440px desktop
5. **Accessible** — keyboard navigable, proper `aria-label` attributes, visible focus rings
6. **Consistent spacing** — use Tailwind spacing scale, no magic numbers
7. **No external UI library** — build all components from scratch using Tailwind
8. **Admin access control enforced at all three layers** — Vue Router guard, sidebar `v-if`, and backend `requireAdmin` middleware. Never rely on a single layer alone.
9. **Quiz grading & pass threshold are server-side** — the backend grades submitted answers against the stored `correctIndex` values and compares to the global `Settings.passThreshold`. Never trust a client-submitted score, and never expose `correctIndex` to a user taking the test. This is consistent with the three-layer security stance above.
10. **Training ownership enforced server-side** — trainers may only mutate trainings they own (`requireAdminOrOwner`); the filtered UI list is convenience, not the security boundary.
11. **Requirements stay in sync** — `requirements/requirements.json` (the linkable, traceable requirements dataset) is part of the deliverable and must always match this prompt and the code (see "Requirements & Traceability" below). No feature is "done" until its `SR-…`/`SYS-…` objects are updated and `node requirements/tools/build.mjs --check` passes.
---
 
## Requirements & Traceability

This prompt is the **narrative source of truth** for the design. Alongside it, the repo keeps the requirements
as **linkable, traceable objects** under [`requirements/`](requirements/), which **must be kept up to date
with every change**. Requirements are stored as machine-readable data, not prose:

| File | Role |
|---|---|
| `requirements/requirements.json` | **Single source of truth.** Typed requirement objects (`SR-…` stakeholder, `SYS-…` system) with stable ids and typed `links` (`derivedFrom`), `implementedBy`, `verifiedBy`, `specRefs`; **validation tests** (`VT-…`, `validates` an `SR-…`, with `testType` acceptance/usability/accessibility, steps, expected, metric); plus actors/enums/out-of-scope. |
| `requirements/schema/requirements.schema.json` | JSON Schema (draft 2020-12) — the formal contract; `requirements.json` references it via `$schema`. |
| `requirements/tools/build.mjs` | Validator + generator (plain Node, no deps). Validates integrity and regenerates the views below. |
| `requirements/{stakeholder-requirements,system-requirements,traceability-matrix,validation-plan}.md` | **Generated** human-readable views (incl. the validation test plan). |
| `frontend/src/data/requirements.generated.json` | **Generated** copy imported by the in-app viewer. |
| `frontend/src/pages/RequirementsPage.vue` | Admin `/requirements` page — browse, filter, and click `SR ⇄ SYS ⇄ code` traces both ways. |

**Standing rule — treat the requirements as living data.** Whenever you add, change, or remove a feature
(in this prompt or in code):

1. **Update this prompt** (the relevant spec section, data model, route table, permission matrix, page
   description) — as already done for the *training ordering* and *Entra ID SSO* features.
2. **Edit `requirements/requirements.json`** in the same change:
   - Add/modify the affected `SYS-…` object — its `links` (`derivedFrom` an `SR-…`), `implementedBy`,
     `verifiedBy` — and a new `SR-…` object only for a genuinely new stakeholder need.
   - Add/modify a **validation test** (`VT-…`) that `validates` the affected `SR-…` — including a usability or
     accessibility test where the change touches UX. Every stakeholder requirement must stay validated.
   - **Keep IDs stable** — never renumber. Add new ids (e.g. `SR-110`, `SYS-TRN-10`, `VT-110`) and mark
     superseded ones (`status: "superseded"`) rather than reusing numbers.
3. **Run the generator** to validate and refresh every generated artifact:
   ```
   node requirements/tools/build.mjs            # validate + regenerate views + the app data copy
   node requirements/tools/build.mjs --check     # validate + fail on drift (CI / pre-commit)
   ```
   It enforces: unique ids, id patterns, enum membership, all link targets resolve, every `SYS-…` has a
   `derivedFrom` + `implementedBy`, every `SR-…` is covered by ≥1 `SYS-…`, and **every `SR-…` has ≥1
   validation test (`VT-…`)** — so nothing is orphaned or unvalidated.
4. **Commit** `requirements.json` together with the regenerated files.

When (re)generating the project from this prompt, **generate the `requirements/` dataset (and its schema,
generator, generated views, and the `/requirements` viewer) too**, consistent with the spec above.

---
 
## Deliverable
 
Generate the complete source code for all files listed in the project structure above — **including the
`requirements/` documents**, derived from this prompt and kept consistent per "Requirements & Traceability".
Each file should be complete and ready to run — no placeholders, no TODOs. The application should work end-to-end: login with email/password or **Microsoft Entra ID SSO** (when an admin has enabled it in Settings); view personal trainings with due status; start a session, read the OneDrive material, take the multiple-choice test, and be graded against the global pass threshold; (as a trainer) manage your own trainings including material links, quiz questions, and the 1–5 year cycle; and (as an admin) manage all entities, reorder trainings by drag-and-drop (an order respected by every view), edit the global pass threshold for all trainings at once, and upload the TLS certificate that secures the HTTPS-only site.
 
