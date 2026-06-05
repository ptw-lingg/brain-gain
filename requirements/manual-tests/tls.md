# Manual Tests — HTTPS / TLS Delivery

Covers the HTTPS/TLS requirements that **cannot be (fully) exercised by the standard automated
harness** — either because they need a fresh on-disk filesystem state (first-run bootstrap), a raw
HTTP listener / redirect inspection, the Vite dev server, a real browser's HSTS enforcement, or a
hands-on human usability task. The automated/E2E coverage of the API- and UI-observable parts lives
in:

- `backend/tests/tls.test.mjs` — SYS-TLS-01 (HTTPS origin / health), SYS-TLS-04 + VT-115 (metadata
  only, no key/PEM ever returned), SYS-TLS-05 + VT-113/VT-114 (upload validates, hot-swaps, rejects
  missing / malformed / **mismatched** key+cert with 400, active cert unchanged), SYS-TLS-06
  (certificate endpoints admin-only: 401/403), SYS-TLS-09 (HSTS header present on responses).
- `frontend/e2e/tls.spec.ts` — SYS-TLS-07 (Settings TLS card shows the active-certificate metadata;
  cert/key/chain pickers, Install / Regenerate controls, key-never-leaves-server note).

Requirements documented as manual here:

| System req | Stakeholder | Validation test | What it covers (and why manual) |
| --- | --- | --- | --- |
| SYS-TLS-01 | SR-110 | VT-110 | The SPA (`/`) served over HTTPS from the same origin (needs a `frontend/dist` build) |
| SYS-TLS-02 | SR-110 | VT-111 | HTTP listener 308-redirects to HTTPS (needs a raw HTTP request, no app content over HTTP) |
| SYS-TLS-03 | SR-110 | VT-112 | Self-signed cert auto-generated + persisted on first run (needs an empty `data/tls/`) |
| SYS-TLS-05 | SR-111 | VT-113 | Hot-swap is genuinely **without downtime / no restart** (needs to observe a live connection) |
| SYS-TLS-07 | SR-111 | VT-U10 | Hands-on usability: an admin installs a cert from Settings unaided |
| SYS-TLS-08 | SR-110 | — | The Vite **dev** server runs over HTTPS and proxies `/api` to the backend over HTTPS |
| SYS-TLS-09 | SR-110 | — | A real browser **enforces** HSTS (upgrades `http://` to `https://`) |

> Implementation references read while writing these: `backend/src/index.ts` (https.createServer +
> http 308 redirect + HSTS middleware + SPA static fallback), `backend/src/services/tls.ts`
> (`ensureCredentials` / `generateSelfSigned` / `storeUploadedCredentials` / `applyCredentials` via
> `setSecureContext`), `backend/src/routes/settings.ts` (`GET`/`POST /certificate`),
> `frontend/src/pages/SettingsPage.vue` (TLS card), `frontend/vite.config.ts`.

---

## Preconditions (one-time setup)

1. A working checkout with backend deps installed (`selfsigned` is a backend dependency).
2. For SYS-TLS-01 (SPA over HTTPS): a production build present at `frontend/dist`
   (`cd frontend && npm run build`). Without it, the backend serves the API only and `/` returns 404
   — that is expected in dev, where Vite serves the SPA (see SYS-TLS-08).
3. Microsoft Edge (the project's reference browser) for the browser-enforcement and usability checks.
4. Sign in as an administrator for the certificate-management checks.
5. A spare **valid certificate + matching private key** PEM pair for the install usability test
   (MT-TLS-06). A self-signed pair is fine, e.g.:
   `openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"`.

---

## MT-TLS-01 — SPA + API served over a single HTTPS origin (SYS-TLS-01 / SR-110 / VT-110)

**Preconditions**: `frontend/dist` build present; backend started (`cd backend && npm start`).

**Steps**
1. `curl -k https://localhost:3001/api/health`
2. `curl -k https://localhost:3001/`
3. Open `https://localhost:3001/` in a browser (accept the self-signed warning in dev).

**Expected**
- The health endpoint responds over TLS with `{ "ok": true }`.
- `/` returns the built SPA `index.html` (HTML, not a 404), served from the **same** HTTPS origin as
  the API. Any non-`/api` GET falls back to `index.html` (client-side routing).
- `-k` (insecure) is only needed because the bootstrap cert is self-signed; a real uploaded cert
  removes the warning.

---

## MT-TLS-02 — HTTP is redirected to HTTPS; no app content over HTTP (SYS-TLS-02 / SR-110 / VT-111)

**Steps**
1. `curl -I http://localhost:3000/anything` (the plain-HTTP listener; default `HTTP_PORT=3000`).
2. `curl -I http://localhost:3000/api/health`

**Expected**
- Both respond **`308 Permanent Redirect`** with a `Location:` header pointing at the **same path**
  on the HTTPS origin, e.g. `Location: https://localhost:3001/anything`
  (the redirect preserves host and path; the `:3001` suffix is omitted only when HTTPS is on port 443).
- **No** API JSON, SPA HTML, or any other application content is served over plain HTTP — every HTTP
  request is answered solely by the redirect.

---

## MT-TLS-03 — Self-signed certificate auto-generated on first run (SYS-TLS-03 / SR-110 / VT-112)

The bootstrap path that prevents a lockout before an admin uploads a real cert. Requires a **fresh,
empty** TLS directory, which the standard harness can't easily reset mid-run.

**Steps**
1. Stop the backend. Delete the TLS directory: remove `backend/src/data/tls/` (or, if running with a
   custom `DATA_DIR`, the `tls/` subfolder there). Confirm no `cert.pem` / `key.pem` exist.
2. Start the backend (`npm start`).
3. Inspect the TLS directory after startup.

**Expected**
- On startup `ensureCredentials()` finds no cert and calls `generateSelfSigned()`:
  `data/tls/key.pem`, `data/tls/cert.pem`, and a `source` marker file (`self-signed`) are **created
  and persisted**.
- The HTTPS server starts successfully with this cert — no manual setup, no lockout. The log shows
  `🔒 BrainGain served over HTTPS …`.
- `GET /api/settings/certificate` (as admin) then reports `source: "self-signed"` with valid
  subject/issuer/validity/fingerprint metadata.

> Note: every fresh `startTestServer()` in `backend/tests/tls.test.mjs` implicitly exercises this same
> bootstrap (each temp `DATA_DIR` begins empty and the server comes up healthy over HTTPS); this
> manual procedure documents the on-disk artefacts the automated check can't easily assert.

---

## MT-TLS-04 — Certificate hot-swap happens without downtime / restart (SYS-TLS-05 / SR-111 / VT-113)

`backend/tests/tls.test.mjs` proves a valid upload returns `200` and the server keeps answering. This
manual check confirms there is genuinely **no restart** and that an already-open connection is not
dropped.

**Steps**
1. As admin, with the backend running, note the process PID and start time.
2. In one terminal, start a steady stream of requests:
   `while true; do curl -k -s -o /dev/null -w "%{http_code}\n" https://localhost:3001/api/health; sleep 0.5; done`
3. In another, upload a new valid cert/key pair via the Settings page (or
   `POST /api/settings/certificate` with PEM strings).
4. After the upload returns `200`, inspect the served certificate of a **new** connection:
   `openssl s_client -connect localhost:3001 -servername localhost </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256`

**Expected**
- The request stream in step 2 **never errors / never gaps** — the process is the **same PID** the
  whole time (no restart; `setSecureContext` swaps the context in place).
- A connection opened **after** the upload presents the **new** certificate's fingerprint (matching the
  metadata returned by the upload); connections opened before the swap may keep the old cert until they
  reconnect. This is the intended "applies to new connections" behaviour.

---

## MT-TLS-05 — Browser enforces HSTS (SYS-TLS-09 / SR-110)

`backend/tests/tls.test.mjs` asserts the `Strict-Transport-Security` header is present; only a real
browser actually **enforces** it. (HSTS is typically ignored by browsers on `localhost` / for
self-signed certs, so use a trusted-cert host or a proper hostname for a faithful test.)

**Steps**
1. Visit the app over HTTPS once so the header is recorded by the browser.
2. In a new tab, type the **`http://`** URL for the same origin and load it.
3. (Optional) Inspect `Response Headers` in dev-tools and confirm
   `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

**Expected**
- After the first HTTPS visit, the browser **internally upgrades** the subsequent `http://` request to
  `https://` before it leaves the machine (no plain-HTTP request is sent for the upgraded origin).
- The `max-age` is one year and applies to subdomains.

---

## MT-TLS-06 — Admin installs a TLS certificate from Settings (usability) (SYS-TLS-07 / SR-111 / VT-U10)

The hands-on usability flow — file pickers + confirming the active cert updated — done by a human,
unaided. (E2E asserts the panel and controls exist; this measures that an admin can actually *do* it.)

**Preconditions**: admin participant; a valid cert + key file pair to hand (see Preconditions 5);
≥ 1 representative admin participant (target group of 5 for the usability metric).

**Steps**
1. Give the participant the task verbatim: *"Replace the site's certificate with the provided files."*
2. Observe, without guidance, how they use **Settings → HTTPS / TLS certificate**: the
   **Certificate (PEM)** and **Private key (PEM)** file pickers (and optional **Chain**), then the
   **Install certificate** button.
3. Note whether they read and understand the note: *"The private key is stored on the server and is
   never sent back to the browser. A new certificate applies to new connections; reload to use it."*
4. After installing, have them confirm via the **Active certificate** panel that `source: uploaded`
   and the new subject/issuer/fingerprint are shown.
5. (Negative branch) Have them try to install a **mismatched** key (key from a different cert) and
   observe the error.

**Expected**
- The participant uploads cert + key and confirms the active certificate updated, **unaided**.
- A success toast appears: *"Certificate installed — applies to new connections (reload to use it)."*
- The **Active certificate** panel updates to `source: uploaded` with the new metadata.
- A mismatched/invalid pair shows a clear error toast (*"Could not install certificate"* / the
  server's 400 message) and the active certificate is **unchanged**.
- The on-screen note about "applies to new connections / reload" is understood.

**Metric (VT-U10)**: Task success ≥ 80%; the "applies to new connections / reload" note is rated
understood/helpful by participants.

---

## MT-TLS-07 — Vite dev server is HTTPS and proxies /api over HTTPS (SYS-TLS-08 / SR-110)

A dev-environment check (the dev server is not part of the production HTTPS origin and is not started
by the test harness).

**Steps**
1. `cd frontend && npm run dev` and open the printed URL.
2. Confirm the dev URL is **`https://`** (the address bar / Vite banner). In dev with a self-signed
   cert, accept the browser warning.
3. Sign in and perform any data action (e.g. open Settings) so the SPA calls `/api/...`.
4. Inspect dev-tools → Network: the `/api` requests and confirm they reach the backend.

**Expected**
- The Vite dev server serves the SPA over **HTTPS** (auto self-signed via
  `@vitejs/plugin-basic-ssl`).
- `/api/*` is proxied to the backend over **HTTPS** with `secure: false` (the backend's self-signed
  cert is accepted by the proxy), so the whole dev experience is HTTPS end-to-end — never plain HTTP.
