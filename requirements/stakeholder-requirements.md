# BrainGain — Stakeholder Requirements

> **Status:** Living document · **Last updated:** 2026-06-03
>
> **Purpose:** Capture *what* the stakeholders need from BrainGain and *why*, independent of how it is
> implemented. These requirements were extracted from the original product brief and its refinement log in
> [`brain-gain.md`](../brain-gain.md), and from features agreed during development (training ordering,
> Microsoft Entra ID SSO). Each requirement is uniquely identified for traceability; the **Source** column
> records where the need originated.

---

## 1. Product Vision

BrainGain is a **training management web application** that lets an organization define which trainings each
job role requires, assign people to roles, and track who is due to (re)take which training. Learners log in,
see the trainings required of them, study the linked material, and pass a short test; managers track
compliance and remind those who are due. The product targets a regulated, quality-managed environment (e.g.
medical-device / dosimetry QMS), so controlled access and a polished, professional experience matter.

## 2. Stakeholders & Actors

| Actor | Description |
|---|---|
| **Administrator** | Owns the system. Manages users, job roles, trainings, and global settings. Sees and edits everything. |
| **Trainer** | Owns and manages the trainings they are responsible for (material, quiz, recurrence). Sees who must take their trainings. Cannot manage users/roles/system settings. |
| **Member (Learner)** | A regular employee. Completes the trainings their job roles require. |
| **Organization / Business owner** | Wants demonstrable, auditable training compliance with low administrative effort. |

---

## 3. Stakeholder Requirements

Priority: **M** = Must-have · **S** = Should-have · **C** = Could-have.

### 3.1 Authentication & Access Control

| ID | Requirement | Priority | Source |
|---|---|---|---|
| SR-001 | Users shall authenticate with an **email address and password**; there is no public self-registration. | M | Original brief |
| SR-002 | After signing in, a user shall land on a view listing the trainings relevant to them. | M | Original brief |
| SR-003 | **Trainings, Job Roles, and Users shall be editable only by an administrator.** Access control must be enforced reliably, not merely hidden in the UI. | M | Refinement: "only editable by the administrator" |
| SR-004 | The system shall distinguish three access levels — **Member**, **Trainer**, and **Administrator** — and show each only the capabilities appropriate to their level. | M | Spec (roles) |
| SR-005 | A user's session shall persist across page reloads and expire after a reasonable period without re-login. | S | Spec (JWT 7-day) |
| SR-006 | Users shall be able to sign in with their **Microsoft Entra ID (Azure AD) work account** ("Sign in with Microsoft") as an alternative to email/password. | S | SSO feature |
| SR-007 | Microsoft SSO shall be **optional and configurable by an administrator**; when it is not configured/enabled, the application behaves exactly as a password-only app. | M | SSO feature |
| SR-008 | An administrator shall configure SSO (enable/disable, tenant, application, and the email domains permitted) **from within the application** (Settings), without code or environment changes. | M | SSO feature (stakeholder decision) |
| SR-009 | When a person signs in via SSO and matches an existing user (by email), their account shall be **linked** without changing their existing roles or permissions. If they do not match and their email domain is in the allowed list, a **new member-level account shall be created automatically**; otherwise sign-in shall be refused. | M | SSO feature (domain-restricted provisioning) |
| SR-010 | Email/password login shall remain available alongside SSO. | M | SSO feature (stakeholder decision: keep both) |

### 3.2 User Management (Administrator)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| SR-020 | An administrator shall create, edit, and delete users (name, email, password, access level). | M | Original brief |
| SR-021 | A user shall be assignable to **several job roles**. | M | Original brief |
| SR-022 | An administrator shall be able to mark a user as a **Trainer** or **Administrator**. | M | Spec |

### 3.3 Job Roles (Administrator)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| SR-030 | An administrator shall maintain a simple, editable list of **job roles** (name, description). | M | Original brief |
| SR-031 | Each job role shall **require several trainings**; the administrator chooses which trainings a role demands. | M | Original brief |
| SR-032 | The trainings a user must complete shall be derived from the union of their roles' required trainings (with duplicates removed). | M | Spec |

### 3.4 Trainings (Administrator / Trainer)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| SR-040 | The system shall maintain an editable list of **trainings** (name, description, category, duration). | M | Original brief |
| SR-041 | Each training shall reference **learning material** (links to documents, e.g. OneDrive) that learners open to study. | M | Spec |
| SR-042 | Each training shall include a **multiple-choice quiz** with a defined correct answer per question. | M | Spec |
| SR-043 | Each training shall define a **recurrence cycle** (how often, in years, it must be repeated). | M | Spec |
| SR-044 | Each training shall define a **due window** — how early before the due date it becomes available and how long after it remains in grace before counting as overdue. | M | Spec |
| SR-045 | A **trainer shall own and manage only their own trainings**; an administrator manages all trainings and may assign a training's owner. | M | Spec |
| SR-046 | An administrator shall be able to **reorder trainings via drag-and-drop**, defining an explicit display order. | S | Training-ordering feature |
| SR-047 | The administrator-defined training order shall be **respected consistently in every view** that lists trainings (admin list, learner dashboard, trainee oversight, role editor). | S | Training-ordering feature |

### 3.5 Training Sessions & Assessment (Member)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| SR-050 | A learner shall complete a training as a flow: **review material → take the quiz → see the result**. | M | Spec |
| SR-051 | The quiz shall be **graded by the system**, comparing the score to a configurable pass threshold; the learner must not be able to influence their own score, and correct answers must not be exposed to someone taking the test. | M | Spec (server-side grading) |
| SR-052 | A learner shall be able to **retry** the quiz as often as needed; only a **passing** attempt is recorded. Failed attempts leave the training in its current due state. | M | Spec |
| SR-053 | The system shall compute each training's **due status** per user (never taken, up-to-date, due now, overdue) from the last passing attempt and the training's cycle/window. | M | Spec |

### 3.6 Learner Dashboard (Member)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| SR-060 | The dashboard shall show the trainings required of the signed-in user, each with its current due status and a clear call to start. | M | Original brief / Spec |
| SR-061 | The dashboard shall present a friendly empty state when no trainings are assigned. | C | Spec |

### 3.7 Trainee Oversight (Administrator / Trainer)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| SR-070 | A trainer/administrator shall see, **grouped by training**, who is required to take it and each person's due status. | M | Spec |
| SR-071 | They shall be able to **filter to only those who are due/overdue** and **copy the relevant email addresses** to the clipboard for sending reminders. | S | Spec |

### 3.8 Global Settings (Administrator)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| SR-080 | An administrator shall set a **single global pass threshold** that applies to all trainings at once. | M | Spec |
| SR-081 | An administrator shall manage **SSO configuration** from the same Settings area (see SR-008). | M | SSO feature |

### 3.9 User Experience & Design

| ID | Requirement | Priority | Source |
|---|---|---|---|
| SR-090 | The application shall present a **polished, professional, modern interface** with a distinctive app icon/logo. | M | Original brief ("fantastic user interface", "very good icon") |
| SR-091 | The visual design shall use a **pastel colour palette**, specifically **pastel blue** (not purple). | M | Original brief + refinement |
| SR-092 | Typography shall have a **technical, engineered feel**. | S | Refinement: "fonts more technical" |
| SR-093 | The interface shall be **responsive** (usable on mobile and desktop) and **accessible** (keyboard navigable, clear focus, sensible labels). | M | Spec / NFR |
| SR-094 | Data operations shall give clear feedback: loading indicators while fetching and success/error notifications on actions. | S | Spec / NFR |

---

## 4. Non-Functional & Constraint Requirements

| ID | Requirement | Priority | Source |
|---|---|---|---|
| SR-100 | The application shall be written in **TypeScript** for both frontend and backend. | M | Original brief |
| SR-101 | Data shall be persisted to **local JSON files** (no external database). | M | Original brief |
| SR-102 | The frontend shall be built with **Vue** (not React). | M | Refinement: "Use Vue instead of React" |
| SR-103 | All managed entities (users, roles, trainings, settings) shall be **editable through the user interface**. | M | Original brief |
| SR-104 | Security-sensitive operations (login result/grading/ownership/access checks, SSO token validation) shall be **enforced on the server**, never trusted from the client. | M | Spec / SSO feature |
| SR-105 | Secrets shall not be exposed to clients; SSO must operate **without storing a client secret**, so that its configuration can safely be admin-editable. | M | SSO feature (design constraint) |
| SR-106 | The system shall be **easy to run for evaluation**, seeding demo data (an admin, a trainer, a member) on first start. | S | Spec |

---

## 5. Out of Scope (currently)

- Public self-service registration (admins create accounts).
- A relational/SQL database or multi-server deployment.
- Multi-tenant Microsoft sign-in (SSO is single-tenant).
- Reporting/export beyond the trainee email-copy convenience.

## 6. Traceability Notes

- **"Original brief"** and **"Refinement"** sources correspond to the stakeholder request log at the top of
  [`brain-gain.md`](../brain-gain.md).
- **"Spec"** denotes requirements elaborated in the body of that same document.
- **"Training-ordering feature"** and **"SSO feature"** denote needs agreed and implemented during
  development; their design decisions (admin-configurable, keep password login, domain-restricted
  provisioning) are reflected above.
