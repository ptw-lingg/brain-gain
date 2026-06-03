# BrainGain — Requirements

This folder holds the requirements for **BrainGain**, a training-management web app. The documents are
organized as a classic requirements hierarchy — from stakeholder needs, down to system behavior, down to the
code that implements them — so any requirement can be traced in both directions.

## Documents

| Document | Level | Answers | Audience |
|---|---|---|---|
| [`stakeholder-requirements.md`](./stakeholder-requirements.md) | Stakeholder (`SR-…`) | *What* do stakeholders need, and *why*? | Product owner, stakeholders |
| [`system-requirements.md`](./system-requirements.md) | System (`SYS-…`) | *How* must the system behave to meet those needs? | Engineers, reviewers, QA |
| [`traceability-matrix.md`](./traceability-matrix.md) | Trace | *Where* is each requirement realized in code? | Engineers, auditors |

## How they relate

```
Stakeholder needs            System behavior                 Implementation
─────────────────            ───────────────                 ──────────────
stakeholder-requirements ──▶ system-requirements   ──▶       backend/ + frontend/ source
        SR-xxx        derives        SYS-…          realized by   (files · symbols · endpoints)
          ▲                            │                              │
          └──────────── traceability-matrix.md ────────────────────────┘
                 (links SR ⇄ SYS ⇄ code, both directions)
```

- Each **`SYS-…`** requirement names the **`SR-…`** it derives from (its **Trace** column).
- The **traceability matrix** maps every **`SYS-…`** to the implementing code and provides a reverse index
  from each **`SR-…`** to its system requirements and code areas.
- Design decisions (tech stack, API contracts, data shapes, validation, access-control model, the SSO flow)
  come from the product prompt [`../brain-gain.md`](../brain-gain.md), which remains the narrative spec; the
  requirements documents distill it into individually-numbered, verifiable statements.

## Sources

These requirements were reverse-engineered from:

1. **[`../brain-gain.md`](../brain-gain.md)** — the original stakeholder request log (and its refinements)
   plus the elaborated functional/technical spec.
2. **Features delivered during development** — training drag-and-drop **ordering** and **Microsoft Entra ID
   SSO**, including their agreed design decisions (admin-configurable SSO in Settings, keep password login,
   domain-restricted just-in-time provisioning).

## Conventions

- **IDs are stable.** Don't renumber; add new IDs (e.g. `SR-110`, `SYS-TRN-10`) and mark superseded ones.
- **Priority** (stakeholder doc): **M** = Must · **S** = Should · **C** = Could.
- **Keep it current.** When behavior changes, update the relevant `SYS-…`, its `brain-gain.md` section, and
  the traceability row in the same change.

## Maintenance checklist (per change)

- [ ] New/changed behavior captured as a `SYS-…` (and a `SR-…` if it's a new stakeholder need).
- [ ] `traceability-matrix.md` row added/updated to point at the implementing file(s)/endpoint(s).
- [ ] `../brain-gain.md` updated if the design decision changed.
- [ ] Verification noted (how the requirement was checked).

> **Gap:** the repository currently has **no automated test suite**. Functional requirements are verified
> manually / via ad-hoc scripts today; introducing unit/integration tests is the recommended next step to
> make the matrix continuously verifiable.
