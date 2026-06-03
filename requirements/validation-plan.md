# BrainGain — Validation Plan

<!-- GENERATED FROM requirements.json by requirements/tools/build.mjs — DO NOT EDIT BY HAND -->

> Generated from `requirements.json` · 51 validation tests · updated 2026-06-03.
> Validation answers *"are we building the right thing?"* — each test exercises one or more **stakeholder**
> requirements (`SR-…`), including usability and accessibility.

## Acceptance tests (38)

#### VT-001 — Email/password login

- **Method:** Manual · **Validates:** SR-001, SR-002
- **Preconditions:** Seeded admin account exists.
- **Steps:**
  1. Open /login.
  2. Enter correct admin email + password and submit.
  3. Enter wrong password and submit.
- **Expected:** Correct credentials sign in and land on the dashboard listing the user's relevant trainings; wrong credentials show an error and do not sign in.

#### VT-002 — No public self-registration

- **Method:** Inspection · **Validates:** SR-001
- **Steps:**
  1. Inspect the UI and API for any public registration route/form.
- **Expected:** No registration endpoint or sign-up form exists; only an admin can create users.

#### VT-003 — Admin-only editing is enforced server-side

- **Method:** Manual · **Validates:** SR-003, SR-004
- **Preconditions:** A member and a trainer account exist.
- **Steps:**
  1. As a member, attempt to reach /users, /roles, /trainings via the UI.
  2. As a member/trainer, call the mutating API endpoints directly (POST/PUT/DELETE) with a valid token.
  3. As an admin, perform the same edits.
- **Expected:** Non-admins do not see the admin nav, are redirected from admin routes, and receive 403 from the API; only the admin can edit.

#### VT-004 — Role-appropriate capabilities

- **Method:** Manual · **Validates:** SR-004
- **Steps:**
  1. Sign in as member, trainer, then admin and inspect the visible navigation and pages.
- **Expected:** Member sees only My Trainings; trainer additionally sees Trainings/Trainees (own); admin sees all pages.

#### VT-005 — Session persists across reloads

- **Method:** Manual · **Validates:** SR-005
- **Preconditions:** Logged in.
- **Steps:**
  1. Reload the page.
  2. Clear the token / wait for expiry and reload.
- **Expected:** Reload keeps the user signed in (token rehydrated); a missing/expired token redirects to /login.

#### VT-006 — Microsoft SSO sign-in (coexists with password)

- **Method:** Manual · **Validates:** SR-006, SR-010
- **Preconditions:** SSO enabled with a real tenant; an allowed-domain account.
- **Steps:**
  1. Click 'Sign in with Microsoft' and complete the popup.
  2. Separately, sign in with a demo password account.
- **Expected:** Both SSO and password login succeed and land on the dashboard with an app session.

#### VT-007 — SSO optional / graceful when off

- **Method:** API check · **Validates:** SR-007
- **Preconditions:** SSO disabled in Settings.
- **Steps:**
  1. Load /login.
  2. GET /api/auth/sso/config.
  3. POST /api/auth/sso/entra.
- **Expected:** No Microsoft button shown; config returns { enabled:false }; the entra endpoint returns 503; password login works as normal.

#### VT-008 — Configure SSO in-app (independent of threshold)

- **Method:** Manual · **Validates:** SR-008, SR-081
- **Preconditions:** Signed in as admin.
- **Steps:**
  1. On Settings, fill tenant id, client id, allowed domains, toggle Enabled, Save.
  2. Reload Settings.
  3. Confirm the global pass threshold is unchanged.
- **Expected:** Values persist; the login page now shows the Microsoft button; saving SSO does not alter the pass threshold.

#### VT-009 — Domain-restricted provisioning & account linking

- **Method:** Manual · **Validates:** SR-009
- **Preconditions:** SSO enabled; allowed domains set; an existing local user sharing one SSO email.
- **Steps:**
  1. Sign in via SSO with an email whose domain is NOT allowed and no local match.
  2. Sign in via SSO with an email matching an existing local user.
  3. Sign in via SSO with a new allowed-domain email.
- **Expected:** Unlisted-domain/no-match is refused (403); a matching email links the Entra account without changing the user's roles; a new allowed-domain user is auto-created as a member.

#### VT-020 — Admin manages users

- **Method:** Manual · **Validates:** SR-020, SR-022
- **Preconditions:** Signed in as admin.
- **Steps:**
  1. Create a user with name/email/password and admin & trainer toggles.
  2. Edit the user (incl. changing the password).
  3. Delete the user.
- **Expected:** User is created, updated (blank password keeps the old one), and deleted; admin/trainer flags take effect.

#### VT-021 — User belongs to several roles

- **Method:** Manual · **Validates:** SR-021
- **Steps:**
  1. Assign two or more job roles to a user and save.
  2. Reopen the user.
- **Expected:** All assigned roles persist on the user.

#### VT-030 — Admin manages job roles

- **Method:** Manual · **Validates:** SR-030
- **Steps:**
  1. Create, edit, and delete a job role (name, description).
- **Expected:** Roles are created, updated, and removed.

#### VT-031 — Role requires trainings

- **Method:** Manual · **Validates:** SR-031
- **Steps:**
  1. In a role, select several required trainings and save.
  2. Reopen the role.
- **Expected:** The selected trainingIds persist on the role.

#### VT-032 — Required trainings derived & deduplicated

- **Method:** Manual · **Validates:** SR-032
- **Preconditions:** A user holds two roles that share a training.
- **Steps:**
  1. Open that user's dashboard.
- **Expected:** The shared training appears exactly once; the dashboard shows the union of all roles' trainings.

#### VT-040 — Trainings are editable

- **Method:** Manual · **Validates:** SR-040
- **Steps:**
  1. Create and edit a training's name, description, category, and duration.
- **Expected:** Changes persist and appear in the trainings list.

#### VT-041 — Material links open documents

- **Method:** Manual · **Validates:** SR-041
- **Steps:**
  1. Add a material link to a training.
  2. Open a session and click the material.
- **Expected:** The linked document opens in a new tab.

#### VT-042 — Multiple-choice quiz with correct answer

- **Method:** Manual · **Validates:** SR-042
- **Steps:**
  1. Add questions with options and mark the correct option; save.
- **Expected:** Questions persist with a defined correct answer per question.

#### VT-043 — Recurrence cycle drives due date

- **Method:** Manual · **Validates:** SR-043
- **Steps:**
  1. Set cycleYears on a training.
  2. Pass it, then inspect the computed due date.
- **Expected:** Due date = last passed + cycleYears.

#### VT-044 — Due window transitions

- **Method:** Manual · **Validates:** SR-044
- **Steps:**
  1. Set windowBefore/After months.
  2. Evaluate status around the due date boundaries.
- **Expected:** Status moves up-to-date → due (window opens) → overdue (after grace) per the configured window.

#### VT-045 — Trainer ownership enforced

- **Method:** Manual · **Validates:** SR-045
- **Steps:**
  1. As a trainer, attempt to edit a training owned by someone else (UI + direct API).
  2. As an admin, reassign a training's owner.
- **Expected:** A trainer can mutate only their own trainings (others → 403); only an admin can change ownerId.

#### VT-046 — Drag-and-drop reorder persists

- **Method:** Manual · **Validates:** SR-046
- **Preconditions:** Signed in as admin on Trainings.
- **Steps:**
  1. Drag a training to a new position via the grip handle.
  2. Reload the page.
- **Expected:** The new order is saved and survives reload; trainers do not see the handle.

#### VT-047 — Order respected in every view

- **Method:** Manual · **Validates:** SR-047
- **Steps:**
  1. Reorder trainings as admin.
  2. Inspect the learner dashboard, the trainees view, and the role editor's training list.
- **Expected:** All views present trainings in the admin-defined order.

#### VT-050 — Session flow material → quiz → result

- **Method:** Manual · **Validates:** SR-050
- **Steps:**
  1. Start a session, review material, advance to the quiz, submit, view the result.
- **Expected:** The three-step flow works and shows a pass/fail result.

#### VT-051 — Server-side grading; answers hidden

- **Method:** API check · **Validates:** SR-051
- **Steps:**
  1. Fetch a training as a learner and inspect the quiz payload.
  2. Submit answers to /api/sessions/grade.
  3. Attempt to submit a fabricated score.
- **Expected:** correctIndex is absent from the learner payload; the server computes the score and compares to the threshold; a client-supplied score is ignored.

#### VT-052 — Unlimited retries; only passes recorded

- **Method:** Manual · **Validates:** SR-052
- **Steps:**
  1. Fail the quiz, retry, then pass.
  2. Inspect recorded sessions.
- **Expected:** Failed attempts are not recorded and leave the training due; only the passing attempt is persisted.

#### VT-053 — Due status computed correctly

- **Method:** Manual · **Validates:** SR-053
- **Steps:**
  1. Create users/sessions to produce never / up-to-date / due / overdue states.
- **Expected:** Each training shows the correct due status from the last passing attempt and the cycle/window.

#### VT-060 — Dashboard shows required trainings + status

- **Method:** Manual · **Validates:** SR-060
- **Steps:**
  1. Open the dashboard as a member with assigned roles.
- **Expected:** All required trainings are listed with a due-status pill and a clear Start action.

#### VT-061 — Friendly empty state

- **Method:** Manual · **Validates:** SR-061
- **Preconditions:** A member with no roles.
- **Steps:**
  1. Open the dashboard.
- **Expected:** A friendly empty state is shown (no errors/blank screen).

#### VT-070 — Trainee oversight grouped by training

- **Method:** Manual · **Validates:** SR-070
- **Steps:**
  1. Open Trainees as a trainer/admin.
- **Expected:** Trainees are grouped per training, each with their due status.

#### VT-071 — Filter due & copy emails

- **Method:** Manual · **Validates:** SR-071
- **Steps:**
  1. Toggle 'only due/overdue'.
  2. Click copy-emails for a group and 'copy all'.
- **Expected:** The list filters to actionable trainees; the clipboard receives a ';'-separated recipient list with a confirming toast.

#### VT-080 — Global pass threshold applies everywhere

- **Method:** Manual · **Validates:** SR-080
- **Steps:**
  1. Set the pass threshold on Settings.
  2. Take a quiz scoring just below and just above it.
- **Expected:** Pass/fail is decided against the single global threshold for every training.

#### VT-100 — TypeScript throughout

- **Method:** Inspection · **Validates:** SR-100
- **Steps:**
  1. Run typecheck in backend and frontend.
- **Expected:** Both projects are TypeScript and typecheck with no errors and no 'any' leakage.

#### VT-101 — JSON-file persistence, no database

- **Method:** Inspection · **Validates:** SR-101
- **Steps:**
  1. Inspect backend/src/data/*.json and dependencies.
- **Expected:** Data is persisted in JSON files; no database engine or driver is present.

#### VT-102 — Vue frontend

- **Method:** Inspection · **Validates:** SR-102
- **Steps:**
  1. Inspect the frontend stack.
- **Expected:** The frontend is Vue 3 (not React).

#### VT-103 — All entities editable via UI

- **Method:** Manual · **Validates:** SR-103
- **Steps:**
  1. Edit a user, a role, a training, and settings entirely through the UI.
- **Expected:** Every managed entity is fully editable in the interface.

#### VT-104 — Security enforced server-side (no client bypass)

- **Method:** API check · **Validates:** SR-104
- **Steps:**
  1. Attempt grading, ownership, and access operations by calling the API directly while bypassing the UI.
- **Expected:** All checks are enforced by the server regardless of client behaviour (403/validation as appropriate).

#### VT-105 — No secrets leak to clients

- **Method:** API check · **Validates:** SR-105
- **Steps:**
  1. Inspect /api/auth/me, /api/users, and training payloads.
  2. Inspect SSO config handling.
- **Expected:** Responses never contain passwordHash, entraOid, or correctIndex; no client secret is used or exposed by SSO.

#### VT-106 — Easy run + first-run seed

- **Method:** Manual · **Validates:** SR-106
- **Steps:**
  1. Start backend + frontend from a clean state.
- **Expected:** Demo admin/trainer/member accounts are seeded on first start and the app is immediately usable.

## Usability tests (9)

#### VT-U01 — First-login orientation

- **Method:** Manual · **Validates:** SR-002, SR-060, SR-090
- **Preconditions:** 5 representative users new to BrainGain.
- **Steps:**
  1. Hand the user the app at /login with credentials.
  2. Observe, without guidance, whether they understand what they must do next.
- **Expected:** Users correctly identify that they have trainings to complete and where to start.
- **Acceptance metric:** ≥ 4/5 users self-orient within 30s; no critical confusion.

#### VT-U02 — Find and start a due training

- **Method:** Manual · **Validates:** SR-060, SR-050, SR-093, SR-094
- **Steps:**
  1. Task: 'Start the training that is due for you.'
  2. Time to completion and count wrong turns.
- **Expected:** Users locate a due training and reach the session start unaided.
- **Acceptance metric:** Task success ≥ 90%; median time < 60s; SUS ≥ 80 across 5 users.

#### VT-U03 — Complete a training and retry on fail

- **Method:** Manual · **Validates:** SR-050, SR-052, SR-094
- **Steps:**
  1. Task: read material, take the quiz, and pass it.
  2. Have the user deliberately fail once.
- **Expected:** Users move through material → quiz → result and discover how to retry without help; feedback is clear.
- **Acceptance metric:** Task success ≥ 90%; retry discovered unaided by ≥ 4/5.

#### VT-U04 — Author a training with a quiz

- **Method:** Manual · **Validates:** SR-040, SR-042, SR-094
- **Preconditions:** Trainer/admin participants.
- **Steps:**
  1. Task: create a training with one material link and two quiz questions.
- **Expected:** Participants build a complete, valid training unaided.
- **Acceptance metric:** Task success ≥ 80%; no blocking confusion on questions/correct-answer UI.

#### VT-U05 — Reorder trainings

- **Method:** Manual · **Validates:** SR-046, SR-047
- **Preconditions:** Admin participants.
- **Steps:**
  1. Task: 'Move a chosen training to the top of the list.'
- **Expected:** Participants discover the drag handle and reorder successfully; the change is clearly persisted.
- **Acceptance metric:** Task success ≥ 80%; handle discovered unaided by ≥ 3/5.

#### VT-U06 — Configure SSO from Settings

- **Method:** Manual · **Validates:** SR-008
- **Preconditions:** Admin participants with tenant/client values to hand.
- **Steps:**
  1. Task: enable Microsoft sign-in and restrict it to a domain.
  2. Note whether the redirect-URI hint is understood.
- **Expected:** Participants complete SSO configuration using the on-screen guidance.
- **Acceptance metric:** Task success ≥ 80%; redirect-URI hint rated helpful.

#### VT-U07 — Send reminders to due trainees

- **Method:** Manual · **Validates:** SR-070, SR-071
- **Preconditions:** Trainer/admin participants.
- **Steps:**
  1. Task: 'Get the email addresses of everyone overdue for a training.'
- **Expected:** Participants filter to due/overdue and copy the right recipients.
- **Acceptance metric:** Task success ≥ 90%; median time < 45s.

#### VT-U08 — Brand & visual impression

- **Method:** Manual · **Validates:** SR-090, SR-091, SR-092
- **Steps:**
  1. Show the app for 5 seconds, then ask for first impressions and descriptive words.
- **Expected:** Users describe the UI as polished/professional and perceive the pastel-blue, technical aesthetic and recognisable logo.
- **Acceptance metric:** ≥ 4/5 positive first-impression; palette/fonts described as intended.

#### VT-U09 — Feedback on actions (loading & toasts)

- **Method:** Manual · **Validates:** SR-094
- **Steps:**
  1. Perform a save and a deliberately failing action on slow network.
- **Expected:** Loading/skeleton states appear during fetches and success/error toasts clearly confirm or explain outcomes.
- **Acceptance metric:** All observed actions give visible feedback within 1s.

## Accessibility tests (4)

#### VT-A01 — Full keyboard operability

- **Method:** Manual · **Validates:** SR-093
- **Steps:**
  1. Operate every primary flow (login, dashboard, session, admin edits) using only the keyboard.
- **Expected:** All interactive elements are reachable and operable by keyboard with a visible focus indicator and logical tab order.
- **Acceptance metric:** WCAG 2.1 AA 2.1.1 / 2.4.7 pass.

#### VT-A02 — Names, roles, labels for assistive tech

- **Method:** Manual · **Validates:** SR-093
- **Steps:**
  1. Inspect inputs, buttons, and icons with a screen reader / a11y inspector.
- **Expected:** Form fields have associated labels and icon-only controls have accessible names.
- **Acceptance metric:** No missing-name/label violations (e.g. axe).

#### VT-A03 — Colour contrast on pastel palette

- **Method:** Manual · **Validates:** SR-093, SR-091
- **Steps:**
  1. Measure text and UI contrast across cards, pills, nav, and inputs.
- **Expected:** Text and essential UI meet WCAG AA contrast on the pastel-blue theme.
- **Acceptance metric:** Contrast ≥ 4.5:1 (normal text) / 3:1 (large/UI).

#### VT-A04 — Responsive at 375px and 1440px

- **Method:** Manual · **Validates:** SR-093
- **Steps:**
  1. View the app at 375px and 1440px widths.
- **Expected:** Layout is usable at both sizes with no clipping/overlap; the sidebar collapses appropriately on mobile.
- **Acceptance metric:** No horizontal scroll or obscured controls at 375px.

## Coverage (stakeholder requirement → validation tests)

| SR | Title | Priority | Validated by |
|---|---|---|---|
| SR-001 | Email/password authentication | M | VT-001, VT-002 |
| SR-002 | Land on relevant trainings after sign-in | M | VT-001, VT-U01 |
| SR-003 | Admin-only editing, reliably enforced | M | VT-003 |
| SR-004 | Three access levels | M | VT-003, VT-004 |
| SR-005 | Persistent session | S | VT-005 |
| SR-006 | Sign in with Microsoft Entra ID | S | VT-006 |
| SR-007 | SSO optional & configurable | M | VT-007 |
| SR-008 | Configure SSO in-app | M | VT-008, VT-U06 |
| SR-009 | Domain-restricted provisioning & linking | M | VT-009 |
| SR-010 | Keep password login alongside SSO | M | VT-006 |
| SR-020 | Admin manages users | M | VT-020 |
| SR-021 | User belongs to several roles | M | VT-021 |
| SR-022 | Mark trainer/administrator | M | VT-020 |
| SR-030 | Editable job-role list | M | VT-030 |
| SR-031 | Role requires trainings | M | VT-031 |
| SR-032 | Required trainings derived from roles | M | VT-032 |
| SR-040 | Editable training list | M | VT-040, VT-U04 |
| SR-041 | Learning material links | M | VT-041 |
| SR-042 | Multiple-choice quiz | M | VT-042, VT-U04 |
| SR-043 | Recurrence cycle | M | VT-043 |
| SR-044 | Due window | M | VT-044 |
| SR-045 | Trainer owns their trainings | M | VT-045 |
| SR-046 | Admin reorders via drag-and-drop | S | VT-046, VT-U05 |
| SR-047 | Order respected everywhere | S | VT-047, VT-U05 |
| SR-050 | Material → quiz → result flow | M | VT-050, VT-U02, VT-U03 |
| SR-051 | Server-side grading | M | VT-051 |
| SR-052 | Unlimited retries; record only passes | M | VT-052, VT-U03 |
| SR-053 | Computed due status | M | VT-053 |
| SR-060 | Dashboard of required trainings | M | VT-060, VT-U01, VT-U02 |
| SR-061 | Friendly empty state | C | VT-061 |
| SR-070 | Who must take each training | M | VT-070, VT-U07 |
| SR-071 | Filter due & copy emails | S | VT-071, VT-U07 |
| SR-080 | Global pass threshold | M | VT-080 |
| SR-081 | Manage SSO from Settings | M | VT-008 |
| SR-090 | Polished, professional UI + icon | M | VT-U01, VT-U08 |
| SR-091 | Pastel-blue palette | M | VT-U08, VT-A03 |
| SR-092 | Technical typography | S | VT-U08 |
| SR-093 | Responsive & accessible | M | VT-U02, VT-A01, VT-A02, VT-A03, VT-A04 |
| SR-094 | Clear operation feedback | S | VT-U02, VT-U03, VT-U04, VT-U09 |
| SR-100 | TypeScript everywhere | M | VT-100 |
| SR-101 | JSON-file persistence | M | VT-101 |
| SR-102 | Vue frontend | M | VT-102 |
| SR-103 | All entities editable via UI | M | VT-103 |
| SR-104 | Server-side security enforcement | M | VT-104 |
| SR-105 | No secrets to clients | M | VT-105 |
| SR-106 | Easy to run; seed demo data | S | VT-106 |
