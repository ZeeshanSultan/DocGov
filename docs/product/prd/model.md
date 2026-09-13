---
docgov:
  id: prd-model
  type: product.feature
  authority: requirements
  visibility: internal
  status: active
  owner: docgov
  relationships:
    implements:
      - docgov-prd
  generation:
    mode: human-maintained
---
# PRD — The documentation model

## Summary

How DocGov decides what a document *is*: its authority tier, where it belongs, what
relationships it may declare, and how the shape of the tree adapts to the repository.

This is the part of the specification everything else depends on. Nothing in enforcement or
adoption means anything without it.

## Behaviour

### Documentation Authority Model

Every document receives an authority classification.

### Tier 0 — Constitution

Defines project-level invariants.

Examples:

```
PRODUCT.md
PRINCIPLES.md
INVARIANTS.md
GLOSSARY.md
```

Changes should be rare and highly deliberate.


### Tier 1 — Canonical Domain Specifications

Defines authoritative domain semantics.

Examples:

```
canonical/
├── identity.md
├── licensing.md
├── authorization.md
├── package-intelligence.md
├── telemetry.md
└── deployment-model.md
```

A lower-level document cannot contradict these.


### Tier 2 — Decision / Requirement Documentation

Examples:

PRD
TRD
UX specification
Threat model
ADRs
Security requirements

These explain what is being built and why.


### Tier 3 — Machine Contracts

Examples:

OpenAPI
JSON Schema
protobuf
GraphQL schema
DB migrations
RBAC policies
event schemas
configuration schema
CLI definitions

Whenever possible, factual reference documentation should derive from here.


### Tier 4 — Implementation

Source code and infrastructure.


### Tier 5 — Generated Documentation

Examples:

API reference
CLI reference
configuration reference
permission matrix
database diagrams

Should not normally be manually edited.


### Tier 6 — Audience Documentation

Examples:

README
Getting Started
User Guide
Administrator Guide
Tutorials
Troubleshooting

Optimized for consumption rather than architecture authority.


### Tier 7 — Historical Documentation

Examples:

ADRs
release notes
migration notes
deprecated specifications
archived designs


### Canonical Repository Structure

DocGov should not require every repository to populate every directory.

It establishes namespaces that may remain empty.

```
docs/
│
├── 00-canonical/
│   ├── PRODUCT.md
│   ├── PRINCIPLES.md
│   ├── INVARIANTS.md
│   ├── GLOSSARY.md
│   └── DOMAINS.md
│
├── 01-product/
│   ├── vision/
│   ├── requirements/
│   ├── features/
│   ├── personas/
│   └── roadmap/
│
├── 02-design/
│   ├── ux/
│   ├── ui/
│   ├── flows/
│   └── accessibility/
│
├── 03-architecture/
│   ├── overview/
│   ├── domains/
│   ├── components/
│   ├── data/
│   ├── integrations/
│   └── adr/
│
├── 04-security/
│   ├── architecture/
│   ├── threat-models/
│   ├── authorization/
│   ├── data-classification/
│   └── security-testing/
│
├── 05-engineering/
│   ├── development/
│   ├── testing/
│   ├── conventions/
│   └── dependencies/
│
├── 06-operations/
│   ├── deployment/
│   ├── infrastructure/
│   ├── configuration/
│   ├── observability/
│   ├── runbooks/
│   └── disaster-recovery/
│
├── 07-release/
│   ├── releases/
│   ├── migrations/
│   └── deprecations/
│
├── 08-user/
│   ├── getting-started/
│   ├── guides/
│   ├── reference/
│   ├── troubleshooting/
│   └── faq/
│
├── 09-governance/
│   ├── contribution/
│   ├── support/
│   ├── lifecycle/
│   └── policies/
│
├── 10-internal/
│
├── 11-external/
│
├── 90-generated/
│
└── 99-archive/
```

But this is logical taxonomy, not necessarily mandatory physical structure.

For small projects DocGov might choose:

```
README.md
docs/
├── architecture.md
├── development.md
├── security.md
├── adr/
└── user-guide.md
```

That distinction matters.

The plugin should prevent documentation architecture astronautics.


### Adaptive Information Architecture

The canonical taxonomy should be extensible.

A document can define:

---
docgov:
```
  id: licensing-architecture
  type: architecture.domain
  domain: licensing
  authority: canonical
```
  audience:
    - engineering
    - security
```
  visibility: internal
  owner: platform
  status: active
```
  relationships:
    depends_on:
      - identity-domain
      - authorization-domain
    implements:
      - licensing-prd
    supersedes:
      - licensing-v1
  review:
    cadence: 90d
  generation:
    mode: human-maintained
---

This metadata creates the Documentation Graph.


### Documentation Graph

DocGov should not think about documents as files.

It should think:

```
                 PRODUCT
                    │
                    ↓
                  PRD
               ↙        ↘
       UX Specification  Security Model
               ↓             ↓
              TRD ←───────────┘
               │
               ↓
             ADRs
               │
               ↓
          OpenAPI/schema
               │
               ↓
        Implementation
               │
               ↓
             Tests
               │
               ↓
         User Documentation
```

Relationships include:

depends_on
defines
implements
derived_from
supersedes
references
validated_by
generated_from
exposes
documents

This becomes fundamental to drift detection.


### Project Modes

During initialization:

/docgov setup

DocGov determines:

Solo

Optimized for low bureaucracy.

Light approval requirements
Automatic fixes allowed
Minimal metadata

Team

Adds:

owners
review requirements
CODEOWNERS integration
approval gates

Enterprise

Adds:

internal/external classification
security gates
compliance metadata
auditability
publishing controls

Open Source

Emphasizes:

README
CONTRIBUTING
SECURITY
public roadmap
API docs
community documentation

## Requirements

- Every document must resolve to exactly one class in the taxonomy, or to `unknown`.
- Every class must define an authority tier, a canonical location, a review lens, a soft and a
  hard size limit, and its required sections.
- Authority must be a total order, so any two documents in conflict have a defined winner. A
  lower-authority document may not contradict a higher one.
- Machine contracts (OpenAPI, JSON Schema, protobuf, GraphQL, migrations) outrank all prose
  describing them. Prose references a contract; it never restates it.
- Relationships must be typed and must have automatic inverses, so the graph cannot hold a
  one-sided edge.
- Internal links must become inferred graph edges, so the graph is useful before anyone declares
  a relationship by hand.
- The repository structure must adapt to project size rather than imposing one tree on every
  repository.
- The project mode must decide how much is allowed to block, and must be inferable from the
  repository rather than required as configuration.

## Edge cases

- **Two documents at equal authority contradict each other.** There is no tie-break. The
  conflict is reported for a human and never resolved automatically.
- **A document fits several classes.** Classification returns candidates with confidence, and a
  type declared in frontmatter always beats a heuristic.
- **A repository is too small for the full tree.** The layout collapses to `compact`, and
  namespace directories may stay empty rather than being deleted.
- **A relationship points at a document that does not exist.** That is a finding, not a silent
  dropped edge.

## Acceptance criteria

- `docgov types` lists every class with its authority, lens, limits and required sections.
- `docgov whatis --path <file>` returns a class, a confidence, the signals behind it, the
  canonical destination and the competing candidates.
- `docgov graph` shows typed edges with inverses present on both ends, and counts orphans.
- A document that declares its type in frontmatter is never reclassified by a heuristic.

## Related

- [PRD index](../PRD.md)
- [Architecture](../../architecture.md) — what was actually built
- [FEASIBILITY](../../FEASIBILITY.md) — where this specification did not survive contact
