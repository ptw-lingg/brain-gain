# Manual tests — Architecture & crypto (inspection)

These system requirements describe structural / cryptographic choices that are verified by
**code inspection**, not by a running assertion. Each step says what to open and what to confirm.
Cross-referenced to the requirement ids in `requirements/requirements.json`.

| Test | Validates | Method |
|---|---|---|
| MT-ARCH-02 | SYS-ARCH-02 | inspection |
| MT-ARCH-03 | SYS-ARCH-03 | inspection |
| MT-ARCH-04 | SYS-ARCH-04 | inspection |
| MT-ARCH-07 | SYS-ARCH-07 | inspection |
| MT-AUTH-02 | SYS-AUTH-02 | inspection |

---

### MT-ARCH-02 — Backend runs via tsx; ids are UUIDs (SYS-ARCH-02)
- **Steps:** Open `backend/package.json` and confirm `dev`/`start` run `tsx … src/index.ts`. Grep the backend for id creation.
- **Expected:** The backend is executed by `tsx` (no build step needed for dev/run); new entity ids are produced by `crypto.randomUUID()` (e.g. in `routes/*.ts`, `seed.ts`).

### MT-ARCH-03 — Frontend stack is Vue 3 + Pinia + Vue Router + axios (SYS-ARCH-03)
- **Steps:** Open `frontend/package.json` `dependencies`.
- **Expected:** `vue` (^3), `pinia`, `vue-router`, and `axios` are present and are the libraries used by `src/` (stores use Pinia, routing uses vue-router, API calls go through the axios `client`).

### MT-ARCH-04 — Styling is Tailwind with lucide icons and the brand fonts (SYS-ARCH-04)
- **Steps:** Open `frontend/tailwind.config.js`, `frontend/postcss.config.js`, and `index.html`.
- **Expected:** Tailwind + autoprefixer are configured; `lucide-vue-next` provides icons; the Space Grotesk / DM Mono fonts are loaded; the pastel-blue palette tokens are defined in the Tailwind theme.

### MT-ARCH-07 — Strict TypeScript, no implicit `any` (SYS-ARCH-07)
- **Steps:** Open `backend/tsconfig.json` and `frontend/tsconfig.json`; run `npm --prefix backend run typecheck` and `npm --prefix frontend run typecheck`.
- **Expected:** `"strict": true` in both; both typechecks pass with **zero** errors; no `any` is relied upon in app code.

### MT-AUTH-02 — Passwords are bcrypt-hashed with cost factor 10 (SYS-AUTH-02)
- **Steps:** Inspect `backend/src/routes/users.ts`, `auth.ts`, and `seed.ts` for `bcrypt.hash(...)`. (The hash is never exposed by the API — see the automated SafeUser tests — so this is verified by inspection.)
- **Expected:** Every password write uses `bcrypt.hash(password, 10)`; comparison uses `bcrypt.compare`. No plaintext password is stored or logged.
