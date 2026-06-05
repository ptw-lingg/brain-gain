# Manual test procedures — Users & Roles (SYS areas: USR, ROL)

Manual / exploratory procedures for things the automated backend tests
(`backend/tests/users-roles.test.mjs`) and the Playwright e2e spec
(`frontend/e2e/users-roles.spec.ts`) cannot mechanically cover. Everything observable
over the API — admin-only CRUD for `/api/users` and `/api/roles`, the blank-password-keeps-old
rule, duplicate-email `409`, non-admin `403`, and `role.trainingIds` round-trip — is asserted in
the backend test. The admin-creates/edits/deletes-a-user drawer flow and the manage-a-job-role
flow are in the e2e spec. The procedures below need human visual judgement, the end-to-end
"required trainings are derived from roles" effect (which requires a learner dashboard run), or
inspection that is not mechanically asserted here.

System requirements in scope: **SYS-USR-01** (`/api/users` CRUD), **SYS-USR-02** (Users page +
drawer), **SYS-ROL-01** (`/api/roles` CRUD), **SYS-ROL-02** (role editor training multi-select),
**SYS-ROL-03** (role editor honours training order).
Stakeholder requirements: **SR-020** (admin manages users), **SR-021** (user belongs to several
roles), **SR-022** (mark trainer/administrator), **SR-030** (editable job-role list), **SR-031**
(role requires trainings), **SR-032** (required trainings derived from roles, deduped),
**SR-003** (admin-only editing enforced server-side), **SR-047** (order respected everywhere).

Coverage split:

| Requirement | Backend test | E2e spec | Manual (this doc) |
|---|---|---|---|
| SYS-USR-01 `/api/users` CRUD (create/update/delete; blank-pw; dup email 409) | yes | — | — |
| SYS-USR-02 Users page table + drawer (role multi-select; admin/trainer toggles) | — | yes | visual/UX only — **MT-UR-03** |
| SYS-ROL-01 `/api/roles` admin-only CRUD | yes | — | — |
| SYS-ROL-02 Role editor training multi-select (writes `trainingIds`) | round-trip | yes | — |
| SYS-ROL-03 Role editor honours training order | — | partial (list present) | **MT-UR-02** (order matches) |
| SR-003 admin-only enforced server-side | yes (403/401) | partial (VT-003 in auth.spec) | **MT-UR-04** (direct-API probe) |
| SR-021 several roles per user persist | yes | yes | — |
| SR-022 trainer/administrator flags take effect | flags stored + login | toggles in drawer | **MT-UR-01** (capabilities change) |
| SR-032 required trainings derived & deduped from roles | — | — | **MT-UR-01** (dashboard union) |

---

## MT-UR-01 — Access-level flags and role assignment take effect end-to-end (SR-021, SR-022, SR-032, VT-021, VT-032)

The backend test asserts the flags and `roleIds` are stored and that a created user can log in;
the e2e spec drives the drawer toggles. This procedure validates the **observable consequence** of
those flags and assignments — what the user can see and do, and that their dashboard shows the
**deduplicated union** of their roles' required trainings — which requires signing in as the
managed user.

**Preconditions:** Signed in as `admin@braingain.app`. The seeded "Lab Technician" role requires
"Laboratory Safety Basics" and "Quality Management Intro".

**Steps & expected:**

1. On **Users**, click **Add User**. Create a user (e.g. `pat@test.local` / `secret123`), tick
   **Trainer**, leave **Admin** off, and save.
   - Expected: toast "User created"; the row shows the **trainer** access pill.
2. Sign out and sign in as `pat@test.local`.
   - Expected: the sidebar shows the **trainer** capabilities (My Trainings plus Trainings/Trainees
     for owned trainings) but **not** Users/Settings — confirming the Trainer flag took effect (SR-022).
3. Sign back in as admin. Create a **second** job role (e.g. "Shared-Training Role") that also
   requires "Laboratory Safety Basics" (a training the Lab Technician role already requires). Open
   `pat@test.local` and assign **both** "Lab Technician" and "Shared-Training Role"; save, then
   reopen the user.
   - Expected: both roles remain checked — several roles persist on one user (SR-021, VT-021).
4. Promote `pat@test.local` to **Admin** (tick Admin), save, then sign in as that user.
   - Expected: the full admin navigation (Users, Settings, Job Roles, …) is now visible —
     the Administrator flag took effect (SR-022).
5. Demote back to a plain member (untick Admin and Trainer), assign the two roles above, then sign
   in as `pat@test.local` and open the **dashboard**.
   - Expected: "Laboratory Safety Basics" appears **exactly once** even though two roles require it,
     and the dashboard shows the **union** of both roles' trainings (SR-032, VT-032).

---

## MT-UR-02 — Role editor lists trainings in the admin-defined order (SR-047, SYS-ROL-03, VT-047)

The e2e spec confirms the role editor renders the training checklist; this procedure verifies the
**order** matches the admin-defined drag-and-drop order, which is a cross-view visual comparison.

**Preconditions:** Signed in as `admin@braingain.app`. At least two trainings exist.

**Steps & expected:**

1. On **Trainings**, drag a training to a new position via the grip handle so the list order
   visibly changes; note the resulting top-to-bottom order.
2. Go to **Job Roles**, click **Add Role** (or open an existing role) and look at the
   **Required trainings** checklist.
   - Expected: the trainings are listed in the **same** order as the Trainings page (the editor
     fetches the server-ordered `GET /trainings`), confirming SR-047 / SYS-ROL-03.
3. Cross-check the learner **dashboard** and the **Trainees** view for the same order.
   - Expected: every view that lists trainings presents them in the admin-defined order.

---

## MT-UR-03 — Users & Roles pages: polish, layout, feedback, and accessibility (SR-090..SR-094, SYS-USR-02, SYS-ROL-02)

Human visual / usability / accessibility judgement of the Users page (table + slide-out drawer)
and the Roles page (expandable role cards with the training multi-select) — not mechanically
testable.

**Preconditions:** Signed in as `admin@braingain.app`.

**Steps & expected:**

1. On **Users**, inspect the table and open the slide-out drawer (Add User / row click).
   - Expected: a polished, professional layout using the pastel-blue palette (not purple) and the
     technical typography; the drawer slides in over a dim backdrop with clearly labelled
     Name/Email/Password fields, Admin/Trainer toggles, and a job-role multi-select.
2. On **Job Roles**, expand a role card to reveal the editor.
   - Expected: the training multi-select is a clearly labelled checkbox grid; selected items are
     visually highlighted.
3. Resize the viewport from desktop (~1440px) down to a narrow mobile width (~375px).
   - Expected: the Users table and the Roles cards remain readable and usable; the drawer is usable;
     no overlap or clipped controls; no horizontal scroll (SR-093).
4. Operate the Users drawer and the Roles editor using **only the keyboard** (Tab/Shift-Tab to move,
   Space to toggle checkboxes, Enter to submit).
   - Expected: every control is reachable, has a visible focus indicator and a sensible label, and
     can be operated without a mouse (SR-093).
5. Save a user and a role, and trigger a deliberate failure (e.g. submit a duplicate email).
   - Expected: a success toast on success and a clear error toast on failure ("Could not save …"),
     with loading/disabled feedback during the request (SR-094).

---

## MT-UR-04 — Admin-only editing is enforced server-side, not just hidden (SR-003, SYS-AC-02, VT-003)

The backend test asserts `403`/`401` for member tokens on the users/roles routes. This procedure
documents the manual direct-API probe that demonstrates the control is enforced on the **server**
and cannot be bypassed by manipulating the client (the explicit intent of SR-003).

**Preconditions:** A member token (sign in as `user@braingain.app` and copy the `Authorization:
Bearer` token from a request) and a trainer token (`trainer@braingain.app`).

**Steps & expected:**

1. With the **member** token, call the mutating endpoints directly (bypassing the UI), e.g.:
   - `POST /api/users`, `PUT /api/users/<id>`, `DELETE /api/users/<id>`
   - `POST /api/roles`, `PUT /api/roles/<id>`, `DELETE /api/roles/<id>`
   - Expected: every call returns **403** (the member token is rejected by `requireAdmin`).
2. Repeat the role/user mutations with the **trainer** token.
   - Expected: still **403** — trainer is not admin for user/role management.
3. Call `GET /api/users` with the member token, and with **no** token.
   - Expected: member → **403**; no token → **401** (`authenticate` then `requireAdmin`).
4. Call `GET /api/roles` with the member token.
   - Expected: **200** — reading roles is allowed for any authenticated user (to resolve role
     names in the UI); only the **mutations** are admin-gated.
5. As confirmation, perform the same create/edit/delete with an **admin** token.
   - Expected: the operations succeed (201/200/204) — only the admin can edit, regardless of which
     client is used.
