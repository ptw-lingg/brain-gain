# Manual test procedures — UI / UX area

Manual verification for the **UI** system area (SYS-UI-01 .. SYS-UI-06), covering the parts that
are inherently visual, aesthetic, responsive, or accessibility-related and therefore cannot be
asserted mechanically. Items that *are* mechanically testable end-to-end (a success toast after a
save, navigation chrome presence, clicking through the nav) live in `frontend/e2e/ui.spec.ts`;
the UI area has no backend test surface (see `backend/tests/ui-noop.skip.md`).

## Traceability

| System req | Stakeholder req | Validation tests | Method |
|------------|-----------------|------------------|--------|
| SYS-UI-01  | SR-091 (pastel-blue palette) | VT-A03, VT-U08 | Manual / inspection |
| SYS-UI-02  | SR-092 (technical typography) | VT-U08 | Manual / inspection |
| SYS-UI-03  | SR-090 (polished UI + logo) | VT-U08 | Manual / inspection |
| SYS-UI-04  | SR-093 (responsive layout) | VT-A04 | Manual (E2E covers nav presence/navigation) |
| SYS-UI-05  | SR-093 (responsive + accessible) | VT-A01, VT-A02, VT-A04 | Manual |
| SYS-UI-06  | SR-094 (loading & feedback) | VT-U09 | Manual (E2E covers success toast) |

Implementation references (read these to keep the expected values current):
`frontend/src/style.css`, `frontend/tailwind.config.js`, `frontend/index.html`,
`frontend/src/components/BrainGainLogo.vue`, `frontend/src/components/AppLayout.vue`,
`frontend/src/components/AppSidebar.vue`, `frontend/src/stores/toast.ts`, `frontend/src/App.vue`.

**Preconditions for all procedures:** the app is running over HTTPS, the demo data is seeded, and
you can sign in as `admin@braingain.app` / `admin123`, `trainer@braingain.app` / `trainer123`, and
`user@braingain.app` / `user123`.

---

## SYS-UI-01 / SR-091 / VT-A03 — Pastel-blue palette (no purple/rose/peach)

The theme palette is defined in `frontend/tailwind.config.js`:
background `#F0F6FF`, sidebar `#E0EDFF`, accent `#2B78E4`, and the `pastel` family
(blue `#B8D8FF`, cyan `#B8F0F8`, mint `#B8F0E0`, steel `#C8DAEE`, sky `#D0EEFF`, slate `#D8E8F8`).

**Steps**
1. Sign in as admin and visit the dashboard, trainings, trainees, roles, users, and settings pages.
2. With browser dev tools (or a colour picker), sample the page background, sidebar, primary
   buttons (`.btn-primary`), nav active state, cards, and status pills.
3. Confirm hues are blue/cyan/mint/steel/sky/slate — **no purple, rose/pink, or peach** as a
   primary or accent colour. (Rose appears *only* on error states/toasts, which is acceptable.)

**Expected** — All chrome uses the pastel-blue palette above; the accent is `#2B78E4`; there is no
purple/rose/peach as a theme colour.

**VT-A03 colour-contrast check:** with an axe/Lighthouse/contrast tool, measure text and essential
UI contrast across cards, status pills, the sidebar nav, and form inputs. **Pass:** normal text
≥ 4.5:1 and large text / UI components ≥ 3:1 (WCAG 2.1 AA).

---

## SYS-UI-02 / SR-092 / VT-U08 — Technical typography pairing

`frontend/index.html` loads Google Fonts **Space Grotesk** and **DM Mono**;
`frontend/tailwind.config.js` maps `font-sans` → Space Grotesk and `font-mono` → DM Mono.

**Steps**
1. Sign in and open any page (e.g. Settings).
2. Inspect a heading / nav item / primary button — confirm the computed `font-family` resolves to
   **Space Grotesk**.
3. Inspect body copy, input fields, status badges, and the small metadata captions
   (e.g. the `// applies to every training at once` subtitle) — confirm they resolve to
   **DM Mono**.

**Expected** — Headings/nav/buttons use Space Grotesk; body/inputs/badges/metadata use DM Mono,
giving a technical, engineered feel.

---

## SYS-UI-03 / SR-090 / VT-U08 — Logo renders cleanly at multiple sizes

`frontend/src/components/BrainGainLogo.vue` is an SVG (stylized brain + upward arrow on a
pastel-blue gradient) with a `size` prop and an optional `showWordmark`.

**Steps**
1. Confirm the logo appears in the sidebar (it is rendered at `:size="40"` with the wordmark).
2. In a scratch view or Storybook-style harness, render the component at `size={32}`, `48`, `256`.
3. At each size confirm the brain/arrow strokes stay crisp (it is vector), the gradient runs from
   light `#D0EEFF` to accent `#2B78E4`, and nothing clips.

**Expected** — The logo is sharp and legible at 32 px, 48 px, and 256 px; the wordmark "BrainGain"
+ "Grow what you know." renders when `show-wordmark` is set.

**VT-U08 brand impression (optional, 5 users):** show the app for ~5 seconds and ask for first
impressions. **Pass metric:** ≥ 4/5 describe it as polished/professional and perceive the
pastel-blue, technical aesthetic and a recognisable logo.

---

## SYS-UI-04 + SYS-UI-05 / SR-093 / VT-A04 — Responsive layout at 375 px and 1440 px

`frontend/src/components/AppLayout.vue` is a fixed sidebar + scrollable `<main>` content shell.

> **Note:** the Playwright spec (`frontend/e2e/ui.spec.ts`) verifies the nav chrome is present and
> that clicking nav links navigates correctly at the default desktop viewport. Breakpoint behaviour
> below is verified manually because `playwright.config.ts` runs a single fixed viewport.

**Steps**
1. Sign in and open the dashboard.
2. Resize the browser (or use device emulation) to a **375 px** wide viewport.
3. Confirm: no horizontal scrollbar, no clipped/overlapping controls, all primary actions reachable,
   and the navigation remains usable (sidebar collapses/adapts rather than pushing content off-screen).
4. Resize to **1440 px** wide and confirm the layout uses the space sensibly (sidebar + centered
   content, max content width respected) with no stretched/blank regions.

**Expected** — The layout is usable at both 375 px and 1440 px with no horizontal scroll, clipping,
or obscured controls (WCAG 2.1 reflow; VT-A04 metric: no horizontal scroll or obscured controls at
375 px).

---

## SYS-UI-05 / SR-093 / VT-A01 — Full keyboard operability

**Steps**
1. From `/login`, complete sign-in using only the keyboard (Tab to the email field, type, Tab to
   password, type, Tab/Enter on the submit button).
2. On the dashboard, Tab through nav links and cards; activate a "Start" action with Enter/Space.
3. Complete a session flow (material → quiz → result) using only Tab/Shift+Tab/Enter/Space/arrows.
4. As admin, open Settings and operate the pass-threshold slider and Save button via keyboard.

**Expected** — Every interactive element is reachable and operable by keyboard, in a logical tab
order, with a **visible focus indicator** at all times (WCAG 2.1 AA 2.1.1 keyboard, 2.4.7 focus
visible). No keyboard trap.

---

## SYS-UI-05 / SR-093 / VT-A02 — Accessible names, roles, and labels

**Steps**
1. Run an automated a11y scan (axe-core / Lighthouse) on `/login`, `/dashboard`, a `/session/:id`,
   and `/settings`.
2. With a screen reader or the accessibility inspector, confirm: every form field has an associated
   label; every icon-only control (e.g. the sidebar log-out button, the toast dismiss "X") has an
   accessible name; the logo SVG exposes its `aria-label="BrainGain logo"` / `role="img"`.

**Expected** — No missing-name/label violations reported by axe; all inputs are labelled and
icon-only controls have accessible names.

---

## SYS-UI-06 / SR-094 / VT-U09 — Loading states & operation feedback

The toast store is `frontend/src/stores/toast.ts` (`success`/`error`, auto-dismiss after 3.2 s);
`frontend/src/App.vue` is the global toast host. Each data fetch shows a loading/skeleton state
(e.g. SettingsPage shows `card h-40 animate-pulse` while loading).

> **Note:** the success-toast-after-save case is asserted in `frontend/e2e/ui.spec.ts`
> (`SYS-UI-06 / VT-U09 / SR-094`). The loading/skeleton and *error* feedback below are manual
> because they need a throttled/failing network to observe reliably.

**Steps**
1. Open browser dev tools and throttle the network to "Slow 3G" (or set offline for the error case).
2. As admin, navigate to **Settings** and observe the loading skeleton before the form appears.
3. Adjust the pass threshold and click **Save changes**; observe a **success** toast
   ("Pass threshold updated for all trainings") appears within ~1 s and auto-dismisses.
4. Set the network **offline**, click **Save changes** again, and observe an **error** toast
   ("Could not save settings").

**Expected** — Loading/skeleton states appear during fetches; successful actions show a success
toast and failures show a clear error toast (VT-U09 metric: all observed actions give visible
feedback within ~1 s).
