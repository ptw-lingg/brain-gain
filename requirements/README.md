# BrainGain — Requirements

Requirements for **BrainGain** are stored as **linkable, traceable objects** in a single machine-readable
dataset. Any tool can load it, follow the links, and render a traceability graph; the human-readable Markdown
docs and the in-app viewer are all produced from it.

## Source of truth

| File | Role |
|---|---|
| **`requirements.json`** | **The single source of truth.** Every requirement (and actors, enums, out-of-scope) is a typed object with a stable `id` and typed `links`. **Edit this.** |
| `schema/requirements.schema.json` | JSON Schema (draft 2020-12) — the formal contract. `requirements.json` references it via `$schema`, so editors validate on save. |
| `tools/build.mjs` | Validator + generator (plain Node, no deps). Validates integrity and regenerates the Markdown views + the app's data copy. |

### Generated artifacts — do **not** edit by hand

- `stakeholder-requirements.md`, `system-requirements.md`, `traceability-matrix.md` — rendered views.
- `validation-plan.md` — the validation test plan (acceptance + usability + accessibility).
- `../frontend/src/data/requirements.generated.json` — the copy the in-app viewer imports.

## The object model (`requirements.json`)

- `meta` — project/version/updated + a pointer to the narrative spec (`../brain-gain.md`).
- `enums` — `priority` (M/S/C), `source`, `status`, `linkType` (each `{id,label}`).
- `actors` — Administrator / Trainer / Member / Business owner.
- `requirements[]` — the core objects:
  - Common: `id`, `type` (`stakeholder` | `system`), `category`, `title`, `text`, `status`.
  - Stakeholder: `priority`, `source` (+ optional `sourceNote`).
  - System: `links[]` (`{type:"derivedFrom", target:"SR-…"}`), `implementedBy[]` (`{path, symbol}`),
    optional `verifiedBy[]` and `specRefs[]`.
- `tests[]` — **validation tests** (`VT-…`): `testType` (acceptance | usability | accessibility), `method`,
  `links[]` (`{type:"validates", target:"SR-…"}`), `steps[]`, `expected`, optional `preconditions`/`metric`.
  These validate stakeholder requirements ("are we building the right thing?"), including usability and
  accessibility.
- `outOfScope[]`.

**Links are one-directional in storage** (`SYS --derivedFrom--> SR`, `VT --validates--> SR`); the inverses
(`SR satisfiedBy SYS`, `SR validatedBy VT`) and the `SR → code` rollup are **computed** by the generator and
the viewer, never duplicated.

IDs: `SR-\d{3}` (stakeholder) and `SYS-<AREA>-\d{2}` (system). **IDs are stable — never renumber;** add new
ones and mark superseded ones (`status: "superseded"`, optional `supersedes` link).

## How to view

- **In-app:** sign in as an admin → **Requirements** in the sidebar (`/requirements`). Browse, filter
  (including by **Validation tests**), and click `SR ⇄ SYS ⇄ code` and `SR ⇄ VT` traces in both directions; a
  requirement's detail shows its **Validated by** tests, and a test shows what it **Validates** plus its
  steps/expected/metric.
- **As docs:** the generated Markdown files in this folder.
- **As data:** load `requirements.json` (validate against the schema) in any tool.

## Maintenance workflow (per change)

1. **Edit `requirements.json`** — add/modify the requirement object(s) and their `links` / `implementedBy` /
   `verifiedBy`. Add a new `SR-…` only for a genuinely new stakeholder need.
2. **Run the generator:**
   ```
   node requirements/tools/build.mjs            # validate + regenerate views
   node requirements/tools/build.mjs --check     # validate + fail on drift (CI / pre-commit)
   ```
   It enforces: unique ids, id patterns, enum membership, all link targets resolve, every system requirement
   has a `derivedFrom` + `implementedBy`, every stakeholder requirement is covered by ≥1 system requirement,
   and **every stakeholder requirement has ≥1 validation test** (`VT-…` whose `validates` targets it).
3. **Commit** `requirements.json` together with the regenerated artifacts.
4. Update the matching section of [`../brain-gain.md`](../brain-gain.md) if the design decision changed.

> See [`../brain-gain.md`](../brain-gain.md) → "Requirements & Traceability" for the standing rule that keeps
> the prompt, the code, and these requirements in sync.

## Notes

- The generator is dependency-free; the JSON Schema is the contract for external tools (add `ajv` later if you
  want programmatic schema validation in CI).
- There is no automated test suite yet; `build.mjs --check` is the integrity gate and can run in CI.
