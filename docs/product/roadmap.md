---
docgov:
  id: docgov-roadmap
  type: product.roadmap
  authority: requirements
  visibility: internal
  status: active
  owner: docgov
  relationships:
    depends_on:
      - docgov-prd
  generation:
    mode: human-maintained
---
# DocGov — roadmap

The original specification planned this as V1 / V2 / V3. V1 and V2 both shipped in 0.1.0, so
those labels no longer describe anything. This is the honest state.

## Now

Shipped in 0.1.0 and working:

- Taxonomy, authority model, documentation graph, project modes, visibility, lenses, templates
  and size discipline.
- Onboarding that produces a plan and changes nothing, and migration that runs on a branch and
  reverts itself if verification fails.
- Deterministic checks on every write, with what blocks decided by project mode.
- Drift in all four directions, staleness scoring, change impact and the documentation
  checklist.
- Invariant injection before an agent edits governed code.
- Context packs, authority-ordered search, documentation health scoring.
- The publishing gate, capability discovery, and organizational policy packs.
- Published to npm as `docgov-cli`; the binary it installs is still `docgov`.
- A runnable demo (`examples/demo.sh`) and a documented command reference.

Everything the specification called V2 — drift, impact, reverse drift, context packs, quality
scoring, invariant enforcement, PR review — is in this list.

## Next

The gate for 1.0:

Nothing blocking. The gate items are closed: the taxonomy has a home for a hand-written
reference, CI tests the Node 20 lower bound `package.json` declares, and
[`examples/demo.sh`](../../examples/demo.sh) runs the whole flow against a deliberately messy
repository.

What is left is judgement rather than work: whether 1.0 should wait for the tool to be used on
a repository nobody here owns.

## Later

Organizational governance, partially present today as policy packs:

- Shared organizational templates, custom lenses, custom taxonomies.
- Organization-level invariants and central policies distributed through git.
- Cross-repository standards.

## Not planned

- Documentation analytics, or any hosted service. There is no DocGov server and no telemetry,
  and adding one would contradict the local-first guarantee.
- Automatic publishing. Publication crosses a human gate by design.
- Prose quality as a blocking gate. A subjective judgement that fails a build is one nobody can
  appeal.

## Related

- [PRD](PRD.md) — the requirements
- [CHANGELOG](../../CHANGELOG.md) — what actually changed, when
