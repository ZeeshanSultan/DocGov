# Changelog

All notable changes to DocGov. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

DocGov is at 0.x, so a **minor** bump may break compatibility — semver permits it and this
is young enough to need the room. Two things count as breaking, because people's repositories
depend on them: a change to `docgov.id` semantics or to the frontmatter schema, and a rule
moving from warning to blocking in an existing project mode. Either will be called out here
with a migration note.

## [Unreleased]

## [0.1.0] — 2026-09-13

First release. Complete and tested, but unproven outside its own repository —
hence 0.1.0 rather than 1.0.0.

### Added

- **Taxonomy** — 57 document classes across 8 authority tiers, each with a canonical
  location, required sections, size limits, visibility default and review lens. Every
  field overridable from `.docgov/config.yaml` or a policy pack.
- **Authority model** — `constitution > canonical > requirements > contract > code >
  generated > audience > historical`, with structural violations detected rather than
  merely discouraged.
- **Documentation graph** — ten typed relationships with automatic inverses; internal
  markdown links become inferred edges, so the graph is useful before anyone declares one.
- **Invariant injection** — invariants written in canonical documents are parsed into
  first-class objects and injected into any agent editing the code they govern.
- **Drift detection** — forward, reverse, contract and dependency drift, plus semantic
  staleness scored from surrounding change rather than from age.
- **Impact analysis** and the change manifest, with a PR-ready report.
- **Context packs** — minimal authority-ordered context for a topic.
- **Transactional migration** — plan first, execute on a branch, repair every internal
  link in the same operation, verify, and revert on failure.
- **Publishing analysis** — leak detection and external-lens rewrite briefs. Never publishes.
- **Three enforcement rings** — a ~95 ms CLI gate on every write, one prompt hook on new
  documents, subagents for review. `solo` blocks 3 rules, `enterprise` blocks 12.
- **Adoption ramp** — `init` starts in `warn_only` when documentation predates DocGov, so
  switching governance on does not fail the next build.
- 11 skills, 4 agents, 7 audience lenses, JSON Schema for frontmatter and config.
- **Policy packs** for organizational governance, distributed as git rather than a service.
- **External registration** — `documentation.registrations` governs a document from config
  instead of a frontmatter block, so the files GitHub renders on a project's front page do not
  open with a metadata table.
- Zero dependencies; 60 tests against real temporary git repositories.

### Known limits

- Symbol-level drift is reported as "this document is now unverified", which is a fact.
  Whether the prose contradicts the code is an agent's judgement and never a hard gate.
- Quality scores are advisory by construction.
- Migration requires git and a clean tree.
- Capability discovery is filesystem probing, not an API, so it will drift as the
  ecosystem changes. Absence always degrades to "DocGov does it itself".

[Unreleased]: https://github.com/ZeeshanSultan/DocGov/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ZeeshanSultan/DocGov/releases/tag/v0.1.0
