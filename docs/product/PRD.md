---
docgov:
  id: docgov-prd
  type: product.prd
  authority: requirements
  visibility: internal
  status: active
  owner: docgov
  relationships:
    depends_on:
      - docgov-vision
  generation:
    mode: human-maintained
---
# DocGov — product requirements

The requirements themselves. The detail behind each area lives in [prd/](prd/README.md); the
motivation lives in [vision.md](vision.md); what was actually built, and where it deliberately
diverges from this document, live in [architecture.md](../architecture.md) and
[FEASIBILITY.md](../FEASIBILITY.md).

## Context

Software documentation is treated as a collection of Markdown files. It is actually a
representation of a software system, and the relationships inside it — this specification
governs this code, this ADR decided this question, this contract is authoritative over this
prose — are the part that carries the meaning.

Agentic development breaks the file-collection model quickly. A repository now has many
authors, most of them agents, producing documentation faster than any review process can keep
coherent. See [vision.md](vision.md) for the full diagnosis.

DocGov is a Claude Code plugin and a standalone CLI. Claude Code is the primary interface; the
CLI and CI are the secondary one, and the same binary serves both. It is configurable per
project, per user, and per organization. It is local-first, has no service behind it, and holds
no state outside the repository.

## Problem

Documentation in an agentic repository degrades in ways that are individually small and
collectively fatal:

- duplicate documents covering the same topic, with no defined winner;
- invented directory structures that no later agent can predict;
- lower-authority documents quietly contradicting canonical specifications;
- implementations updated without their specifications, and specifications updated without
  their implementations;
- documents written for the wrong audience, or mixing internal and external material;
- ADRs that already settled a question being ignored because nobody surfaced them.

None of these is a writing problem, and none is solved by generating more prose. Each is a
failure to govern a *relationship*, and most are decidable by software.

## Goals

DocGov shall:

**Structure**
1. Bootstrap good documentation structure in a new repository.
2. Understand and adopt a repository that already has documentation.
3. Create and enforce a canonical documentation taxonomy.
4. Classify existing documents.
5. Reorganize documentation safely and reversibly.
6. Identify duplicates, contradictions and obsolete documents.
7. Enforce document scope and size discipline.
8. Distinguish canonical, operational, historical and generated documentation.
9. Distinguish internal from external documentation.
10. Provide a template for every supported document class.
11. Enforce different quality gates by document type.
12. Maintain documentation relationships and dependencies.

**Truth over time**
13. Detect documentation drift.
14. Detect implementation → documentation drift.
15. Detect documentation → implementation drift.
16. Hand every agent the rules governing the code it is about to edit, before it edits it.
17. Give an agent the minimum authoritative context for an area, and nothing else.

**Fitting in**
18. Integrate with Claude's agent and skill ecosystem.
19. Detect capabilities that already exist rather than reinventing them.
20. Provide repository-wide documentation instructions to future agents.
21. Validate agent-generated documentation.
22. Integrate documentation checks into CI.

**Audience**
23. Work for solo developers.
24. Work for teams.
25. Support open-source repositories.
26. Support private commercial repositories.
27. Support mixed public and private documentation.
28. Maintain good developer discoverability.
29. Minimize documentation maintenance burden.

## Non-goals

DocGov should not become:

- a generic knowledge-management system;
- a replacement for git;
- a replacement for GitHub;
- a replacement for code comments;
- a replacement for OpenAPI;
- a project-management system;
- an issue tracker;
- an arbitrary Markdown formatter;
- an AI wiki.

It governs documentation. Existing deterministic tools remain authoritative wherever they
already do the job.

Specifically out of scope:

- Writing documentation for the user, or grading prose as a blocking gate.
- Maintaining a history parallel to git.
- Publishing anything automatically.
- Any telemetry, hosted service, or network call in the engine.

## Personas

**The solo builder.** Zero to ten years of experience, ships with an agent daily, has never run
a documentation review. Has forty Markdown files and no idea which are still true. Will
uninstall anything that blocks a trivial change. Needs the default path to be three commands
and the output to be plain language.

**The team adopting mid-life.** An existing repository with real documentation, some of it
years old, some of it wrong. Cannot accept a migration that loses work or a rollout that breaks
the next build. Needs a plan it can read and edit before anything moves.

**The agent.** Does not read the repository the way a human does, has a token budget, and will
confidently do the wrong thing if the rule it needed was in a document it never opened. Needs
the relevant invariants injected at the moment of the edit, not available somewhere on request.

## Requirements

DocGov must know, for every document in a repository: what class it is, what authority that
class carries, where it belongs, what it must contain, how large it may be, which code it
describes, who it is for, and whether it may leave the repository.

It must enforce everything decidable by software, identically in an editor session and in CI,
and it must always be able to show its reasoning. It must never enforce a judgement call.

It must be adoptable on a repository that already has documentation without that adoption
being the thing that breaks the build.

Detail by area:

| Area | Specification |
|---|---|
| Taxonomy, authority, graph, structure, modes | [prd/model.md](prd/model.md) |
| Visibility, lenses, templates, size limits | [prd/conventions.md](prd/conventions.md) |
| Onboarding, migration, repository understanding, capability discovery | [prd/adoption.md](prd/adoption.md) |
| Enforcement rings, quality gates, drift, impact, invariants, suppressions | [prd/enforcement.md](prd/enforcement.md) |
| README governance, internal/external, search, context packs, health | [prd/boundaries.md](prd/boundaries.md) |
| Commands, architecture, state, configuration, git, CI, override | [prd/system.md](prd/system.md) |

## Functional requirements

- **Classify.** Given any document, return its class, a confidence, the signals behind it, its
  canonical destination, and the competing candidates. A declared type always wins.
- **Create.** Produce a new document of a given class in its canonical location, with its
  template and required sections, wired into the graph.
- **Review.** Inventory and classify an entire repository and emit a plan — moves,
  annotations, splits, merges, extractions, archives, missing documents, duplicate and
  contradiction candidates — changing nothing on disk outside `.docgov/`.
- **Fix.** Execute that plan on a branch, repairing internal links in the same transaction,
  verifying the result, and reverting if verification fails.
- **Check.** Run the deterministic checks, apply recorded exceptions, and report findings split
  into blocking and advisory according to project mode.
- **Detect drift.** Forward, reverse, contract and dependency, plus a staleness score derived
  from what changed around a document rather than its age.
- **Analyse impact.** Name the documents a change affects, split into required and optional, and
  express them as a checklist an agent can work through and CI can verify.
- **Inject rules.** Hand an agent the invariants governing a file before it edits that file.
- **Pack context.** Return the minimum authoritative context for an area within a token budget.
- **Search.** Rank by authority first, relevance second.
- **Score health.** Produce a composite score from countable facts, and name the documents the
  repository's stack implies but does not have.
- **Gate publication.** Report what would leak and produce rewrite briefs. Never publish.
- **Record exceptions.** A suppression carries a reason, may expire, and stays visible.

## Non-functional requirements

- **Deterministic core.** The engine decides every blocking question without a model, and
  returns the same answer locally and in CI.
- **Fast enough to sit in a write path.** The per-write check must not be something a user
  notices.
- **Fails open.** A bug in DocGov may stop it governing. It must never stop the user's session
  working.
- **Local-first.** No telemetry, no network calls in the engine, no state outside the
  repository. Documentation never leaves the machine.
- **Portable.** The core has no dependency on any single agent harness.
- **Zero install friction.** No build step and no runtime dependencies.
- **Regenerable.** All derived state can be rebuilt from the repository at any time.
- **Machine-readable.** Every command supports JSON output and documented exit codes.

## Security considerations

- **Documentation is sensitive.** It routinely contains hostnames, architecture, credentials
  pasted by mistake, and unmitigated vulnerabilities. The engine therefore makes no network
  call, and only one hook sends anything to a model — documented in
  [SECURITY.md](../../SECURITY.md).
- **Publication is the real risk surface.** DocGov detects what would leak and produces rewrite
  briefs; it never publishes, and an external document is authored as a separate artifact
  rather than a redacted copy of an internal one.
- **Leak detection is best-effort.** A clean report means "no known pattern matched", never
  "this document contains no secrets". It must be described that way everywhere it is reported.
- **Hooks execute on every write.** They must fail open, must not execute repository content,
  and must not be able to corrupt the repository.
- **Migration must be reversible.** It requires git and a clean tree, so that any failure
  returns the repository to its previous state exactly.

## Edge cases

- Two documents at equal authority contradict each other: there is no tie-break, and it is
  reported for a human.
- A document cannot be classified: it is left where it is rather than guessed at.
- Two documents would migrate to the same destination: migration aborts before moving anything.
- The repository is not a git repository, or the tree is dirty: migration refuses and says why.
- A check is wrong for a specific case: it is suppressed with a reason, never silenced.
- A capability DocGov would delegate to is missing: DocGov does the job itself.
- The context budget is too small: full bodies until it runs out, then headings — never a
  silent truncation.
- A document declares a relationship to something that does not exist: a finding, not a
  dropped edge.

Per-area edge cases are listed in each part under [prd/](prd/README.md).

## Dependencies

- **Node 20 or later.** No runtime dependencies, no build step.
- **git.** Required for drift, impact and migration; DocGov reads history rather than keeping
  its own.
- **Claude Code**, for the plugin surface — skills and hooks. The CLI must remain fully usable
  without it.
- **Optional, discovered at runtime:** link checkers, Markdown and prose linters, OpenAPI
  tooling, diagram renderers, MCP servers. Each is delegated to when present and replaced by
  DocGov's own implementation when absent.
- **Conventions adopted rather than reinvented:** Diátaxis for audience documentation, MADR for
  ADRs, OpenAPI and JSON Schema as authoritative contracts, Keep a Changelog, SemVer.

## Acceptance criteria

DocGov is acceptable when a developer can point it at a messy repository of 100+ documents and
receive an accurate inventory, classification, authority analysis, duplicate detection,
oversized-document analysis, a proposed canonical structure, missing-document analysis,
internal/external classification, a migration plan and a documentation graph — with nothing on
disk changed outside `.docgov/`.

Then, on approving that plan: an organized repository, repaired links, metadata, a registry,
agent documentation rules and CI validation — without losing information, and revertible in one
git command if verification fails.

Per-area acceptance criteria are listed in each part under [prd/](prd/README.md). Delivery
status is tracked in [roadmap.md](roadmap.md).

## Open questions

- **Where does a hand-written reference document belong?** The taxonomy's only Reference class
  is forced to `generated`, which the generated-edit check then guards. A command reference is
  an ordinary document and currently has no home without a workaround.
- **Should the taxonomy ship a "specification part" class?** This document is split across
  `product.feature` parts, which fits, but the fit is approximate — they are specification
  sections, not features.
- **How is a policy pack versioned** as organizational governance grows beyond the current
  git-distributed form?
- **What is the upgrade path** when the taxonomy itself changes under a repository that has
  already adopted it? Nothing currently migrates a document from a retired class.

## Related

- [Vision](vision.md) — why this exists
- [Roadmap](roadmap.md) — what is shipped and what is next
- [PRD parts](prd/README.md) — the detail behind each requirement area
- [Architecture](../architecture.md) — what was built
- [FEASIBILITY](../FEASIBILITY.md) — where the specification did not survive contact
