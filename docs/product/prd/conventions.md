---
docgov:
  id: prd-conventions
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
# PRD — Document conventions

## Summary

The rules a single document has to obey once its class is known: who may see it, which
audience lens judges it, what template it starts from, and how large it is allowed to get
before it stops being that kind of document.

## Behaviour

### Documentation Visibility Model

Each document receives:

public
internal
confidential
generated-public
generated-internal

This prevents accidental information leakage.

For example:

Threat Model
visibility: internal
Public Security Model
visibility: public

Both can discuss security but have different lenses.


### Documentation Lenses

This is one of the features I would add to your proposal.

The same information should be evaluated differently depending upon its audience.

README Lens

Goal:

Can a developer understand the project in five minutes?

Gate:

* clear purpose;
* concise;
* installation immediately discoverable;
* usage immediately discoverable;
* architecture only summarized;
* deep information linked rather than embedded;
* no internal implementation dump.


Developer Lens

Evaluates:

* technical precision;
* reproducibility;
* examples;
* assumptions;
* failure modes;
* dependencies;
* links to architecture.


Architecture Lens

Evaluates:

* boundaries;
* responsibilities;
* data flows;
* dependencies;
* invariants;
* trade-offs;
* ADR references.


Security Lens

Evaluates:

* trust boundaries;
* threat actors;
* assets;
* authorization;
* secret handling;
* abuse cases;
* security assumptions.


External/User Lens

Evaluates:

* jargon;
* internal leakage;
* prerequisites;
* task orientation;
* clarity;
* examples.


AI/Agent Lens

Evaluates whether another agent can reliably use the document as context without making incorrect assumptions.

This is increasingly important.


### Document Templates

Every document class receives a minimum template.

For example:

PRD

Context
Problem
Goals
Non-goals
Personas
Requirements
User flows
Functional requirements
Non-functional requirements
Security considerations
Edge cases
Dependencies
Acceptance criteria
Open questions

TRD

Context
Requirements mapping
Existing architecture
Proposed architecture
Components
Data model
Interfaces
State transitions
Failure handling
Security
Performance
Observability
Migration
Testing
Rollout
Rollback
Open questions

ADR

Title
Status
Context
Decision
Alternatives
Consequences
Security implications
Supersedes

Threat Model

Scope
Assets
Actors
Trust boundaries
Entry points
Data flows
Threats
Controls
Residual risks
Assumptions

Runbook

Purpose
Trigger
Preconditions
Diagnostics
Procedure
Validation
Rollback
Escalation

There should eventually be approximately 25–40 templates, but projects instantiate only the relevant ones.


### Document Size Discipline

This needs deterministic rules plus semantic judgment.

For example:

Document	Soft limit	Hard review
README	300 lines	500
ADR	200	350
PRD	800	1,200
TRD	1,000	1,500
Runbook	400	700
User guide	700	1,000
Canonical domain	700	1,000

But line count alone must never trigger automatic splitting.

The semantic evaluator asks:

Does this document contain multiple independently addressable concepts?

Example:

```
architecture.md
   ├── Authentication
   ├── Licensing
   ├── Telemetry
   ├── Update system
   └── Plugin architecture
```

DocGov recommends:

```
architecture/
├── README.md
├── authentication.md
├── licensing.md
├── telemetry.md
├── updates.md
└── plugins.md
```

The parent becomes an index/overview.

## Requirements

- Every document must carry a visibility, and internal content must never sit in a public path.
- Every class must have an audience lens, and a document must be judged against the lens its
  location implies rather than against a single global style.
- Every class must have a template, and its required sections must be a deterministic gate
  rather than a style preference.
- Every class must have a soft and a hard size limit. Passing the soft limit is advisory;
  passing the hard limit is a finding.
- Size limits must be expressed per class, because a README and a domain specification are not
  the same kind of object.
- Files that a code host renders on a project's front page must be governable without
  frontmatter, because frontmatter renders as a table and a README should open with the
  project.

## Edge cases

- **A document is well written but for the wrong audience.** That is a lens failure and is
  reported, even though nothing about it is structurally wrong.
- **A document passes its hard limit but cannot be split.** The finding stands and is
  suppressed with a reason, rather than the limit being quietly raised.
- **A template section is genuinely not applicable.** It is stated as not applicable, not left
  blank and not filled with placeholder text.
- **A generated document is edited by hand.** That blocks. The source changes and the document
  is regenerated.

## Acceptance criteria

- `docgov check` reports a document whose visibility conflicts with its path.
- `docgov create <type>` produces a document already carrying its required sections.
- A document past its hard limit produces a finding naming the limit and the actual size.
- A README governed through registration carries no frontmatter and is still checked.

## Related

- [PRD index](../PRD.md)
- [Architecture](../../architecture.md) — what was actually built
- [FEASIBILITY](../../FEASIBILITY.md) — where this specification did not survive contact
