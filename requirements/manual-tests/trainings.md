# Manual test procedures — Trainings (SYS areas: TRN)

Manual / exploratory procedures for things the automated backend tests
(`backend/tests/trainings.test.mjs`) and the Playwright e2e spec
(`frontend/e2e/trainings.spec.ts`) cannot mechanically cover. Everything observable over the API —
`/api/trainings` CRUD, trainer-or-admin to create, admin-or-owner to edit/delete, admin-only
`ownerId` assignment, `PUT /api/trainings/reorder` (admin-only), the `correctIndex`-stripped
**public** shape for non-owners, `cycleYears`/window clamps, and material-link/question
sanitisation — is asserted in the backend test. The admin/trainer create-and-edit flow on the
Trainings page, the admin-only drag handle, and a best-effort drag-reorder are in the e2e spec.
The procedures below need human visual judgement, the genuine **drag-and-drop** interaction (native
HTML5 DnD is unreliable headless), the material-link "opens a document in a new tab" behaviour, or a
direct-API security probe demonstrating server-side enforcement.

System requirements in scope: **SYS-TRN-01** (GET `/` ordered; `?mine`; answer key stripped),
**SYS-TRN-02** (GET `/:id`), **SYS-TRN-03** (POST `/` — owner rules, append order),
**SYS-TRN-04** (PUT `/:id` — preserve order, admin-only `ownerId`), **SYS-TRN-05** (DELETE `/:id`),
**SYS-TRN-06** (PUT `/reorder`), **SYS-TRN-07** (order is the single source of truth),
**SYS-TRN-08** (drag-and-drop reorder UI), **SYS-TRN-09** (training editor fields),
**SYS-DATA-04** (Training entity / cycle & window clamps), **SYS-DATA-05** (answer key stripped).
Stakeholder requirements: **SR-040** (editable training list), **SR-041** (learning-material links),
**SR-042** (multiple-choice quiz), **SR-043** (recurrence cycle), **SR-044** (due window),
**SR-045** (trainer owns their trainings; admin assigns owner), **SR-046** (admin drag-reorder),
**SR-047** (order respected everywhere), **SR-051** (server-side grading; answers hidden),
**SR-104** (security enforced server-side), **SR-105** (no secrets leak to clients).

Coverage split:

| Requirement | Backend test | E2e spec | Manual (this doc) |
|---|---|---|---|
| SYS-TRN-01 GET `/` ordered; `?mine`; answer key stripped (SR-040, SR-047, SR-051) | yes | partial (list shown) | — |
| SYS-TRN-02 GET `/:id`, key stripped for non-owners (SR-050) | yes | — | — |
| SYS-TRN-03 POST `/` owner rules + append order (SR-045, SR-046) | yes | create flow | — |
| SYS-TRN-04 PUT `/:id` preserve order; admin-only `ownerId` (SR-045) | yes | edit flow | **MT-TRN-01** (owner reassign UX) |
| SYS-TRN-05 DELETE `/:id` admin-or-owner (SR-045) | yes | — | — |
| SYS-TRN-06 PUT `/reorder` admin-only; order = position (SR-046) | yes | — (proven by backend) | **MT-TRN-02** (real drag) |
| SYS-TRN-07 order single source across views (SR-046, SR-047) | yes (`/`, `/mine`) | partial | **MT-TRN-03** (every view) |
| SYS-TRN-08 drag-and-drop reorder UI; trainer no handle (SR-046) | — | handle present + best-effort drag | **MT-TRN-02** |
| SYS-TRN-09 editor fields (cycle/window/links/questions/owner) (SR-041..045) | clamp/sanitize | controls present | **MT-TRN-04** (round-trip + UX) |
| SR-041 material links open documents (VT-041) | url stored | — | **MT-TRN-05** (opens in new tab) |
| SR-051 / SR-105 answers hidden to learner | yes (no `correctIndex`) | — | **MT-TRN-06** (network inspection) |
| SR-104 server-side enforcement (no client bypass) | yes (403/401) | — | **MT-TRN-06** (direct-API probe) |
| SR-090..094 Trainings page polish / a11y / feedback | — | — | **MT-TRN-07** (visual/UX) |

---

## MT-TRN-01 — Admin reassigns a training's owner; a trainer cannot (SR-045, SYS-TRN-04, SYS-TRN-09, VT-045)

The backend test asserts that only an admin's `ownerId` in the body is honoured and a trainer's is
ignored. This procedure verifies the **observable UX consequence**: the owner change is reflected in
the list, and a reassigned-away trainer loses edit access.

**Preconditions:** Signed in as `admin@braingain.app`. The seeded trainer `trainer@braingain.app`
owns "Laboratory Safety Basics" and "Quality Management Intro".

**Steps & expected:**

1. As admin, open a trainer-owned training on **Trainings**. Note the **Owner (trainer)** select is
   present and shows the trainer.
   - Expected: the owner pill in the row shows the trainer's name; the editor exposes the owner
     dropdown (admin-only field, SYS-TRN-09).
2. Change the owner to **Ada Admin** (or another trainer) and **Save**.
   - Expected: toast "Training updated"; the row's owner pill updates to the new owner.
3. Sign out, sign in as `trainer@braingain.app`, and open **Trainings**.
   - Expected: the reassigned training **no longer appears** in the trainer's list (the page loads
     `?mine=1` for trainers) — they can manage only their own trainings (SR-045).
4. Sign back in as admin and reassign the training back to the original trainer.
   - Expected: it reappears for the trainer; ownership is fully admin-controlled.

> The negative case (a trainer's `ownerId` in the request body being ignored, and a trainer getting
> `403` editing someone else's training) is covered deterministically in `trainings.test.mjs`; the
> trainer UI never renders the owner field so it cannot be exercised through the UI.

---

## MT-TRN-02 — Drag-and-drop reorder persists; trainer has no handle (SR-046, SYS-TRN-06, SYS-TRN-08, VT-046)

The backend test proves the `/reorder` endpoint persists order and is admin-only; the e2e spec
asserts the grip handle is admin-only and attempts a programmatic drag. Native HTML5 drag-and-drop
is unreliable in headless browsers, so the **genuine mouse drag** is verified here by hand.

**Preconditions:** Signed in as `admin@braingain.app` on **Trainings**; at least two trainings exist.

**Steps & expected:**

1. Note the current top-to-bottom order. Press and hold the **grip handle** (⠿, "Drag to reorder")
   on a lower training and drag it to the top of the list.
   - Expected: rows visually reflow as you drag; the dragged row is highlighted/dimmed; on drop a
     toast "Order saved" appears and the chosen training is now first.
2. A plain **row click** (not on the handle) on any training.
   - Expected: the row expands into its editor — clicking a row still opens it for editing; dragging
     only starts from the handle (SYS-TRN-08).
3. **Reload** the page.
   - Expected: the new order survives the reload (persisted server-side via `PUT /reorder`),
     confirming SR-046.
4. Sign out and sign in as `trainer@braingain.app`; open **Trainings**.
   - Expected: **no grip handle** is shown and the header omits the "drag to reorder" hint —
     reordering is admin-only.

---

## MT-TRN-03 — Admin-defined order is respected in every view (SR-047, SYS-TRN-07, VT-047)

The backend test proves `/` and `/mine` honour the saved order. This procedure visually confirms the
**same order across all four views** that list trainings, which spans pages not all reachable in one
automated run.

**Preconditions:** Signed in as `admin@braingain.app`. The member `user@braingain.app` is assigned
both seeded trainings via the "Lab Technician" role.

**Steps & expected:**

1. On **Trainings**, drag the trainings into a distinctive order (e.g. "Quality Management Intro"
   above "Laboratory Safety Basics"); confirm the "Order saved" toast.
2. Open the **Trainees** view (admin/trainer oversight).
   - Expected: trainings are grouped in the same top-to-bottom order as the Trainings list.
3. Open **Job Roles**, expand a role, and look at the **Required trainings** checklist.
   - Expected: trainings appear in the same admin-defined order (RolesPage fetches the server-ordered
     list).
4. Sign in as `user@braingain.app` and open the **dashboard**.
   - Expected: the two required trainings are listed in the same admin-defined order.
   - (This dashboard ordering is also asserted programmatically against `/api/trainings/mine` in
     `trainings.test.mjs` — SYS-TRN-07.)

---

## MT-TRN-04 — Training editor round-trip: cycle, window, links, and questions (SR-041, SR-042, SR-043, SR-044, SYS-TRN-09, VT-040, VT-042, VT-043, VT-044)

The backend test asserts clamping and sanitisation of these fields over the API; the e2e spec
confirms the controls render. This procedure verifies the **end-to-end editor round-trip** through
the UI — that everything a human enters persists and re-displays correctly.

**Preconditions:** Signed in as `trainer@braingain.app` (or admin) on **Trainings**.

**Steps & expected:**

1. Click **Add Training**. Fill Name, Category, Description, and Duration (hours). Set **Repeat every
   (years)** to a value, and both **Window opens (months before)** and **Grace (months after)**.
   - Expected: cycle offers 1–5 years; each window offers 0–3 months (SR-043, SR-044) — values
     outside these ranges are not selectable in the UI and are clamped server-side anyway.
2. Add two **Material (OneDrive) links** with a label + URL each (use **Add link**); remove one to
   confirm the trash control works.
   - Expected: link rows add/remove cleanly (SR-041).
3. Add a **Multiple-choice question** (use **Add question**): enter the text, add ≥ 2 options, and
   select the **correct** option via its radio button. Add a second question.
   - Expected: each question requires ≥ 2 options (the remove-option control is disabled at 2);
     exactly one option per question is markable correct (SR-042).
4. Click **Create**, then click the new training's row to reopen it.
   - Expected: every field round-trips — name/category/description/duration, the chosen cycle and
     window, both material links, and both questions with the correct option pre-selected (VT-040,
     VT-042).
5. Edit a value (e.g. change the cycle), **Save**, reopen.
   - Expected: the edit persists; `order` is unchanged (editing never reorders, SYS-TRN-04).

---

## MT-TRN-05 — Material links open the linked document (SR-041, VT-041)

Not mechanically asserted: the API only stores the URL; opening it in a browser tab is a UI behaviour.

**Preconditions:** A training with at least one material link (e.g. the seeded "Laboratory Safety
Basics" has "Lab Safety Handbook (OneDrive)"). Signed in as a member who must take it
(`user@braingain.app`) or any user who can open the session.

**Steps & expected:**

1. From the **dashboard**, start a session for a training that has material links and reach the
   material-review step.
2. Click a material link.
   - Expected: the linked document opens in a **new browser tab** (the original session tab is
     preserved), confirming learners can open material to study (SR-041, VT-041).

---

## MT-TRN-06 — Answers are never exposed and ownership/access is enforced server-side (SR-051, SR-104, SR-105, SYS-TRN-01, SYS-TRN-02, SYS-DATA-05, VT-051, VT-104, VT-105)

The backend test asserts the public shape strips `correctIndex` and that non-owners/members get
`403`/`401`. This procedure documents the manual **network/direct-API probe** demonstrating the
control holds on the server and cannot be bypassed by the client (the explicit intent of SR-104/105).

**Preconditions:** A member token (sign in as `user@braingain.app`, copy the `Authorization: Bearer`
token from a network request) and a trainer token (`trainer@braingain.app`).

**Steps & expected:**

1. As the member, open the browser dev-tools **Network** tab and load the **dashboard** / start a
   session. Inspect the `GET /api/trainings`, `GET /api/trainings/mine`, and `GET /api/trainings/:id`
   responses.
   - Expected: every quiz `question` object has `text` and `options` but **no `correctIndex`** field
     — the answer key is never sent to a learner (SR-051, SR-105, SYS-DATA-05).
2. With the **member** token, call the mutating endpoints directly (bypassing the UI):
   `POST /api/trainings`, `PUT /api/trainings/<id>`, `DELETE /api/trainings/<id>`,
   `PUT /api/trainings/reorder`.
   - Expected: every call returns **403** — members can neither create, edit, delete, nor reorder.
3. With the **trainer** token, attempt `PUT`/`DELETE` on a training **owned by someone else**, and
   `PUT /api/trainings/reorder`.
   - Expected: **403** for the non-owned training and **403** for reorder (admin-only); the trainer
     can still mutate their **own** trainings (200/204).
4. Call any training endpoint with **no** `Authorization` header.
   - Expected: **401** (`authenticate` runs before every route).
5. As a learner, submit `POST /api/sessions/grade` with a fabricated/extra score field.
   - Expected: the server recomputes the score from the stored `correctIndex` and ignores any
     client-supplied score; the client cannot influence pass/fail (SR-051, SR-104). (Grading detail
     belongs to the Sessions area; included here only to confirm answers stay server-side.)

---

## MT-TRN-07 — Trainings page: polish, layout, feedback, and accessibility (SR-090..SR-094, SYS-TRN-08, SYS-TRN-09)

Human visual / usability / accessibility judgement of the Trainings page (the expandable training
rows, the inline editor, the drag handle, and the create draft) — not mechanically testable.

**Preconditions:** Signed in as `admin@braingain.app`.

**Steps & expected:**

1. Inspect the Trainings list and open the inline editor (row click) and the **Add Training** draft.
   - Expected: a polished, professional layout using the pastel-blue palette (not purple) and the
     technical typography; category/duration/cycle pills are legible; the owner pill shows for admins
     (SR-090, SR-091, SR-092).
2. Resize the viewport from desktop (~1440px) down to a narrow mobile width (~375px).
   - Expected: rows, pills, and the editor remain readable and usable; no overlap, clipping, or
     horizontal scroll (SR-093).
3. Operate the page using **only the keyboard** (Tab/Shift-Tab to move, Enter/Space to activate the
   Add/Save/Cancel/Delete buttons, and to expand a row).
   - Expected: every interactive control is reachable, has a visible focus indicator and a sensible
     label, and can be operated without a mouse; icon-only controls (grip, trash) have accessible
     names/titles (SR-093). Note the drag handle is mouse-driven — keyboard reorder is not provided.
4. Save a training and trigger a deliberate failure (e.g. clear the Name and Save).
   - Expected: a success toast "Training created/updated" on success; a clear error toast
     ("Name is required" / "Could not save training") on failure; loading skeletons appear while the
     list is fetching (SR-094).
