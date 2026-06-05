# Manual test procedures — Dashboard & Trainee Oversight (SYS areas: DSH, OVS)

Manual / exploratory procedures for things the automated backend tests
(`backend/tests/dashboard-oversight.test.mjs`) and the Playwright e2e spec
(`frontend/e2e/dashboard-oversight.spec.ts`) cannot mechanically cover. Everything
observable over the API (`GET /api/trainings/mine`, `GET /api/trainings/trainees`,
the server-computed due status, role-based access and the no-secret-leak guarantee) is
asserted in the backend test; the member-dashboard card render, the empty state, the
oversight grouping, the only-due filter and the copy-emails actions are covered in the
e2e spec. The procedures below need human visual/usability/accessibility judgement or a
multi-state due-status setup that is better exercised by hand.

System requirements in scope: **SYS-DSH-01** (Dashboard cards), **SYS-OVS-01**
(GET /trainees grouped — backend), **SYS-OVS-02** (Trainees page — filter + copy emails).
Stakeholder requirements: **SR-060** (dashboard of required trainings + status),
**SR-061** (friendly empty state), **SR-070** (who must take each training, grouped),
**SR-071** (filter due/overdue & copy emails), with **SR-047** (admin-defined order
respected everywhere).

Coverage split:

| Requirement | Backend test | E2e spec | Manual (this doc) |
|---|---|---|---|
| SYS-DSH-01 dashboard cards (SR-060) | `/mine` payload, order, fields, no answer key | 2 cards + due pill + Start (VT-060) | visual/UX polish (**MT-DSH-01**) |
| SYS-DSH-01 friendly empty state (SR-061) | empty `/mine` for no-role user (VT-061) | empty-state copy shown (VT-061) | — |
| SYS-OVS-01 GET /trainees grouped (SR-070, SR-047) | grouping, admin-all/trainer-owned, 403/401, ordered, SafeUser | — | — |
| SYS-OVS-02 Trainees page (SR-070) | — | groups + trainees listed (VT-070) | visual/UX (**MT-OVS-02**) |
| SYS-OVS-02 filter due & copy emails (SR-071) | (`ACTIONABLE` logic is server-status driven) | filter toggle + copy toast + clipboard (VT-071) | clipboard format & UX (**MT-OVS-01**) |
| Computed due status across all four states (SR-053 drives DSH/OVS) | never + up-to-date after a pass | — | full never/up-to-date/due/overdue sweep (**MT-OVS-03**) |

> Note on VT ids: VT-060/VT-061 validate the dashboard (SR-060/SR-061); VT-070/VT-071
> validate trainee oversight (SR-070/SR-071). The clipboard read-back is automated in the
> e2e spec where the headless browser allows it; the procedures below add the human-judgement
> and multi-state coverage on top.

---

## MT-DSH-01 — Dashboard card polish, status pills, responsiveness (SR-060, SR-093/SR-094, SYS-DSH-01)

Human visual / usability / accessibility judgement of the learner dashboard — the
look-and-feel and responsive grid are not mechanically testable. The card *contents* and
the empty state are already asserted in the e2e spec.

**Preconditions:** Signed in as the seeded member `user@braingain.app` / `user123`
(holds the "Lab Technician" role → "Laboratory Safety Basics" and "Quality Management Intro").

**Steps & expected:**

1. Open **My Trainings** (`/dashboard`).
   - Expected: a responsive card grid with one card per required training; each card shows
     the name, description, duration (e.g. "2h"), category, recurrence ("every Ny"), a
     **due-status pill** and a clear **Start** call to action (SR-060). The header summary
     reads "// N assigned · M due now".
2. Inspect the due-status pill colours against the status: never-taken / overdue render in a
   red/rose tint ("Due now" / "Overdue"); a freshly-passed training is mint/green ("Up to date");
   an in-window training is the accent blue ("Due now · by …").
   - Expected: the pill colour, label and the (greyed) Start affordance for up-to-date items
     read sensibly and match the design system (pastel blue, no purple).
3. Resize the viewport from a wide desktop (≈1440 px) down to mobile (≈375 px).
   - Expected: the grid reflows from multi-column to a single column; cards stay readable with
     no clipped text or overlapping controls (SR-093).
4. Tab through the page with the keyboard and activate a **Start** with Enter/Space.
   - Expected: every Start button is reachable, has a visible focus ring, and navigates to the
     training session (`/session/:id`); sensible labels/titles are present (SR-093).
5. While the dashboard is loading (throttle the network), watch the initial render.
   - Expected: skeleton/loading placeholders appear before the cards populate (SR-094).

---

## MT-OVS-01 — Copy-emails clipboard contents and reminder UX (SR-071, VT-071, SYS-OVS-02)

The copy action firing, the confirming toast and a basic clipboard read-back are automated
in the e2e spec. This procedure validates the exact recipient-list **format** and the
real-world reminder workflow, which is best confirmed by a human pasting into a mail client.

**Preconditions:** Signed in as `trainer@braingain.app` / `trainer123` (or `admin`) on the
**Trainees** page (`/trainees`). At least one trainee is due/overdue.

**Steps & expected:**

1. With **"Only show due / overdue"** checked, click a group's **Copy emails** button.
   - Expected: a success toast "Copied N emails — <training name>"; paste into a text editor and
     confirm the clipboard holds a **"; "-separated** list of exactly the addresses currently
     visible in that group (the actionable ones).
2. Uncheck the filter and click the same group's **Copy emails** again.
   - Expected: the copied list now includes every assigned trainee in the group (the filter
     decides who is copied).
3. Click **Copy all emails** in the header.
   - Expected: a toast confirming the total; the clipboard holds the **de-duplicated union** of
     the visible recipients across all groups (a person required by two trainings appears once).
4. Paste the copied list into the To/Bcc field of a real mail client.
   - Expected: the client parses it into distinct, valid recipients with no trailing separator —
     usable directly for a reminder email.
5. Click **Copy emails** on a group whose visible list is empty (e.g. filter on, nobody due).
   - Expected: an error toast "No matching recipients" and nothing is written to the clipboard.
6. (Environment) Try the copy action where the Clipboard API is unavailable (insecure context
   or denied permission).
   - Expected: a graceful error toast "Clipboard not available" rather than a crash.

---

## MT-OVS-02 — Trainees page grouping, collapse and filter UX (SR-070, SR-071, SR-047, SYS-OVS-02)

Visual / usability judgement of the oversight page layout and the collapsible groups. The
grouping data and the only-due filter behaviour are asserted in the backend test and e2e spec;
this adds the human interaction/ordering judgement.

**Preconditions:** Signed in as `admin@braingain.app` on **Trainees**.

**Steps & expected:**

1. Inspect the page: one collapsible card per training, each with a header showing the training
   name and an "N assigned · M due" count, a chevron, and a per-group **Copy emails** button.
   - Expected: groups are listed in the **admin-defined training order** — the same order seen on
     the Trainings admin list and the learner dashboard (SR-047). Reorder trainings on the
     Trainings page (drag-and-drop) and confirm the Trainees groups reorder to match.
2. Click a group header (the chevron/title).
   - Expected: the group collapses/expands; the chevron rotates; collapsed groups hide their
     trainee rows.
3. Toggle **"Only show due / overdue"** on and off.
   - Expected: with it on, only never/due/overdue trainees are listed and a group with nobody due
     shows "Nobody is currently due for this training."; with it off, all assigned trainees appear.
4. For each trainee row, inspect the status pill and the "due <date>" hint.
   - Expected: each person shows their server-computed due status with a sensible label/colour and,
     where applicable, a formatted due date.
5. Resize to mobile width and keyboard-navigate the group headers, the filter checkbox and the
   copy buttons.
   - Expected: responsive, keyboard-operable, visible focus, sensible labels (SR-093); a loading
     skeleton shows while the groups fetch (SR-094).

---

## MT-OVS-03 — Due-status sweep across all four states on dashboard & oversight (SR-053 → SR-060/SR-070)

The status computation is unit-true in the backend test for the **never** and **up-to-date**
states; producing a **due** and an **overdue** state requires manipulating session dates
(or waiting out a cycle/window), so it is verified by hand here. Both the learner dashboard and
the trainer/admin oversight read the same server-computed status, so they should agree.

**Preconditions:** `admin@braingain.app` to manage data; the seeded member `user@braingain.app`
with "Laboratory Safety Basics" (cycleYears 1, windowBefore 2 months, windowAfter 1 month).
To force the time-based states, edit `DATA_DIR/sessions.json` directly (or use the API at a
clock offset) to set the member's `completedAt` for that training to:
craft a recent pass (within cycle, before the window), a pass ≈ (cycle − windowBefore) ago
(window open), and a pass > (cycle + windowAfter) ago (past grace).

**Steps & expected:**

1. **Never:** with no passing session for the training, open the member dashboard and the trainer
   Trainees page.
   - Expected: both show the training as **never taken** — dashboard pill "Due now" (red), oversight
     status "never". (Also asserted automatically.)
2. **Up-to-date:** record a fresh pass (e.g. take/grade the quiz at 100%).
   - Expected: dashboard pill "Up to date · due <date>" (mint); oversight status "up-to-date" with
     the computed due date = lastPassed + cycleYears. (Also asserted automatically.)
3. **Due:** set `completedAt` so that *now* falls inside `[dueDate − windowBefore, dueDate + windowAfter]`.
   - Expected: dashboard pill "Due now · by <date>" (accent blue); oversight status "due"; the
     trainee appears under the default "only due/overdue" filter.
4. **Overdue:** set `completedAt` so that *now* is later than `dueDate + windowAfter`.
   - Expected: dashboard pill "Overdue" (red); oversight status "overdue"; still listed under the
     filter and included in the copy-emails recipients.
5. Cross-check: for the same user+training, the dashboard status and the oversight status always
   match.
   - Expected: identical status in both views — the status is computed once on the server
     (`computeDue`) and never trusted from the client (SR-104).
