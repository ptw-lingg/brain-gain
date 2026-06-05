# BrainGain — Stakeholder Requirements

<!-- GENERATED FROM requirements.json by requirements/tools/build.mjs — DO NOT EDIT BY HAND -->

> Generated from `requirements.json` · 49 requirements · updated 2026-06-05.

Priority: **M** = Must · **S** = Should · **C** = Could.

## Actors

| ID | Actor | Description |
|---|---|---|
| `admin` | Administrator | Owns the system. Manages users, job roles, trainings, and global settings. Sees and edits everything. |
| `trainer` | Trainer | Owns and manages their own trainings (material, quiz, recurrence). Sees who must take their trainings. Cannot manage users/roles/system settings. |
| `member` | Member (Learner) | A regular employee. Completes the trainings their job roles require. |
| `business-owner` | Organization / Business owner | Wants demonstrable, auditable training compliance with low administrative effort. |

## Requirements

### Authentication & Access Control

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-001 | **Email/password authentication** — Users shall authenticate with an email address and password; there is no public self-registration. | M | Original brief | Approved |
| SR-002 | **Land on relevant trainings after sign-in** — After signing in, a user shall land on a view listing the trainings relevant to them. | M | Original brief | Approved |
| SR-003 | **Admin-only editing, reliably enforced** — Trainings, Job Roles, and Users shall be editable only by an administrator. Access control must be enforced reliably, not merely hidden in the UI. | M | Refinement | Approved |
| SR-004 | **Three access levels** — The system shall distinguish three access levels — Member, Trainer, and Administrator — and show each only the capabilities appropriate to their level. | M | Spec (roles) | Approved |
| SR-005 | **Persistent session** — A user's session shall persist across page reloads and expire after a reasonable period without re-login. | S | Spec (JWT 7-day) | Approved |
| SR-006 | **Sign in with Microsoft Entra ID** — Users shall be able to sign in with their Microsoft Entra ID (Azure AD) work account as an alternative to email/password. | S | Microsoft Entra ID SSO feature | Approved |
| SR-007 | **SSO optional & configurable** — Microsoft SSO shall be optional and configurable by an administrator; when it is not configured/enabled, the application behaves exactly as a password-only app. | M | Microsoft Entra ID SSO feature | Approved |
| SR-008 | **Configure SSO in-app** — An administrator shall configure SSO (enable/disable, tenant, application, permitted email domains) from within the application (Settings), without code or environment changes. | M | Microsoft Entra ID SSO feature (stakeholder decision) | Approved |
| SR-009 | **Domain-restricted provisioning & linking** — When a person signs in via SSO and matches an existing user (by email), their account shall be linked without changing their existing roles/permissions. If unmatched and their email domain is allowed, a new member-level account shall be created automatically; otherwise sign-in shall be refused. | M | Microsoft Entra ID SSO feature (domain-restricted provisioning) | Approved |
| SR-010 | **Keep password login alongside SSO** — Email/password login shall remain available alongside SSO. | M | Microsoft Entra ID SSO feature (stakeholder decision: keep both) | Approved |
| SR-011 | **Admin can view the app as another user** — An administrator shall be able to impersonate another user — seeing the application exactly as that user does (their dashboard, due trainings, and role-appropriate navigation) — to support and troubleshoot, then return to their own session. | S | Admin impersonation feature | Approved |

### User Management

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-020 | **Admin manages users** — An administrator shall create, edit, and delete users (name, email, password, access level). | M | Original brief | Approved |
| SR-021 | **User belongs to several roles** — A user shall be assignable to several job roles. | M | Original brief | Approved |
| SR-022 | **Mark trainer/administrator** — An administrator shall be able to mark a user as a Trainer or Administrator. | M | Spec | Approved |

### Job Roles

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-030 | **Editable job-role list** — An administrator shall maintain a simple, editable list of job roles (name, description). | M | Original brief | Approved |
| SR-031 | **Role requires trainings** — Each job role shall require several trainings; the administrator chooses which trainings a role demands. | M | Original brief | Approved |
| SR-032 | **Required trainings derived from roles** — The trainings a user must complete shall be derived from the union of their roles' required trainings (with duplicates removed). | M | Spec | Approved |

### Trainings

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-040 | **Editable training list** — The system shall maintain an editable list of trainings (name, description, category, duration). | M | Original brief | Approved |
| SR-041 | **Learning material links** — Each training shall reference learning material (links to documents, e.g. OneDrive) that learners open to study. | M | Spec | Approved |
| SR-042 | **Multiple-choice quiz** — Each training shall include a multiple-choice quiz with a defined correct answer per question. | M | Spec | Approved |
| SR-043 | **Recurrence cycle** — Each training shall define a recurrence cycle (how often, in years, it must be repeated). | M | Spec | Approved |
| SR-044 | **Due window** — Each training shall define a due window — how early before the due date it becomes available and how long after it remains in grace before counting as overdue. | M | Spec | Approved |
| SR-045 | **Trainer owns their trainings** — A trainer shall own and manage only their own trainings; an administrator manages all trainings and may assign a training's owner. | M | Spec | Approved |
| SR-046 | **Admin reorders via drag-and-drop** — An administrator shall be able to reorder trainings via drag-and-drop, defining an explicit display order. | S | Training-ordering feature | Approved |
| SR-047 | **Order respected everywhere** — The administrator-defined training order shall be respected consistently in every view that lists trainings (admin list, learner dashboard, trainee oversight, role editor). | S | Training-ordering feature | Approved |

### Training Sessions & Assessment

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-050 | **Material → quiz → result flow** — A learner shall complete a training as a flow: review material → take the quiz → see the result. | M | Spec | Approved |
| SR-051 | **Server-side grading** — The quiz shall be graded by the system, comparing the score to a configurable pass threshold; the learner must not be able to influence their own score, and correct answers must not be exposed to someone taking the test. | M | Spec (server-side grading) | Approved |
| SR-052 | **Unlimited retries; record only passes** — A learner shall be able to retry the quiz as often as needed; only a passing attempt is recorded. Failed attempts leave the training in its current due state. | M | Spec | Approved |
| SR-053 | **Computed due status** — The system shall compute each training's due status per user (never taken, up-to-date, due now, overdue) from the last passing attempt and the training's cycle/window. | M | Spec | Approved |

### Learner Dashboard

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-060 | **Dashboard of required trainings** — The dashboard shall show the trainings required of the signed-in user, each with its current due status and a clear call to start. | M | Original brief (/ Spec) | Approved |
| SR-061 | **Friendly empty state** — The dashboard shall present a friendly empty state when no trainings are assigned. | C | Spec | Approved |

### Trainee Oversight

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-070 | **Who must take each training** — A trainer/administrator shall see, grouped by training, who is required to take it and each person's due status. | M | Spec | Approved |
| SR-071 | **Filter due & copy emails** — They shall be able to filter to only those who are due/overdue and copy the relevant email addresses to the clipboard for reminders. | S | Spec | Approved |

### Global Settings

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-080 | **Global pass threshold** — An administrator shall set a single global pass threshold that applies to all trainings at once. | M | Spec | Approved |
| SR-081 | **Manage SSO from Settings** — An administrator shall manage SSO configuration from the same Settings area (see SR-008). | M | Microsoft Entra ID SSO feature | Approved |

### User Experience & Design

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-090 | **Polished, professional UI + icon** — The application shall present a polished, professional, modern interface with a distinctive app icon/logo. | M | Original brief (fantastic user interface; very good icon) | Approved |
| SR-091 | **Pastel-blue palette** — The visual design shall use a pastel colour palette, specifically pastel blue (not purple). | M | Original brief (+ refinement) | Approved |
| SR-092 | **Technical typography** — Typography shall have a technical, engineered feel. | S | Refinement (fonts more technical) | Approved |
| SR-093 | **Responsive & accessible** — The interface shall be responsive (usable on mobile and desktop) and accessible (keyboard navigable, clear focus, sensible labels). | M | Spec (/ NFR) | Approved |
| SR-094 | **Clear operation feedback** — Data operations shall give clear feedback: loading indicators while fetching and success/error notifications on actions. | S | Spec (/ NFR) | Approved |

### Non-Functional & Constraints

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-100 | **TypeScript everywhere** — The application shall be written in TypeScript for both frontend and backend. | M | Original brief | Approved |
| SR-101 | **JSON-file persistence** — Data shall be persisted to local JSON files (no external database). | M | Original brief | Approved |
| SR-102 | **Vue frontend** — The frontend shall be built with Vue (not React). | M | Refinement (Use Vue instead of React) | Approved |
| SR-103 | **All entities editable via UI** — All managed entities (users, roles, trainings, settings) shall be editable through the user interface. | M | Original brief | Approved |
| SR-104 | **Server-side security enforcement** — Security-sensitive operations (login result/grading/ownership/access checks, SSO token validation) shall be enforced on the server, never trusted from the client. | M | Spec (/ SSO feature) | Approved |
| SR-105 | **No secrets to clients** — Secrets shall not be exposed to clients; SSO must operate without storing a client secret, so that its configuration can safely be admin-editable. | M | Microsoft Entra ID SSO feature (design constraint) | Approved |
| SR-106 | **Easy to run; seed demo data** — The system shall be easy to run for evaluation, seeding demo data (an admin, a trainer, a member) on first start. | S | Spec | Approved |

### HTTPS & TLS

| ID | Requirement | Priority | Source | Status |
|---|---|---|---|---|
| SR-110 | **HTTPS-only delivery** — The application shall be delivered only over HTTPS (TLS). Plain HTTP shall not serve the app or API; HTTP requests are redirected to HTTPS. | M | HTTPS/TLS delivery feature | Approved |
| SR-111 | **Admin-managed TLS certificate** — An administrator shall upload and replace the TLS certificate (and private key) from the Settings page, applied without downtime; the private key is never exposed to clients. | M | HTTPS/TLS delivery feature | Approved |

## Out of Scope

- Public self-service registration (admins create accounts).
- A relational/SQL database or multi-server deployment.
- Multi-tenant Microsoft sign-in (SSO is single-tenant).
- Reporting/export beyond the trainee email-copy convenience.
