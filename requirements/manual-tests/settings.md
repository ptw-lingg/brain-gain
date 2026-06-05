# Manual test procedures — Settings (SYS area: SET)

Manual / exploratory procedures for things the automated backend tests
(`backend/tests/settings.test.mjs`) and the Playwright e2e spec
(`frontend/e2e/settings.spec.ts`) cannot mechanically cover. Everything observable
over the API is asserted in the backend test; the admin-edits-the-threshold UI flow
is in the e2e spec. The procedures below require a real Entra tenant, a quiz run, or
human visual judgement.

System requirements in scope: **SYS-SET-01**, **SYS-SET-02**, **SYS-SET-03**.
Stakeholder requirements: **SR-080** (global pass threshold), **SR-008** (configure SSO
in-app), **SR-081** (manage SSO from the same Settings area).

Coverage split:

| Requirement | Backend test | E2e spec | Manual (this doc) |
|---|---|---|---|
| SYS-SET-01 GET /settings (auth read; defaults) | yes | partial (admin access) | — |
| SYS-SET-02 PUT /settings (admin merge/clamp/sanitize) | yes | partial (threshold) | — |
| SYS-SET-03 Settings page cards (threshold + SSO + TLS) | round-trip | threshold + card presence | SSO card live behavior; visual/UX |
| SR-080 global threshold applies to grading | partial | threshold persists | **MT-SET-01** (grading effect) |
| SR-008 / SR-081 configure SSO in-app | sanitization | card present | **MT-SET-02** (real tenant sign-in) |

---

## MT-SET-01 — Global pass threshold actually decides pass/fail (SR-080, VT-080)

Validates that the single global threshold set on Settings is the value the grader
compares every quiz score against. The persistence/clamp of the value itself is covered
by the backend test and e2e spec; this procedure exercises the end-to-end grading effect,
which requires taking a quiz.

**Preconditions:** Signed in as `admin@braingain.app`. The seeded member
`user@braingain.app` holds the "Lab Technician" role requiring "Laboratory Safety Basics"
(3 questions) and "Quality Management Intro" (2 questions).

**Steps & expected:**

1. On **Settings**, drag the **Global pass threshold** slider to **80%** and click **Save changes**.
   - Expected: toast "Pass threshold updated for all trainings".
2. Sign in as the member and start "Laboratory Safety Basics". Answer so that exactly 2 of
   3 questions are correct (≈67%, below 80%) and submit.
   - Expected: result screen shows **fail**; the training stays due/overdue (no passing
     session recorded).
3. Retry the same quiz and answer all 3 correctly (100%, at/above 80%) and submit.
   - Expected: result screen shows **pass**; the training becomes up-to-date.
4. As admin, lower the threshold to **50%** on Settings and save. Repeat step 2 (2/3 ≈ 67%).
   - Expected: the same 2/3 answers now **pass** — confirming the single global threshold,
     not a per-training value, governs grading for every training.

---

## MT-SET-02 — Configure Microsoft Entra ID SSO in-app and sign in (SR-008, SR-081, VT-008)

The merge/coercion/domain-sanitization of the SSO config is asserted in the backend test,
and the presence of the SSO card is asserted in the e2e spec. This procedure validates the
parts that need a real Microsoft tenant and the live login-page behavior, which cannot be
automated here.

**Preconditions:** Signed in as `admin@braingain.app`. A single-tenant Azure app
registration exists with a **Single-page application** redirect URI matching the value shown
in the SSO card hint (the app origin). An allowed-domain Microsoft work account is available.

**Steps & expected:**

1. On **Settings → Microsoft Entra ID (SSO)** card, enter the Directory (tenant) ID, the
   Application (client) ID, and one or more **Allowed email domains** (comma-separated), toggle
   **Enabled**, and click **Save SSO settings**.
   - Expected: toast "Microsoft SSO settings saved". The card hint shows the SPA redirect URI
     to register in Azure.
2. Reload Settings.
   - Expected: the tenant id, client id, allowed domains, and the Enabled toggle all return to
     the saved values (the page re-fetches `GET /settings`).
3. Confirm the **Global pass threshold** value is unchanged from before step 1.
   - Expected: threshold is unaffected — saving SSO and the threshold are independent
     (this independence is also asserted in the backend test; verify it visually here).
4. Open `/login` in a fresh session.
   - Expected: a **Sign in with Microsoft** button is now shown (it is hidden when SSO is disabled).
5. Click the Microsoft button and complete the popup with an allowed-domain work account; then,
   separately, sign in with a demo password account.
   - Expected: both SSO and password login succeed and land on the dashboard — password login
     remains available alongside SSO.
6. Return to Settings, toggle **Enabled** off, save, and reload `/login`.
   - Expected: the Microsoft button disappears; the app behaves as a password-only app.

---

## MT-SET-03 — Settings page polish, layout, and accessibility (SR-090..SR-093, SYS-SET-03)

Human visual / usability / accessibility judgement of the Settings page — not mechanically
testable.

**Preconditions:** Signed in as `admin@braingain.app` on **Settings**.

**Steps & expected:**

1. Inspect the three cards (Global pass threshold, Microsoft Entra ID SSO, HTTPS/TLS certificate).
   - Expected: a polished, professional layout using the pastel-blue palette (not purple) and the
     technical typography; each card has its own clearly labelled save action.
2. Resize the viewport from desktop to a narrow mobile width.
   - Expected: the cards remain readable and usable; no overlap or clipped controls.
3. Navigate the threshold slider and the SSO inputs/toggle using only the keyboard (Tab/arrow keys);
   trigger each save with Enter/Space.
   - Expected: every control is reachable, has a visible focus indicator and a sensible label, and
     can be operated without a mouse.
4. Adjust the slider and save while watching for feedback.
   - Expected: a clear loading/disabled state on the button while saving and a success/error toast
     on completion (SR-094).
