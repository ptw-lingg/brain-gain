# BrainGain — System Requirements

> **Status:** Living document · **Last updated:** 2026-06-03
>
> **Purpose:** Specify *how* the system must behave to satisfy the
> [Stakeholder Requirements](./stakeholder-requirements.md) (`SR-xxx`). These system requirements (`SYS-…`)
> are derived from those needs and from the **design decisions** recorded in the product prompt
> [`brain-gain.md`](../brain-gain.md) (tech stack, API contracts, data models, validation rules, the
> three-layer access-control model, and the Entra ID SSO flow). Every `SYS-…` lists the `SR-xxx` it
> traces to. Requirements are written to be individually verifiable.

---

## A. Architecture & Technology Constraints

| ID | Requirement | Trace |
|---|---|---|
| SYS-ARCH-01 | The product shall be a monorepo with a `backend/` (Express + TypeScript) and a `frontend/` (Vue 3 + TypeScript, Vite). | SR-100, SR-102 |
| SYS-ARCH-02 | The backend shall run via **`tsx`** (`tsx watch` in dev, `tsx` in prod) with no build step required; IDs shall be generated with `crypto.randomUUID()`. | SR-100, SR-106 |
| SYS-ARCH-03 | The frontend shall use **Vue 3 Composition API** (`<script setup lang="ts">`), **Pinia** for state, **Vue Router 4** for routing, and **axios** (baseURL `/api`) for HTTP; Vite shall proxy `/api` to the backend. | SR-102 |
| SYS-ARCH-04 | Styling shall use **Tailwind CSS v3**, icons **lucide-vue-next**, and Google Fonts **Space Grotesk** + **DM Mono**; no external UI component library shall be used. | SR-090, SR-091, SR-092 |
| SYS-ARCH-05 | Persistence shall be **JSON files** via `fs/promises`; there shall be no external database. | SR-101 |
| SYS-ARCH-06 | On first run only (when no users exist), the backend shall **seed** an admin, a trainer, a member, a job role, two trainings, and the settings file. | SR-106 |
| SYS-ARCH-07 | The codebase shall use strict TypeScript with **no `any` types** (use `unknown` + guards). | SR-100 |

## B. Data Model & Persistence

| ID | Requirement | Trace |
|---|---|---|
| SYS-DATA-01 | The store shall keep `users`, `roles`, `trainings`, `sessions` as JSON **arrays** and `settings` as a single JSON **object**; generic `readStore`/`writeStore` and `readSettings`/`writeSettings` helpers shall auto-initialize missing files and serialize with 2-space indentation. | SR-101, SR-103 |
| SYS-DATA-02 | `User` shall be `{ id, email, passwordHash?, name, roleIds[], isAdmin, isTrainer, entraOid?, createdAt }`. `passwordHash` is **optional** (absent for SSO-only users); `entraOid` is the linked Entra object id. | SR-001, SR-009, SR-021, SR-022 |
| SYS-DATA-03 | `JobRole` shall be `{ id, name, description, trainingIds[] }`. | SR-030, SR-031 |
| SYS-DATA-04 | `Training` shall be `{ id, name, description, durationHours, category, ownerId, cycleYears (1–5), windowBeforeMonths (0–3), windowAfterMonths (0–3), order, materialLinks[], questions[], createdAt }`. | SR-040–SR-046 |
| SYS-DATA-05 | `Question` shall be `{ id, text, options[], correctIndex }`; `correctIndex` shall never be sent to a non-owner (a `PublicTraining` shape strips it). | SR-042, SR-051 |
| SYS-DATA-06 | `Settings` shall be `{ passThreshold (0–1, default 0.8), entra: { enabled, tenantId, clientId, allowedDomains[] } }`; reading shall backfill defaults onto older settings files via a shallow merge. | SR-080, SR-008 |
| SYS-DATA-07 | The client-facing `SafeUser` shall be `Omit<User, 'passwordHash' \| 'entraOid'>`; a shared `toSafeUser()` shall strip both before any user is returned. | SR-003, SR-105 |
| SYS-DATA-08 | `TrainingSession` shall be `{ id, userId, trainingId, completedAt, scorePct }`; **only passing attempts** shall be persisted. | SR-052, SR-053 |

## C. Authentication — Email/Password

| ID | Requirement | Trace |
|---|---|---|
| SYS-AUTH-01 | `POST /api/auth/login { email, password }` shall match email case-insensitively, verify with `bcrypt.compare`, and on success return `{ token, user: SafeUser }`; it shall return 400 on missing fields and 401 on bad credentials. | SR-001, SR-002 |
| SYS-AUTH-02 | Passwords shall be hashed with **bcryptjs**, salt rounds **10**. | SR-001, SR-104 |
| SYS-AUTH-03 | The session token shall be a **JWT** signed with `JWT_SECRET`, payload `{ id, email, isAdmin, isTrainer }`, expiry **7d**. | SR-005 |
| SYS-AUTH-04 | `GET /api/auth/me` (authenticated) shall return the current `SafeUser`, used to rehydrate the user after a page refresh. | SR-005 |
| SYS-AUTH-05 | The frontend shall store the token in `localStorage`; axios shall attach `Authorization: Bearer <token>` to every request; on a 401 it shall clear the token and redirect to `/login`. | SR-005 |
| SYS-AUTH-06 | There shall be **no public registration** endpoint. | SR-001 |
| SYS-AUTH-07 | A user without a `passwordHash` (SSO-only) shall be unable to log in with a password (login returns 401). | SR-009, SR-010 |

## D. Authentication — Microsoft Entra ID SSO

| ID | Requirement | Trace |
|---|---|---|
| SYS-SSO-01 | The browser shall obtain an Entra **ID token** using **MSAL.js** (`@azure/msal-browser`) **popup** flow with scopes `openid profile email`. | SR-006 |
| SYS-SSO-02 | `GET /api/auth/sso/config` (public) shall return `{ enabled: false }`, or `{ enabled: true, clientId, authority }` when SSO is configured; the login page shall fetch this before authenticating and show the Microsoft button only when enabled. | SR-006, SR-007 |
| SYS-SSO-03 | `POST /api/auth/sso/entra { idToken }` shall return **503** when SSO is disabled/unconfigured, **400** when `idToken` is absent. | SR-007 |
| SYS-SSO-04 | The backend shall **validate the ID token server-side** with `jwks-rsa` + `jsonwebtoken`: enforce **RS256**, `aud` = configured client id, `iss` = `https://login.microsoftonline.com/{tenant}/v2.0`, `tid` = configured tenant, and expiry with a 300s clock tolerance; JWKS keys shall be cached per tenant. Invalid tokens → **401**. | SR-104, SR-006 |
| SYS-SSO-05 | From the validated token the system shall read `oid`, `email` (`email` then `preferred_username`), and `name`; a token missing `oid` or any email shall be rejected. | SR-009 |
| SYS-SSO-06 | User resolution shall be: (1) match by `entraOid`; else (2) match by email and **link** `entraOid` to that user **without changing roles/admin/trainer flags** — but return **409** if that email is already linked to a *different* `entraOid`; else (3) if the email domain is in `allowedDomains`, **auto-create a member** (`isAdmin:false`, `isTrainer:false`, no password); else (4) return **403**. | SR-009 |
| SYS-SSO-07 | On success the endpoint shall issue the **same app JWT** (`signToken`) and return `{ token, user: SafeUser }`, identical to password login, so all downstream session handling is unchanged. | SR-006, SR-010 |
| SYS-SSO-08 | SSO shall require **no client secret**; its configuration shall be admin-editable (Section H) and, when absent/disabled, the app shall behave exactly as a password-only app. | SR-007, SR-008, SR-105 |
| SYS-SSO-09 | Operation shall assume an Azure **Single-Page Application** registration, **single-tenant**, with the redirect URI set to the app origin and delegated permissions `openid/profile/email`. | SR-006 |

## E. Authorization & Access Control (enforced at three layers)

| ID | Requirement | Trace |
|---|---|---|
| SYS-AC-01 | The backend shall provide middleware: `authenticate` (401 if missing/invalid token), `requireAdmin` (403), `requireTrainerOrAdmin` (403), and `requireAdminOrOwner` (403 unless admin or the training's owner). | SR-003, SR-004, SR-045 |
| SYS-AC-02 | All mutating endpoints on `/api/roles` and `/api/users`, and `PUT /api/settings`, shall require **admin**. | SR-003 |
| SYS-AC-03 | `POST /api/trainings` shall require trainer-or-admin; `PUT`/`DELETE /api/trainings/:id` shall require admin-or-owner; only admins may set/change `ownerId`; `PUT /api/trainings/reorder` shall require admin. | SR-045, SR-046 |
| SYS-AC-04 | The frontend router shall enforce route meta `requiresAuth`/`requiresAdmin`/`requiresTrainerOrAdmin`, redirecting unauthenticated users to `/login` and unauthorized users to `/dashboard`; after a refresh it shall `fetchMe()` before role checks. | SR-003, SR-004 |
| SYS-AC-05 | The sidebar shall render only the navigation items appropriate to the user's level (defense-in-depth, not the sole control). | SR-003, SR-004 |
| SYS-AC-06 | The system shall conform to the documented API permission matrix for every role/endpoint pair. | SR-003, SR-004 |

## F. Users, Roles & their UIs

| ID | Requirement | Trace |
|---|---|---|
| SYS-USR-01 | `/api/users` shall provide admin-only CRUD: create `{ name, email, password, roleIds, isAdmin, isTrainer }`; update with **optional** `password` (blank keeps the current one). | SR-020, SR-022 |
| SYS-USR-02 | The Users page shall list users in a table and edit them in a slide-out drawer with a role multi-select and `isAdmin`/`isTrainer` toggles. | SR-020, SR-021, SR-022 |
| SYS-ROL-01 | `/api/roles` shall provide admin-only CRUD. | SR-030 |
| SYS-ROL-02 | The Role editor shall present a multi-select checkbox list of all trainings, writing the selection to `trainingIds`. | SR-031 |
| SYS-ROL-03 | The Role editor's training list shall follow the admin-defined training order. | SR-047 |

## G. Trainings, Ordering & Due Status

| ID | Requirement | Trace |
|---|---|---|
| SYS-TRN-01 | `GET /api/trainings` shall return trainings **sorted by `order` ascending**; admins see all, trainers may pass `?mine=1` for their own; `correctIndex` shall be stripped for non-owners. | SR-040, SR-047, SR-051 |
| SYS-TRN-02 | `GET /api/trainings/:id` shall return one training, answer key stripped for non-owners (used by the session quiz). | SR-050 |
| SYS-TRN-03 | `POST /api/trainings` shall set a trainer's own `ownerId` (admins may target any owner) and append the new training to the end of the order (`order = max + 1`). | SR-045, SR-046 |
| SYS-TRN-04 | `PUT /api/trainings/:id` shall update an owned/any training (admin-or-owner) without changing `order`; only admins may change `ownerId`. | SR-045 |
| SYS-TRN-05 | `DELETE /api/trainings/:id` shall be permitted only to admin-or-owner. | SR-045 |
| SYS-TRN-06 | `PUT /api/trainings/reorder { ids[] }` (admin-only) shall set each training's `order` to its position in the array; it shall be registered **before** the `/:id` route. | SR-046 |
| SYS-TRN-07 | The list endpoints (`/`, `/mine`, `/trainees`) shall sort by `order`; legacy records missing `order` shall be backfilled by file position and persisted, making `order` the single source of truth. | SR-046, SR-047 |
| SYS-TRN-08 | The Trainings page shall let **admins reorder via drag-and-drop** (grip handle); a normal row click still opens the editor; trainers shall not see the handle; dropping persists the new order via the reorder endpoint. | SR-046 |
| SYS-TRN-09 | The training editor shall manage `cycleYears` (1–5), `windowBeforeMonths`/`windowAfterMonths` (0–3), `materialLinks` (label+url), `questions` (text/options/correctIndex), and—admin only—`ownerId`. | SR-041–SR-045 |
| SYS-DUE-01 | A single `computeDue()` (in `services/due.ts`) shall derive status from the last passing session: `dueDate = lastPassed + cycleYears`, `windowOpen = dueDate − windowBeforeMonths`, `windowClose = dueDate + windowAfterMonths`, yielding `never` / `up-to-date` / `due` / `overdue`; it shall be reused by both `/mine` and `/trainees`. | SR-053 |
| SYS-DUE-02 | `GET /api/trainings/mine` shall return `DueTraining[]` for the current user's required trainings (union of role `trainingIds`, deduped), in `order`, with server-computed status. | SR-032, SR-060, SR-047 |

## H. Sessions & Settings

| ID | Requirement | Trace |
|---|---|---|
| SYS-SES-01 | The Session page (`/session/:trainingId`) shall implement the flow **material → quiz → result**. | SR-050 |
| SYS-SES-02 | `POST /api/sessions/grade { trainingId, answers[] }` shall grade **server-side** against stored `correctIndex`, compare `scorePct` to `Settings.passThreshold`, persist a `TrainingSession` **only if passed**, and return `{ scorePct, passed, passThreshold }`. | SR-051, SR-052 |
| SYS-SES-03 | A learner shall be able to submit `/grade` repeatedly; failed attempts shall not be recorded and shall leave the due state unchanged. | SR-052 |
| SYS-SES-04 | `GET /api/sessions/mine` shall return the current user's passing sessions. | SR-053 |
| SYS-SET-01 | `GET /api/settings` (any authenticated user) shall return the full `Settings`. | SR-080 |
| SYS-SET-02 | `PUT /api/settings` (admin) shall be a **partial merge**: validate/clamp `passThreshold` to 0.5–1 when present, and when `entra` is present coerce booleans, trim ids, and accept `allowedDomains` as an array or comma-separated string (trimmed, lower-cased, empties dropped) — so SSO and threshold save independently. | SR-080, SR-008 |
| SYS-SET-03 | The Settings page shall present a **pass-threshold card** and an **Entra ID SSO card** (enable toggle; tenant id; client id; allowed domains; a hint showing the SPA redirect URI), each with its own save action. | SR-080, SR-081, SR-008 |

## I. Learner Dashboard & Trainee Oversight

| ID | Requirement | Trace |
|---|---|---|
| SYS-DSH-01 | The Dashboard shall load `/api/trainings/mine` and render a responsive card grid; each card shows name, description, duration, category, a **due-status pill**, and a Start action; an empty state shall be shown when nothing is assigned. | SR-060, SR-061 |
| SYS-OVS-01 | `GET /api/trainings/trainees` shall return `TraineeGroup[]` (admins: all trainings; trainers: owned), grouped per training in `order`, each trainee carrying server-computed `status` and `dueDate`. | SR-070, SR-047 |
| SYS-OVS-02 | The Trainees page shall show collapsible per-training groups, a "only due/overdue" filter, and per-group + global **copy-emails** actions that write a `; `-separated recipient list to the clipboard with a confirming toast. | SR-070, SR-071 |

## J. UX, Design & Cross-cutting Quality

| ID | Requirement | Trace |
|---|---|---|
| SYS-UI-01 | The theme shall use the defined **pastel-blue** CSS-variable palette (background `#F0F6FF`, sidebar `#E0EDFF`, accent `#2B78E4`, pastel blue/cyan/mint/steel/sky/slate); no purple/rose/peach. | SR-091 |
| SYS-UI-02 | Headings/nav/buttons shall use **Space Grotesk**; body/inputs/badges/metadata shall use **DM Mono** (technical aesthetic). | SR-092 |
| SYS-UI-03 | A `BrainGainLogo` SVG component (stylized brain + upward arrow, pastel-blue gradient, `size` prop) shall render cleanly at 32 px, 48 px, and 256 px. | SR-090 |
| SYS-UI-04 | The layout shall be a fixed 240 px sidebar + scrollable content, collapsing to a bottom tab bar on mobile. | SR-093 |
| SYS-UI-05 | The UI shall be **responsive** (375 px–1440 px) and **accessible** (keyboard navigable, visible focus rings, sensible `aria-label`s). | SR-093 |
| SYS-UI-06 | Every data fetch shall show a **loading/skeleton** state; every API call shall be wrapped in try/catch surfacing **success/error toasts** via a global toast store. | SR-094 |
| SYS-NFR-01 | All security-sensitive logic — credential checks, quiz grading, ownership and access checks, and SSO token validation — shall be **enforced on the server** and never trusted from the client. | SR-104 |
| SYS-NFR-02 | The system shall never transmit `passwordHash`, `entraOid`, `correctIndex`, or any secret to clients, and SSO shall function without storing a client secret. | SR-051, SR-105 |

---

## K. Coverage Summary (stakeholder → system)

| Stakeholder area | Stakeholder reqs | Covering system reqs |
|---|---|---|
| Authentication & access | SR-001–SR-010 | SYS-AUTH-01…07, SYS-SSO-01…09, SYS-AC-01…06 |
| User management | SR-020–SR-022 | SYS-USR-01…02, SYS-DATA-02 |
| Job roles | SR-030–SR-032 | SYS-ROL-01…03, SYS-DUE-02 |
| Trainings & ordering | SR-040–SR-047 | SYS-TRN-01…09 |
| Sessions & assessment | SR-050–SR-053 | SYS-SES-01…04, SYS-DUE-01…02, SYS-DATA-05/08 |
| Learner dashboard | SR-060–SR-061 | SYS-DSH-01 |
| Trainee oversight | SR-070–SR-071 | SYS-OVS-01…02 |
| Settings | SR-080–SR-081 | SYS-SET-01…03 |
| UX & design | SR-090–SR-094 | SYS-UI-01…06, SYS-ARCH-04 |
| Constraints & NFRs | SR-100–SR-106 | SYS-ARCH-01…07, SYS-NFR-01…02 |

> **Verification:** functional `SYS-…` are verifiable via the API and UI (see the verification approaches used
> during development — endpoint probes, settings round-trips, drag-reorder persistence, and the SSO
> token-validation checks). Design-decision sources for every requirement are the matching sections of
> [`brain-gain.md`](../brain-gain.md).
