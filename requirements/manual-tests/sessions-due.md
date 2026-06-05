# Manual test procedures — Sessions & Due status (SYS areas: SES, DUE)

Manual / exploratory procedures for the parts of the training-session flow and the
due-status lifecycle that the automated backend tests
(`backend/tests/sessions-due.test.mjs`) and the Playwright e2e spec
(`frontend/e2e/sessions-due.spec.ts`) cannot mechanically cover. Everything observable
over the API — server-side grading, passes-only persistence, unlimited retries, and the
never / up-to-date / due / overdue computation — is asserted in the backend test; the
visible material → quiz → result flow, the dashboard status surface, and the retry
affordance are covered in the e2e spec. The procedures below need human visual judgement,
a real document link, or the passage of real calendar time at the window boundaries.

System requirements in scope: **SYS-SES-01** (session flow page), **SYS-SES-02**
(POST /grade server-side), **SYS-SES-03** (unlimited retries), **SYS-SES-04**
(GET /sessions/mine), **SYS-DUE-01** (computeDue), **SYS-DUE-02** (GET /trainings/mine).
Stakeholder requirements: **SR-050** (material → quiz → result), **SR-051** (server-side
grading; answers hidden), **SR-052** (unlimited retries; record only passes), **SR-053**
(computed due status), with the derivation/ordering side of **SR-032** / **SR-060** /
**SR-047**.

Coverage split:

| Requirement | Backend test | E2e spec | Manual (this doc) |
|---|---|---|---|
| SYS-SES-01 / SR-050 session flow (material→quiz→result) | — | yes (VT-050) | visual polish, real material link (**MT-SES-01**) |
| SYS-SES-02 / SR-051 server-side grading; answers hidden (VT-051) | yes (score honest, correctIndex stripped, fabricated score ignored, 400/404/401) | partial (result screen) | — |
| SYS-SES-02 / SYS-SES-03 / SR-052 only passes persist; unlimited retries (VT-052) | yes | partial (retry affordance) | full lifecycle vs. global threshold (**MT-SES-02**) |
| SYS-SES-04 / SR-053 GET /sessions/mine returns own passes | yes | — | — |
| SYS-DUE-01 / SR-053 never/up-to-date/due/overdue (VT-053) | yes (never, up-to-date via API; due/overdue via back-dated pass) | — | due/overdue over real time at the boundaries (**MT-DUE-01**) |
| SYS-DUE-02 / SR-032/060/047 required, deduped, ordered (VT-060) | yes | yes (dashboard cards + Start) | dedup across two roles sharing a training (**MT-DUE-02**) |

---

## MT-SES-01 — Session flow look, feel, and real material link (SR-050, SYS-SES-01, VT-050)

The three-step flow and a pass/fail result screen are exercised mechanically in the e2e spec.
This procedure covers the parts needing human judgement: visual polish, the step indicator,
and that a real learning-material link actually opens its document in a new tab (VT-041 touches
the same control; here we confirm it within the session flow).

**Preconditions:** Signed in as the seeded member `user@braingain.app`. The seeded
"Laboratory Safety Basics" training carries two OneDrive material links and a 3-question quiz.

**Steps & expected:**

1. From **My Trainings** (dashboard), click **Start** on "Laboratory Safety Basics".
   - Expected: route is `/session/:trainingId`; the page header shows the training name and
     the indicator reads `// step 1 of 3`; the description and the material links are listed
     as cards.
2. Click a material link (e.g. "Lab Safety Handbook").
   - Expected: the linked document opens in a **new browser tab** (target=_blank, rel noopener);
     the session page is left untouched in the original tab.
3. Click **Start test →**.
   - Expected: the indicator advances to `// step 2 of 3`; each question shows its options as
     selectable radio rows. No option is visually marked as correct (the answer key is hidden).
4. Try to submit with at least one question unanswered.
   - Expected: the **Submit test** button is disabled until every question has a selection.
5. Answer all questions and submit; observe the grading button state.
   - Expected: the button shows a "Grading…" / spinner state while the request is in flight,
     then the indicator advances to `// step 3 of 3` and a result card appears showing the
     score, the correct/total count, and the required pass percentage.
6. Inspect the result card and the page generally for polish and accessibility.
   - Expected: pastel-blue theme (mint tint on pass, rose tint on fail), technical typography,
     a visible focus ring on the radios/buttons, and full keyboard operability of the whole flow
     (SR-090..SR-093). A "Back to My Trainings" action returns to the dashboard.

---

## MT-SES-02 — Unlimited retries and only-passes-recorded against the global threshold (SR-051, SR-052, VT-052)

The backend test proves, via the API, that a failing submission is not persisted, that the due
state is unchanged after failures, and that a later passing attempt is the only one recorded.
This procedure confirms the same end-to-end through the UI and ties it to the configurable
global pass threshold (SR-080), which requires actually taking the quiz.

**Preconditions:** Signed in as `admin@braingain.app` to set the threshold; the seeded member
`user@braingain.app` available in a second session. "Laboratory Safety Basics" has 3 questions
(pass needs ≥ 80% → all 3 correct); "Quality Management Intro" has 2 questions.

**Steps & expected:**

1. As admin, on **Settings**, confirm the **Global pass threshold** is **80%**.
   - Expected: threshold persisted (also asserted in the backend test).
2. As the member, start "Laboratory Safety Basics", advance to the quiz, answer **2 of 3**
   correctly (≈67%), and submit.
   - Expected: result shows **Not passed**, the score and threshold, a **Retry test** button,
     and the note "Failed attempts aren't recorded — this training stays due until you pass."
3. Click **Retry test** several times, failing each time.
   - Expected: each retry returns to the quiz (`// step 2 of 3`); retries are unlimited.
4. Return to the dashboard and confirm the training's status pill is unchanged (still due /
   never), then retry and answer **all 3** correctly and submit.
   - Expected: result shows **Passed**; back on the dashboard the status pill flips to
     **up-to-date**. Only this passing attempt is recorded (a trainer/admin viewing Trainees,
     and `GET /api/sessions/mine`, show exactly one passing session for this user/training).
5. As admin, lower the threshold to **50%** and save; as the member, take the quiz again with
   only **2 of 3** correct (≈67%).
   - Expected: the same 2/3 answers now **pass** — confirming the single global threshold,
     not a per-training value, governs grading (SR-080 / SR-051).

---

## MT-DUE-01 — Due / overdue transitions at the real window boundaries (SR-053, SYS-DUE-01, VT-053)

`computeDue()` is fully unit-exercised in the backend test for all four states (never,
up-to-date, due, overdue), including the `due` and `overdue` cases driven by back-dated
passing sessions written into the test data dir. This procedure validates the same boundaries
as they would be experienced by a real user over real calendar time — i.e. that the status pill
actually flips on the configured `cycleYears` / `windowBeforeMonths` / `windowAfterMonths`
without any manual intervention. It is inherently time-dependent and therefore manual.

**Preconditions:** A training with a short, known cycle and window (e.g. `cycleYears` 1,
`windowBeforeMonths` 2, `windowAfterMonths` 1, as on the seeded "Laboratory Safety Basics").
A passing session for the member. Ability to advance the effective "now" (either wait, or run
the backend on a machine whose clock is set to a date near a boundary — never alter persisted
session timestamps to fake a pass that did not happen).

**Steps & expected:**

1. Immediately after passing, view the dashboard / `GET /api/trainings/mine`.
   - Expected: status **up-to-date**; the displayed due date = lastPassed + cycleYears.
2. At a point inside `[dueDate − windowBeforeMonths, dueDate]` (e.g. ~1 month before the due date).
   - Expected: status flips to **due**; the dashboard pill and the Trainees view both reflect it.
3. At a point after `dueDate + windowAfterMonths` (past the grace period).
   - Expected: status flips to **overdue**.
4. Pass the training again while it is due/overdue.
   - Expected: status returns to **up-to-date** and the due date moves forward by one cycle
     (computed from the new last passing attempt).

---

## MT-DUE-02 — Required trainings are the deduplicated union across multiple roles (SR-032, SYS-DUE-02, VT-032/060)

The backend test and e2e spec confirm the member's two role-derived trainings appear once each,
in admin order, on `GET /api/trainings/mine` and the dashboard. This procedure adds the
multi-role de-duplication case (a single user holding two roles that share a training), which is
easiest to set up and judge through the UI.

**Preconditions:** Signed in as `admin@braingain.app`.

**Steps & expected:**

1. Create (or pick) two job roles, **Role A** and **Role B**, that both require the **same**
   training T (plus, for Role B, one additional unique training U).
2. Assign **both** roles to a single member.
3. Sign in as that member and open the dashboard (`GET /api/trainings/mine`).
   - Expected: training T appears **exactly once** (no duplicate card), training U appears once,
     and the list is the union of both roles' required trainings, presented in the
     admin-defined order (SR-047). Each card carries a due-status pill and a Start action.
4. As admin, reorder trainings on the **Trainings** page (drag-and-drop), then reopen the
   member dashboard.
   - Expected: the dashboard order matches the new admin order — the order is respected
     consistently across views.
