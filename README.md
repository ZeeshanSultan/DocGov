---
docgov:
  id: readme
  type: user.readme
  authority: audience
  audience:
    - everyone
  visibility: public
  status: active
  generation:
    mode: human-maintained
---
# DocGov

Documentation governance for agentic development. A Claude Code plugin plus a standalone CLI.

Documentation does not rot because people are lazy. It rots because a repository with many
authors — most of them now agents — produces documentation faster than any review process
can keep coherent. Different agents create duplicate documents, invent directory structures,
contradict canonical specifications, update implementations without updating specifications,
and leave obsolete documents behind.

DocGov puts a control plane around that. It knows which documents are authoritative, what
class each document is, where it belongs, what it must contain, which code it describes, and
what went stale when something changed.

## Install

```bash
claude plugin marketplace add <this-repo>
claude plugin install docgov
```

Then in your repository:

```bash
/docgov:init        # establish governance
/docgov:onboard     # for a repository that already has documentation
```

The CLI works standalone too (`bin/docgov`, Node 20+, zero dependencies) — the same binary
runs in CI.

## The idea

```
Humans define intent.  Machine artifacts define facts.  Code implements behaviour.
Git records history.   DocGov governs the relationships between them.
```

Two halves, and the split is load-bearing:

- **A deterministic engine** decides everything that blocks. Is this id a duplicate? Is this
  document in the right place? Did code change that a canonical specification claims to
  describe? Software answers these, the same way in your editor and in CI, and it can always
  show its reasoning.
- **A Claude layer** decides everything subjective. Do these two documents actually
  contradict each other? Should this be split? Does this prose still match the code? These
  are reported for review and never enforced automatically.

An LLM never decides whether `docgov.id` is duplicated. Software never decides whether your
prose is clear.

## What it does

| | |
|---|---|
| **Taxonomy** | 56 document classes across 8 authority tiers, each with a canonical location, required sections, size limits and a review lens. Fully overridable. |
| **Authority model** | `constitution > canonical > requirements > contract > code > generated > audience > historical`. A lower-authority document may not contradict a higher one, and violations are structural errors. |
| **Documentation graph** | Typed relationships (`depends_on`, `implements`, `supersedes`, `documents`, …) with automatic inverses. Internal links become inferred edges, so the graph is useful on day one. |
| **Invariant injection** | Write `INV-LIC-001 A license belongs to exactly one organization.` in a canonical document, map the code it governs, and every agent that later edits that code is handed the rule before it writes a line. The cheapest high-value feature in the product. |
| **Drift detection** | Forward (code moved, docs did not), reverse (spec moved, code did not), contract, and dependency drift. Plus semantic staleness scored from what changed *around* a document, not from its age. |
| **Impact analysis** | Which documents a change affects, which are required rather than optional, and a manifest an agent can work through and CI can verify. |
| **Context packs** | `docgov context licensing` returns the minimum authoritative context for an area — constitution, canonical spec, invariants, ADRs, contracts. A skill injects it, so it is the only documentation an agent pays tokens for. |
| **Safe migration** | Onboarding writes a plan and changes nothing. Migration runs on a branch, repairs every internal link in the same transaction, verifies the result, and reverts itself if verification fails. |
| **Publishing gate** | Detects what would leak and produces external-lens rewrite briefs. An external document is a different artifact, not a redacted copy. Nothing is ever published automatically. |

## Progressive enforcement

A governance tool that blocks a README typo gets uninstalled. Enforcement runs in three rings:

| Ring | When | Engine | Cost | Can block |
|---|---|---|---|---|
| 1 | every Markdown write | the CLI, no model | ~95 ms | yes |
| 2 | a new document is written | one fast model call | ~2 s | yes, with self-correction |
| 3 | `/docgov:review`, `/docgov:drift`, CI | subagents | seconds | CI only |

Ring 1 blocks only what software can decide: duplicate ids, hand edits to generated trees,
unparseable frontmatter, internal documents in public paths, archive edits. How much of that
blocks depends on the project mode — `solo` blocks three rules, `enterprise` blocks twelve.

## Usage

```
docgov init | onboard | migrate              set up, understand, reorganize
docgov types | classify | create | organize  author
docgov check | drift | impact | manifest     govern
docgov health | find | context | invariants  inspect
docgov publish | suppress                    boundaries and exceptions
```

Each is also a skill: `/docgov:onboard`, `/docgov:drift`, `/docgov:context licensing`, …
Every command accepts `--json`.

Exit codes: `0` pass · `1` deterministic violation · `2` review required · `3` configuration error.

## Governing other agents

`docgov init` installs `.claude/rules/documentation.md`, so every agent in the repository —
not only DocGov's own skills — knows to check for an existing document before creating one,
to apply the right template, to respect the authority hierarchy, and to run `docgov impact`
after a material change.

Hooks make that non-optional at the points that matter: a `SessionStart` briefing listing the
authoritative documents, invariant injection before code edits, a deterministic gate before
Markdown writes, and a `Stop` check for outstanding documentation obligations.

## Interoperability

DocGov governs; it does not monopolize. `docgov capabilities` detects what is already
installed — lychee, markdownlint, Vale, Spectral, oasdiff, diagram tools, MCP servers,
local skills — and delegates to it, then validates the result. An absent capability simply
means DocGov does the job itself.

It adopts established conventions rather than competing with them: [Diátaxis](https://diataxis.fr)
for audience documentation, MADR for ADRs, OpenAPI and JSON Schema as authoritative contracts.

## Design notes

- **Zero dependencies.** Node 20+ stdlib only, including a strict YAML subset parser that
  refuses constructs it cannot represent rather than guessing. The plugin works from a
  `git clone` with no install step and no network.
- **Local-first.** No telemetry, no network calls in the engine, repository-scoped state in
  `.docgov/`. Publication always crosses a human gate.
- **Git is the audit log.** DocGov reads `git diff`, `log` and `blame`; it does not maintain
  a parallel history.
- **Portable core.** `core/` has no Claude Code dependency, so the same engine can back
  another agent harness.

## Honest limits

- **Symbol-level drift is not deterministic.** DocGov tells you, as a fact, that a document
  claims to describe code that changed while the document did not. Whether the prose now
  contradicts the code is a judgement, made by an agent, on the narrowed list — advisory,
  never a hard gate. Claiming otherwise would be the fastest way to lose your trust.
- **Quality scores are advisory by design.** A subjective judgement that fails a build is one
  nobody can appeal.
- **Migration requires git and a clean tree.** "Without losing information" is only a real
  promise if every change is revertible.
- **Capability discovery is filesystem probing**, not an API, so it will drift as the
  ecosystem changes. Absence always degrades to "DocGov does it itself", never to a failure.
- **Contradiction detection narrows, then asks.** Pairwise model comparison across a hundred
  documents is ~5,000 comparisons; DocGov uses local tf-idf similarity to get to ~20 candidate
  pairs first.

## Repository

```
bin/docgov        the engine and the hook protocol
core/             deterministic: taxonomy, graph, classify, drift, impact, migrate, check
skills/           11 skills — thin, they call the CLI and interpret
agents/           classifier, architect, drift-reviewer, quality-reviewer
hooks/            the three enforcement rings
templates/        hand-authored scaffolds; the rest are synthesized from required sections
lenses/           7 audience lenses
schemas/          JSON Schema for frontmatter and config
rules/            the agent documentation policy installed into your repository
examples/         policy packs (organizational governance)
```

Organizational governance lives in [examples/policy-packs](examples/policy-packs/README.md).

`npm test` runs 57 tests over the engine, including drift, migration, policy packs and the hook protocol
against real temporary git repositories.

## Licence

MIT. See [PRD.md](PRD.md) for the full product specification and
[FEASIBILITY.md](FEASIBILITY.md) for how it maps onto Claude Code primitives.
