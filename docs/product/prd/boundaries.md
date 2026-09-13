---
docgov:
  id: prd-boundaries
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
# PRD — Audience, visibility and discovery

## Summary

Who each document is for, what may leave the repository, how documentation is found, and how
an agent is given only the documentation it actually needs.

## Behaviour

### README Governance

README deserves dedicated logic.

It should generally answer:

What is this?
Why would I use it?
What does it look like?
How do I install it?
How do I start?
What can it do?
Where is deeper documentation?
How do I contribute?
Where do I get help?

It should not become the project encyclopedia.

DocGov should detect sections becoming too detailed and propose extraction:

README
Architecture section: 247 lines
Recommendation:
Move to docs/03-architecture/overview/README.md
Replace with:
12-line architecture summary + link.


### Internal vs External Documentation

For mixed projects:

```
docs/
├── public/
└── internal/
```

or metadata-driven visibility.

Publishing pipeline:

Internal documentation
       ↓
DocGov publishing analysis
       ↓
Sensitive information detection
       ↓
External lens rewrite
       ↓
Human review
       ↓
Public documentation

External docs should not simply be copied from internal docs.

They are different artifacts serving different audiences.


### Staleness Model

Don’t use only:

last_updated > 90 days

A document that hasn’t changed for two years may still be correct.

Instead calculate semantic staleness.

Signals:

related code changed
dependency document changed
contract changed
referenced file deleted
architecture changed
terminology changed
owner changed
tests changed

Then:

Staleness risk: 82/100
Reason:
12 related implementation changes since last documentation review.

Much better than time-based expiry.


### Documentation Health

Command:

/docgov health

Example:

Documentation Health: 91/100
Coverage             94
Freshness            87
Consistency          96
Structure            93
Discoverability      89
Cross-linking        91
Canonical integrity  100
Issues:
3 stale documents
2 oversized documents
1 orphan document
4 missing cross-references


### Search and Discovery

Command:

/docgov find "license validation"

DocGov should return authority-aware results:

1. [CANONICAL]
   Licensing Domain
2. [DECISION]
   ADR-021 Offline License Validation
3. [TECHNICAL]
   Licensing TRD
4. [USER]
   Offline Activation Guide

Not simply keyword matches.

Agents should consume authoritative documents first.


### Context Packs for Agents

This is another feature I strongly recommend.

Command:

/docgov brief licensing

produces the minimal authoritative context needed to modify licensing:

PRODUCT principles
        +
licensing canonical domain
        +
relevant invariants
        +
relevant ADRs
        +
API contract
        +
relevant TRD

instead of loading the entire documentation tree.

This saves context tokens and reduces agent confusion.

Anthropic’s current agent guidance emphasizes clear context, explicit success criteria and careful management of long-running agent context, so compact authoritative context packs fit the platform well.

## Requirements

- Every document must have a visibility, and internal content must never sit in a public path.
- Publishing must be a gated, human-approved step. DocGov must never publish anything by
  itself.
- An external document must be produced as a different artifact with its own lens, not as a
  redacted copy of an internal one.
- A README must answer what the project is and how to start, and must link rather than contain
  anything deeper.
- Search must rank by authority first and relevance second, so a canonical specification is
  returned before a tutorial that paraphrases it. Deprecated and superseded documents rank
  below active ones.
- A context pack must return the minimum authoritative context for an area and nothing else,
  within a token budget, degrading to headings when the budget runs out.
- Documentation health must be scored from countable facts, and must name the documents the
  repository's own stack implies but does not have.

## Edge cases

- **A public file contains an internal hostname or credential-shaped string.** It is reported
  as a leak and blocked from publication, never auto-redacted.
- **A README grows a section that has become its own document.** That is reported as
  overreach, with an extraction proposed.
- **The context budget is too small for the authoritative set.** Full bodies are included until
  the budget runs out, then headings only — never a silent truncation mid-document.
- **A scan finds nothing.** A clean report means "no known pattern matched", never "this
  document contains no secrets".

## Acceptance criteria

- `docgov publish` buckets every document into publishable, blocked, or needs-rewrite, and
  exits without publishing anything.
- `docgov find` returns the canonical source above any document that paraphrases it.
- `docgov brief <topic>` returns the constitution, canonical specification, invariants, ADRs and
  contracts for an area, and nothing else.
- `docgov health` returns a score with its components, and a list of missing documents the stack
  implies.

## Related

- [PRD index](../PRD.md)
- [Architecture](../../architecture.md) — what was actually built
- [FEASIBILITY](../../FEASIBILITY.md) — where this specification did not survive contact
