# DocGov onboarding plan

Generated 2026-09-13 02:49:45 · layout `compact` · mode `solo`

**Nothing has changed yet.** This plan is a proposal. Edit it freely — delete any action you
disagree with — then run `docgov migrate` to execute exactly what remains.

> ⚠ The working tree is dirty. Commit or stash before migrating.

## Current state

- 4 documents, 2 machine contracts
- 0 documents could not be classified, 0 classified with low confidence
- 0 broken internal links, 0 suspected duplicate pairs
- stack detected: ci, tests
- existing agent instructions: .claude/rules

## Proposed state

```
./
  README.md
docs/
  FEASIBILITY.md   ← FEASIBILITY.md
docs/architecture.md/
  (to create)   (new)
docs/development.md/
  (to create)   (new)
docs/engineering/
  (to create)   (new)
docs/operations/
  (to create)   (new)
docs/product/
  PRD.md   ← PRD.md
examples/policy-packs/
  README.md
```

## Moves (2)

Relocated to the canonical position for their class. Links are repaired automatically.

- `FEASIBILITY.md` → `docs/FEASIBILITY.md`  
  a Technical Assessment belongs in docs/
- `PRD.md` → `docs/product/PRD.md`  
  a PRD belongs in docs/product/

## Missing documents (4)

The repository implies these should exist.

- `docs/operations/` (operations.deployment) — ci detected (.github/workflows/docgov.yml) but no Deployment Guide exists
- `docs/engineering/` (engineering.testing) — ci detected (.github/workflows/docgov.yml) but no Testing Strategy exists
- `docs/architecture.md` (architecture.overview) — every repository should have this
- `docs/development.md` (engineering.development) — every repository should have this

## Risk

Risk    Actions  Meaning
------  -------  ------------------------------------------
low     6        mechanical, fully reversible
medium  0        correct destination is a judgement call
high    0        content must be rewritten; never automatic

0 of 6 actions need a human or an agent to decide something.

## Execute

```bash
docgov migrate --dry-run   # show every file operation, touch nothing
docgov migrate             # on a new branch, mechanical actions only
docgov migrate --include split,merge,extract   # also the judgement calls, one at a time
```

`migrate` runs MOVE, ANNOTATE and ARCHIVE automatically and repairs every internal link.
SPLIT, MERGE and EXTRACT are left to `/docgov:organize`, which uses an agent to rewrite prose.
