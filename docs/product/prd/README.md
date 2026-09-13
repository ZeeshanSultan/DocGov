---
docgov:
  id: prd-index
  type: docs.index
  authority: audience
  visibility: internal
  status: active
  owner: docgov
  generation:
    mode: human-maintained
---
# PRD parts

The specification, split by concern. The [PRD itself](../PRD.md) is the index of requirements;
these carry the detail behind them.

| Part | What it specifies |
|---|---|
| [The documentation model](model.md) | Authority tiers, canonical structure, adaptive layout, the graph, project modes |
| [Document conventions](conventions.md) | Visibility, audience lenses, templates, size discipline |
| [Adoption and onboarding](adoption.md) | Entering an existing repository, understanding it, migrating safely |
| [Enforcement and drift](enforcement.md) | What blocks, what only reports, and how drift is detected |
| [Audience, visibility and discovery](boundaries.md) | Who a document is for, what may leave, how it is found |
| [System design and operation](system.md) | Command surface, architecture, state, configuration, git, CI |

These describe what was *specified*. For what was actually built, read
[architecture.md](../../architecture.md); for the places the two deliberately diverge, read
[FEASIBILITY.md](../../FEASIBILITY.md).
