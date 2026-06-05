# Manual Tests — Microsoft Entra ID SSO

Covers the SSO requirements that **cannot be exercised by automated tests** because they require a
real Microsoft Entra ID (Azure AD) identity provider issuing ID tokens signed against its published
JWKS. The automated/E2E coverage of the parts that do not need a live IdP lives in:

- `backend/tests/sso.test.mjs` — SYS-SSO-02, SYS-SSO-03 (503/400 guards), SYS-SSO-08 (graceful-off).
- `frontend/e2e/sso.spec.ts` — SYS-SSO-02 (button hidden while disabled).

Requirements documented as manual here:

| System req | Stakeholder | Validation test | What it covers |
| --- | --- | --- | --- |
| SYS-SSO-01 | SR-006 | VT-006 | MSAL popup obtains an Entra ID token |
| SYS-SSO-04 | SR-104, SR-006 | (VT-006/VT-009 path) | Server-side ID-token validation (RS256 / aud / iss / tid / exp / JWKS) |
| SYS-SSO-05 | SR-009 | (VT-009 path) | Claim extraction (oid / email / preferred_username fallback / name) |
| SYS-SSO-06 | SR-009 | VT-009 | Link / auto-provision / 409 / 403 resolution |
| SYS-SSO-07 | SR-006, SR-010 | VT-006 | Issues the same app JWT as password login |
| SYS-SSO-08 | SR-007, SR-008, SR-105 | VT-007/VT-008 | No client secret; admin-editable; graceful off |
| SYS-SSO-09 | SR-006 | — | Azure SPA single-tenant registration assumptions |

---

## Preconditions (one-time setup)

1. **Azure app registration** (SYS-SSO-09 / SR-006): in Entra ID register a **Single-Page
   Application** (SPA), **single-tenant**. Add a redirect URI equal to the app origin shown by the
   Settings page's "redirect URI" hint (e.g. `https://localhost:5173`). Grant delegated permissions
   `openid`, `profile`, `email`. Note the **Tenant ID** and **Application (client) ID**. No client
   secret is created or used (SYS-SSO-08 / SR-105).
2. Sign in to BrainGain as an administrator.
3. On **Settings → Microsoft Entra ID SSO**: enter the tenant id and client id, set **Allowed
   domains** (e.g. `yourcompany.com`), toggle **Enabled**, and **Save** (SR-008 / SYS-SET-02/03).
   Confirm the global **pass threshold** is unchanged after saving (SSO and threshold save
   independently — VT-008).

---

## MT-SSO-01 — MSAL popup obtains an Entra ID token (SYS-SSO-01 / SR-006 / VT-006)

**Steps**
1. With SSO enabled, open `/login` in Microsoft Edge.
2. Confirm a **"Sign in with Microsoft"** button now appears below the password form.
3. Click it. A Microsoft sign-in popup opens (`@azure/msal-browser` `loginPopup`, scopes
   `openid profile email`).
4. Complete sign-in with an allowed-domain Entra work account.

**Expected**
- The popup completes and returns an **ID token** to the SPA (no secret is requested of the user).
- The browser then calls `POST /api/auth/sso/entra` with that `idToken`.
- Cancelling/closing the popup is treated as a non-error (no red error message; you remain on
  `/login`).

---

## MT-SSO-02 — Server-side ID-token validation (SYS-SSO-04 / SR-104 / VT-006)

The browser never grades its own sign-in; the backend re-validates the token. Verify by both happy
path and tampering.

**Steps**
1. Complete a real SSO sign-in (MT-SSO-01) — the token validates and you land on `/dashboard`.
2. Capture the `idToken` the SPA sends to `POST /api/auth/sso/entra` (browser dev-tools → Network).
   Replay it with a tool (curl/Postman) **after editing one character of the signature**.
3. Replay an **expired** token (re-use a captured token after its `exp`, beyond the 300s clock
   tolerance).
4. (Optional, requires a second app registration) Replay a token whose `aud` is a **different
   client id**, or whose `tid` is a **different tenant**.

**Expected**
- Valid, unexpired, correctly-audienced token from the configured tenant → `200` with
  `{ token, user }`.
- Tampered signature, wrong `aud`, wrong `iss`, wrong `tid`, expired (past tolerance), or a non-RS256
  / `alg:none` token → **`401`** with `"Could not verify your Microsoft sign-in"`; **no app token is
  issued**. (Algorithm pinning to `RS256` defends against algorithm-confusion attacks.)

---

## MT-SSO-03 — Claim extraction & required claims (SYS-SSO-05 / SR-009)

**Steps**
1. Sign in via SSO with an account that has both a `name` and an `email` claim — observe the created
   user's name/email.
2. Sign in with an account whose token exposes `preferred_username` but not `email` (e.g. a guest or
   a tenant configured to omit `email`).
3. (Edge case, may require a crafted/test token) A token missing `oid`, or missing both `email` and
   `preferred_username`.

**Expected**
- `email` is taken from `email`, falling back to `preferred_username`; `name` falls back to the email
  when absent.
- A token missing `oid`, or missing any email, is **rejected** (no sign-in, `401`).

---

## MT-SSO-04 — Domain-restricted provisioning & account linking (SYS-SSO-06 / SR-009 / VT-009)

The core security behaviour. Run all four branches.

**Preconditions**: SSO enabled; `allowedDomains` set (e.g. `yourcompany.com`); an existing local
BrainGain user whose email matches one SSO account (e.g. created in advance via the Users page with a
role assigned).

**Steps & Expected**

1. **Link to an existing user (no role changes).** Sign in via SSO with an email that **matches an
   existing local user**.
   - Expected: sign-in succeeds; the Entra account is **linked** (`entraOid` set) to that user; their
     existing **roles, isAdmin, and isTrainer are unchanged**. After this, that user can sign in via
     either SSO or their original password.

2. **Auto-provision a new allowed-domain user.** Sign in via SSO with a **new** email whose domain
   **is** in `allowedDomains` and which matches no existing user.
   - Expected: a **new member-level account is created automatically** (`isAdmin=false`,
     `isTrainer=false`, no roles, no `passwordHash`) and you land on `/dashboard` with a friendly
     empty state (no assigned trainings yet).

3. **Refuse a disallowed domain.** Sign in via SSO with an email whose domain is **not** in
   `allowedDomains` and which matches no existing user.
   - Expected: **`403`** ("Your account is not permitted to sign in"); **no account is created**; you
     stay on `/login` with an error.

4. **Re-link takeover guard.** With an existing user already linked to one Entra `oid`, attempt SSO
   with a token that has the **same email but a different `oid`**.
   - Expected: **`409`** ("This account is linked to a different Microsoft user"); the link is **not**
     overwritten.

5. **SSO-only user cannot password-login** (cross-check SYS-AUTH-07). Take the user auto-created in
   step 2 and attempt `POST /api/auth/login` with any password.
   - Expected: **`401`** — an SSO-only user (no `passwordHash`) cannot sign in with a password.

---

## MT-SSO-05 — SSO issues the same app session as password login (SYS-SSO-07 / SR-006, SR-010 / VT-006)

**Steps**
1. Sign in via SSO and inspect the issued app JWT (dev-tools / `localStorage` token).
2. Separately, sign in the same (or another) account via the password form.
3. Reload the page after each.

**Expected**
- Both paths land on `/dashboard` and return `{ token, user }` of the **same shape**; downstream
  behaviour (`GET /api/auth/me`, role-gated nav, session persistence across reload) is identical
  regardless of how the user signed in. Password and SSO login coexist (SR-010).

---

## MT-SSO-06 — No client secret; configuration is admin-editable & safe (SYS-SSO-08 / SR-007, SR-008, SR-105)

> Automated coverage: the **off** state is asserted in `backend/tests/sso.test.mjs` and
> `frontend/e2e/sso.spec.ts`. This manual check confirms the **no-secret** design and that config is
> purely admin-editable.

**Steps**
1. Review the Settings → SSO card and the configuration round-trip: it accepts only **tenant id,
   client id, allowed domains, and an enable toggle** — there is **no client-secret field**.
2. Inspect `GET /api/auth/sso/config` while enabled — it returns only `enabled`, `clientId`, and
   `authority` (all non-secret, browser-needed values).
3. Toggle SSO **off** in Settings and reload `/login`.

**Expected**
- No client secret is ever entered or stored; SSO operates on **ID tokens only**.
- Configuration can be changed entirely in-app by an admin with no code or environment changes
  (SR-008), and saving it does not require a restart.
- With SSO off, the Microsoft button disappears and the app is password-only (validated automatically;
  see SYS-SSO-02/03/08).

---

## MT-SSO-07 — Azure SPA registration assumptions (SYS-SSO-09 / SR-006)

**Steps**
1. Inspect the Settings SSO card's **redirect-URI hint** and confirm it equals the app origin
   (`window.location.origin`).
2. In the Azure app registration, confirm the redirect URI is registered under the **SPA** platform
   (not Web), the registration is **single-tenant**, and the delegated permissions are
   `openid`/`profile`/`email`.

**Expected**
- The redirect URI shown by BrainGain matches what is registered in Azure; with the SPA single-tenant
  registration in place, MT-SSO-01..05 succeed. A mismatched/Web-platform redirect URI causes the
  MSAL popup to fail at Microsoft (a useful negative check).
