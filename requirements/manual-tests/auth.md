# Manual test procedures — Authentication & Authorization area

Manual / inspection verification for the **AUTH** (SYS-AUTH-01..07) and **AC** (SYS-AC-01..06)
system areas, covering the parts that cannot be asserted mechanically by the automated suites — the
documented permission matrix (code inspection), the absence of a public registration endpoint, and
the SSO-only passwordless branch that needs a live tenant or source inspection to exercise.

Items that **are** mechanically testable live in:

- `backend/tests/auth.test.mjs` — password login (400/401/case-insensitive), `GET /api/auth/me`,
  the middleware guards (`authenticate` 401, `requireAdmin`/`requireTrainerOrAdmin`/`requireAdminOrOwner`
  403) enforced on representative endpoints, `SafeUser` secret-stripping, and SSO graceful-off.
- `frontend/e2e/access-control.spec.ts` — trainer-level navigation (Trainings/Trainees but not
  Job Roles/Users/Settings) and the member/trainer route bounces off admin-only routes.
- `frontend/e2e/auth.spec.ts` — admin login + dashboard landing, the admin/member sidebar, the
  member bounce off `/users`, invalid-credential rejection, and session persistence.
- `backend/tests/impersonation.test.mjs` + `frontend/e2e/auth.spec.ts` — impersonation
  (SYS-AC-07/08/09, VT-011/VT-012). **Not duplicated here.**

## Traceability

| System req  | Stakeholder req                  | Validation tests | Method               | Covered by                          |
|-------------|----------------------------------|------------------|----------------------|-------------------------------------|
| SYS-AUTH-01 | SR-001, SR-002                   | VT-001           | Automated (backend)  | `auth.test.mjs`                     |
| SYS-AUTH-04 | SR-005                           | VT-005           | Automated (backend)  | `auth.test.mjs`                     |
| SYS-AUTH-06 | SR-001                           | VT-002           | **Manual / inspection** | this doc (§1)                    |
| SYS-AUTH-07 | SR-009, SR-010                   | VT-001, VT-006   | **Manual / inspection** (passwordless branch) + automated (401 path) | this doc (§2) + `auth.test.mjs` |
| SYS-AC-01   | SR-003, SR-004, SR-045           | VT-003, VT-104   | Automated (backend)  | `auth.test.mjs`                     |
| SYS-AC-02   | SR-003                           | VT-003, VT-104   | Automated (backend)  | `auth.test.mjs`                     |
| SYS-AC-03   | SR-045, SR-046                   | VT-003, VT-045   | Automated (backend)  | `auth.test.mjs`                     |
| SYS-AC-04   | SR-003, SR-004                   | VT-003, VT-004   | Automated (e2e)      | `access-control.spec.ts`, `auth.spec.ts` |
| SYS-AC-05   | SR-003, SR-004                   | VT-004           | Automated (e2e)      | `access-control.spec.ts`, `auth.spec.ts` |
| SYS-AC-06   | SR-003, SR-004                   | VT-003, VT-004, VT-104 | **Manual / inspection** | this doc (§3)               |

Implementation references (read these to keep the expected values current):
`backend/src/middleware/auth.ts`, `backend/src/routes/auth.ts`, `backend/src/routes/users.ts`,
`backend/src/routes/roles.ts`, `backend/src/routes/settings.ts`, `backend/src/routes/trainings.ts`,
`backend/src/seed.ts`, `frontend/src/router/index.ts`, `frontend/src/components/AppSidebar.vue`,
and the spec section **brain-gain.md → "Admin Guard — Three Layers of Enforcement"**.

**Preconditions for all procedures:** the app is running over HTTPS, the demo data is seeded, and
you can sign in as `admin@braingain.app` / `admin123`, `trainer@braingain.app` / `trainer123`, and
`user@braingain.app` / `user123`.

---

## §1 — SYS-AUTH-06 / SR-001 / VT-002 — No public self-registration

`backend/src/routes/auth.ts` exposes only `POST /login`, `GET /me`, `POST /impersonate/:userId`,
`GET /sso/config`, and `POST /sso/entra` — there is **no** register / sign-up route. New accounts are
created only by an admin through `POST /api/users` (`backend/src/routes/users.ts`, which is itself
behind `authenticate, requireAdmin`).

**Steps**

1. Inspect `backend/src/routes/auth.ts` and confirm no `register` / `signup` route exists.
2. Inspect `backend/src/index.ts` route mounts — confirm no public account-creation router.
3. In the UI, open `/login` and confirm there is no "Create account" / "Register" / "Sign up" link
   or form — only email + password fields, a submit button, and (when SSO is enabled) the Microsoft
   button.
4. As an unauthenticated client, probe a guessed registration endpoint
   (e.g. `POST /api/auth/register`, `POST /api/register`) and confirm it does not exist (404), and
   that `POST /api/users` without an admin token returns **401** (no token) — never creates a user.

**Expected** — There is no public registration endpoint or sign-up form anywhere; only an
authenticated admin can create users.

---

## §2 — SYS-AUTH-07 / SR-009, SR-010 / VT-001 — SSO-only (passwordless) users cannot password-login

In `backend/src/routes/auth.ts` the login guard is
`if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash)))` → 401.
A user provisioned via SSO (`POST /api/auth/sso/entra`) is created **without** a `passwordHash`
(see the auto-provision branch: the new `User` object has no `passwordHash` field). Therefore an
SSO-only account can never satisfy the password-login path.

> **Why manual/inspection:** an SSO-only user can only be created by completing the Entra SSO flow
> (a live tenant) or by editing the JSON store directly — the admin `POST /api/users` endpoint
> always hashes a password, so this exact account shape cannot be produced through the public API.
> The automated suite proves the *observable* 401 outcome (unknown email and wrong password both →
> 401, with no user enumeration in the message) in `auth.test.mjs`.

**Steps (choose A — live tenant — or B — store inspection)**

**A. With a configured Entra tenant**
1. As admin, configure & enable SSO in Settings (tenant id, client id, an allowed domain).
2. Sign in via "Sign in with Microsoft" using a brand-new allowed-domain account → a member is
   auto-provisioned.
3. Sign out. On `/login`, enter that user's email with **any** password and submit.
4. **Expected** — login is rejected with "Invalid email or password" (HTTP 401); the user can only
   return via the Microsoft button. Verifies SR-010 (password login coexists) without weakening
   SR-009 (SSO-provisioned accounts have no password).

**B. By store inspection (no tenant required)**
1. Stop the backend. In the data dir's `users.json`, confirm any SSO-provisioned user object has an
   `entraOid` and **no** `passwordHash` key.
2. Restart and attempt `POST /api/auth/login` with that email and any password via curl/Postman.
3. **Expected** — HTTP 401; no token is issued.

---

## §3 — SYS-AC-06 / SR-003, SR-004 — Documented API permission matrix (inspection)

SYS-AC-06 requires the system to conform to the documented API permission matrix for every
role/endpoint pair (spec: **brain-gain.md → "Admin Guard — Three Layers of Enforcement"**). Each
representative cell is exercised automatically; this inspection confirms the **complete** matrix
matches the route guards in source and that no endpoint is missing a guard.

**Matrix as enforced in source** (verify each row against the cited file):

| Endpoint                              | Guard (source)                              | Member | Trainer            | Admin | File |
|---------------------------------------|---------------------------------------------|--------|--------------------|-------|------|
| `POST /api/auth/login`                | public                                      | ✅     | ✅                 | ✅    | `routes/auth.ts` |
| `GET  /api/auth/me`                   | `authenticate`                              | ✅     | ✅                 | ✅    | `routes/auth.ts` |
| `GET  /api/auth/sso/config`           | public                                      | ✅     | ✅                 | ✅    | `routes/auth.ts` |
| `POST /api/auth/impersonate/:userId`  | `authenticate, requireAdmin` (+nesting/self guards) | ❌ 403 | ❌ 403       | ✅    | `routes/auth.ts` |
| `GET  /api/users` (+ `/:id`)          | `authenticate, requireAdmin`                | ❌ 403 | ❌ 403             | ✅    | `routes/users.ts` |
| `POST/PUT/DELETE /api/users`          | `authenticate, requireAdmin`                | ❌ 403 | ❌ 403             | ✅    | `routes/users.ts` |
| `GET  /api/roles`                     | `authenticate`                              | ✅     | ✅                 | ✅    | `routes/roles.ts` |
| `POST/PUT/DELETE /api/roles`          | `authenticate, requireAdmin`                | ❌ 403 | ❌ 403             | ✅    | `routes/roles.ts` |
| `GET  /api/settings`                  | `authenticate`                              | ✅     | ✅                 | ✅    | `routes/settings.ts` |
| `PUT  /api/settings`                  | `authenticate, requireAdmin`                | ❌ 403 | ❌ 403             | ✅    | `routes/settings.ts` |
| `GET/POST /api/settings/certificate`  | `authenticate, requireAdmin`                | ❌ 403 | ❌ 403             | ✅    | `routes/settings.ts` |
| `GET  /api/trainings` (+ `/:id`, `/mine`) | `authenticate`                          | ✅     | ✅                 | ✅    | `routes/trainings.ts` |
| `GET  /api/trainings/trainees`        | `requireTrainerOrAdmin`                     | ❌ 403 | ✅ (own)           | ✅ (all) | `routes/trainings.ts` |
| `POST /api/trainings`                 | `requireTrainerOrAdmin`                     | ❌ 403 | ✅                 | ✅    | `routes/trainings.ts` |
| `PUT/DELETE /api/trainings/:id`       | `requireAdminOrOwner`                       | ❌ 403 | ✅ own / ❌ 403 others | ✅ | `routes/trainings.ts` |
| `PUT  /api/trainings/reorder`         | `requireAdmin`                              | ❌ 403 | ❌ 403             | ✅    | `routes/trainings.ts` |

**Steps**

1. For each row, open the cited route file and confirm the router/handler is wrapped by exactly the
   guard listed (note `router.use(authenticate, requireAdmin)` at the top of `users.ts` covers every
   users route; `roles.ts`/`settings.ts` annotate per-route; `trainings.ts` does
   `router.use(authenticate)` then per-route role guards).
2. Confirm `requireAdminOrOwner` (`middleware/auth.ts`) lets admins through unconditionally and
   otherwise allows only the trainer whose `id === training.ownerId`.
3. Confirm `PUT /api/trainings/reorder` is registered **before** `PUT /api/trainings/:id` so
   `reorder` is not captured as an `:id`.
4. Confirm the frontend router meta (`frontend/src/router/index.ts`) and sidebar gating
   (`frontend/src/components/AppSidebar.vue`) mirror the matrix (defense-in-depth) — the server
   guards above remain the authoritative control (SR-003: "enforced reliably, not merely hidden").
5. Cross-check that no `/api` mutation route lacks a guard (a missing guard would be a matrix
   violation).

**Expected** — Every endpoint/role cell behaves exactly as the matrix states; server-side guards
match the documented matrix with no ungated mutation endpoint. The representative cells (member &
trainer 403s, admin/owner allows) are confirmed green in `backend/tests/auth.test.mjs`; the e2e UI
bounce/sidebar gating in `frontend/e2e/access-control.spec.ts` and `auth.spec.ts`.
