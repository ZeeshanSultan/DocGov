---
docgov:
  id: docgov-prd
  type: product.prd
  authority: requirements
  visibility: internal
  status: active
  owner: docgov
  generation:
    mode: human-maintained
---
Yes. I would treat this as more than a “documentation skill.” The product should be a documentation governance layer for agentic software development: it establishes the information architecture, knows which artifacts are authoritative, intercepts documentation-producing workflows, detects drift, enforces quality gates, and continuously reconciles documentation with the repository.

Below is the PRD I would use.

PRD — Agentic Documentation Governance Plugin

Working name: DocGov
Product type: Claude Code plugin / skills + hooks + optional local CLI
Primary interface: Claude Code
Secondary interface: CLI / CI
Deployment: Per-project, user-level, or organization/team configuration
Status: Proposed

⸻

1. Product Vision

Modern software documentation fails primarily because documentation is treated as a collection of Markdown files rather than a governed representation of the software system.

The problem becomes substantially worse with agentic development:

Developer
   │
   ├── Claude
   ├── Coding agents
   ├── Planning agents
   ├── Security agents
   ├── Testing agents
   └── Third-party skills
           │
           ↓
       Repository
           │
     ┌─────┴─────┐
     ↓           ↓
    Code        Docs

Different agents can:

* create duplicate documents;
* invent new organizational structures;
* contradict canonical documents;
* create enormous Markdown files;
* put documentation in the wrong location;
* update implementation without updating specifications;
* update specifications without updating implementation;
* create README content inappropriate for its audience;
* mix internal and external information;
* ignore existing ADRs;
* redefine terminology;
* create undocumented architectural decisions;
* leave obsolete documentation behind.

DocGov establishes a documentation control plane around the repository.

                     ┌─────────────────────┐
                     │       DocGov        │
                     │ Governance Engine   │
                     └──────────┬──────────┘
                                │
       ┌────────────────────────┼───────────────────────┐
       ↓                        ↓                       ↓
   Developers                Agents                  CI/CD
       │                        │                       │
       └────────────────────────┼───────────────────────┘
                                ↓
                       Documentation Graph
                                │
             ┌──────────────────┼─────────────────┐
             ↓                  ↓                 ↓
          Intent            Contracts       Implementation
             │                  │                 │
             └──────────────────┼─────────────────┘
                                ↓
                         Drift Detection

The objective is:

Any agent or human should be able to modify the project at high velocity without degrading the project’s documentation architecture or creating silent documentation drift.

⸻

2. Goals

DocGov SHALL:

1. Bootstrap excellent documentation for new repositories.
2. Understand and onboard existing repositories.
3. Create and enforce a canonical documentation taxonomy.
4. Classify existing documents.
5. Reorganize documentation safely.
6. identify duplicates, contradictions and obsolete documents.
7. enforce document scope and size discipline.
8. distinguish canonical, operational, historical and generated documentation.
9. distinguish internal and external documentation.
10. provide templates for every supported document class.
11. enforce different quality gates by document type.
12. maintain documentation relationships/dependencies.
13. detect documentation drift.
14. detect implementation → documentation drift.
15. detect documentation → implementation drift.
16. integrate with Claude’s agent/skill ecosystem.
17. detect available capabilities rather than unnecessarily reinventing them.
18. provide repository-wide documentation instructions to future agents.
19. validate agent-generated documentation.
20. integrate documentation checks into CI.
21. work for solo developers.
22. work for teams.
23. support open-source repositories.
24. support private commercial repositories.
25. support mixed public/private documentation.
26. maintain excellent developer discoverability.
27. minimize documentation maintenance burden.

⸻

3. Non-goals

DocGov should not become:

* a generic knowledge-management system;
* a replacement for Git;
* a replacement for GitHub;
* a replacement for code comments;
* a replacement for OpenAPI;
* a project-management system;
* an issue tracker;
* an arbitrary Markdown formatter;
* an AI wiki.

It governs documentation.

Existing deterministic tools should remain authoritative wherever appropriate.

⸻

4. Core Principle

DocGov follows:

Humans define intent. Machine-readable artifacts define facts where possible. Code implements behavior. Git records history. DocGov governs relationships and consistency between them.

The plugin should aggressively avoid creating multiple sources of truth.

⸻

5. Documentation Authority Model

Every document receives an authority classification.

Tier 0 — Constitution

Defines project-level invariants.

Examples:

PRODUCT.md
PRINCIPLES.md
INVARIANTS.md
GLOSSARY.md

Changes should be rare and highly deliberate.

⸻

Tier 1 — Canonical Domain Specifications

Defines authoritative domain semantics.

Examples:

canonical/
├── identity.md
├── licensing.md
├── authorization.md
├── package-intelligence.md
├── telemetry.md
└── deployment-model.md

A lower-level document cannot contradict these.

⸻

Tier 2 — Decision / Requirement Documentation

Examples:

PRD
TRD
UX specification
Threat model
ADRs
Security requirements

These explain what is being built and why.

⸻

Tier 3 — Machine Contracts

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

⸻

Tier 4 — Implementation

Source code and infrastructure.

⸻

Tier 5 — Generated Documentation

Examples:

API reference
CLI reference
configuration reference
permission matrix
database diagrams

Should not normally be manually edited.

⸻

Tier 6 — Audience Documentation

Examples:

README
Getting Started
User Guide
Administrator Guide
Tutorials
Troubleshooting

Optimized for consumption rather than architecture authority.

⸻

Tier 7 — Historical Documentation

Examples:

ADRs
release notes
migration notes
deprecated specifications
archived designs

⸻

6. Canonical Repository Structure

DocGov should not require every repository to populate every directory.

It establishes namespaces that may remain empty.

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

But this is logical taxonomy, not necessarily mandatory physical structure.

For small projects DocGov might choose:

README.md
docs/
├── architecture.md
├── development.md
├── security.md
├── adr/
└── user-guide.md

That distinction matters.

The plugin should prevent documentation architecture astronautics.

⸻

7. Adaptive Information Architecture

The canonical taxonomy should be extensible.

A document can define:

---
docgov:
  id: licensing-architecture
  type: architecture.domain
  domain: licensing
  authority: canonical
  audience:
    - engineering
    - security
  visibility: internal
  owner: platform
  status: active
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

⸻

8. Documentation Graph

DocGov should not think about documents as files.

It should think:

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

⸻

9. Project Modes

During initialization:

/docgov init

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

⸻

10. Documentation Visibility Model

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

⸻

11. Documentation Lenses

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

⸻

Developer Lens

Evaluates:

* technical precision;
* reproducibility;
* examples;
* assumptions;
* failure modes;
* dependencies;
* links to architecture.

⸻

Architecture Lens

Evaluates:

* boundaries;
* responsibilities;
* data flows;
* dependencies;
* invariants;
* trade-offs;
* ADR references.

⸻

Security Lens

Evaluates:

* trust boundaries;
* threat actors;
* assets;
* authorization;
* secret handling;
* abuse cases;
* security assumptions.

⸻

External/User Lens

Evaluates:

* jargon;
* internal leakage;
* prerequisites;
* task orientation;
* clarity;
* examples.

⸻

AI/Agent Lens

Evaluates whether another agent can reliably use the document as context without making incorrect assumptions.

This is increasingly important.

⸻

12. Document Templates

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

⸻

13. Document Size Discipline

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

architecture.md
   ├── Authentication
   ├── Licensing
   ├── Telemetry
   ├── Update system
   └── Plugin architecture

DocGov recommends:

architecture/
├── README.md
├── authentication.md
├── licensing.md
├── telemetry.md
├── updates.md
└── plugins.md

The parent becomes an index/overview.

⸻

14. Progressive Disclosure

Every documentation tree should follow:

Overview
   ↓
Concept
   ↓
Detailed Guide
   ↓
Reference

Users should not encounter 5,000 words before understanding what the subsystem does.

⸻

15. Existing Project Onboarding

Command:

/docgov onboard

Pipeline:

Repository discovery
       ↓
Document inventory
       ↓
Code architecture discovery
       ↓
Existing agent instructions discovery
       ↓
Plugin/skill discovery
       ↓
Classification
       ↓
Duplicate detection
       ↓
Contradiction detection
       ↓
Coverage analysis
       ↓
Proposed information architecture
       ↓
Migration plan
       ↓
User approval
       ↓
Migration
       ↓
Validation

Important: onboarding should never immediately rearrange someone’s repository.

First produce:

.docgov/onboarding-plan.md

with:

current state
proposed state
moves
merges
splits
archives
missing documents
suspected duplicates
suspected contradictions
broken references
risk

Then ask for approval.

⸻

16. Repository Understanding

DocGov should inspect:

README*
docs/**
CLAUDE.md
AGENTS.md
CONTRIBUTING*
SECURITY*
CHANGELOG*
package manifests
OpenAPI
schemas
database migrations
CI workflows
Docker
Kubernetes
Terraform
source structure
tests
existing ADRs

This allows it to infer what documentation should exist.

For example:

Kubernetes detected
Prometheus detected
PostgreSQL detected
OpenAPI detected
OAuth detected

but:

deployment documentation      missing
observability documentation   missing
backup documentation          missing
API documentation             generated
authentication model          missing

⸻

17. Capability / Plugin Discovery

Your idea here is correct, but I would avoid tightly coupling DocGov to specific plugins.

Instead create a Capability Registry.

During setup:

DocGov
   ↓
Discover environment
   ↓
Available skills
Available MCP servers
Available plugins
Available agents
Available hooks
Available commands

Then normalize them:

{
  "capabilities": {
    "diagramming": ["mermaid-skill"],
    "github": ["github-mcp"],
    "security": ["security-review"],
    "api": ["openapi-skill"],
    "browser": ["browser"],
    "documentation": ["docs-writer"]
  }
}

DocGov then delegates.

This is better than:

if plugin == X

because ecosystems change rapidly.

Anthropic’s current guidance also favors clearly defined tools/capabilities and letting Claude orchestrate appropriate subagents rather than hardcoding every possible orchestration path.  

⸻

18. Agent Documentation Policy

DocGov installs project-level instructions.

For example:

.claude/
└── rules/
    └── documentation.md

Conceptually:

Before creating documentation:
1. Query DocGov classification.
2. Determine whether an authoritative document already exists.
3. Do not create duplicate documentation.
4. Determine correct document type.
5. Apply its template.
6. Apply appropriate audience lens.
7. Respect authority hierarchy.
8. Update relationships.
9. Validate documentation after changes.

This makes governance available to other agents, rather than requiring the user to invoke DocGov manually every time.

⸻

19. Hooks

Hooks are where the plugin becomes significantly stronger.

Potential lifecycle:

Agent wants to write *.md
          ↓
DocGov pre-write hook
          ↓
Classify intended document
          ↓
Existing equivalent?
       /        \
     YES        NO
      ↓          ↓
Update?     Determine location
      ↓          ↓
Template/lens validation
          ↓
Allow write
          ↓
Post-write validation

Do not block every Markdown edit.

Use progressive enforcement.

⸻

20. Quality Gates

Each document gets scored across dimensions.

Example:

Structure             95
Completeness          88
Clarity               92
Technical grounding   97
Cross references      84
Audience fit          91
Security              96
Freshness             100
--------------------------------
Overall               93
PASS

Different documents require different thresholds.

Example:

README             ≥ 85
PRD                ≥ 90
TRD                ≥ 90
Security Model     ≥ 95
ADR                ≥ 90
Internal notes     ≥ 70

However, scoring should remain advisory where the evaluation is subjective. Deterministic violations can block.

⸻

21. Deterministic vs AI Rules

This distinction is essential.

Deterministic

Can block CI:

broken links
missing required frontmatter
invalid document ID
duplicate ID
invalid references
generated file manually modified
forbidden visibility path
missing required template sections
invalid OpenAPI
orphan relationship

Semantic/AI

Usually warning/review:

document appears contradictory
README too detailed
TRD missing meaningful failure analysis
two documents appear redundant
architecture explanation appears stale
document should probably be split

Never make subjective LLM judgment an opaque hard blocker by default.

⸻

22. Drift Engine

Command:

/docgov drift

Analyze:

Git diff
documentation graph
canonical documents
contracts
implementation
tests

Output:

DOCUMENTATION DRIFT REPORT
Critical: 1
High:     2
Medium:   4
Low:      3

Example:

HIGH
Implementation:
src/licensing/validator.ts
changed offline grace period:
7 → 30 days
Canonical specification:
docs/03-architecture/domains/licensing.md
still states:
7 days
Affected:
LIC-INV-004
Recommended action:
Review canonical specification.

⸻

23. Reverse Drift

Also detect:

Documentation changed
        ↓
Implementation unchanged

Example:

PRD changed:
Maximum organizations:
5 → unlimited
No corresponding changes detected in:
src/limits/
entitlements.yaml
tests/

Flag:

SPECIFICATION IMPLEMENTATION MISMATCH

⸻

24. Invariant Enforcement

Canonical invariants become first-class objects.

INV-LIC-001
License belongs to exactly one organization.
INV-AUTH-003
Only organization owners can transfer ownership.

Agents modifying relevant code should receive applicable invariants automatically.

This is one of the highest-value features.

⸻

25. Change Impact Analysis

Whenever something changes:

git diff
   ↓
DocGov classifier
   ↓
Affected domains
   ↓
Documentation graph
   ↓
Impact report

Example:

Changed:
src/auth/session.ts
Potential impact:
AUTH-DOMAIN
SECURITY-AUTH
THREAT-MODEL
API-AUTH
ADMIN-GUIDE
Required review:
3
Optional review:
2

⸻

26. PR Workflow

A PR should automatically receive:

DocGov Documentation Review
───────────────────────────
Code impact: HIGH
Documentation impact: HIGH
✓ API contract updated
✓ TRD updated
✓ tests updated
✓ ADR not required
⚠ Security architecture possibly impacted
✗ Admin documentation outdated
Documentation readiness: BLOCKED

This solves the “remember to update docs” problem.

⸻

27. Documentation Change Manifest

I would add another feature you hadn’t explicitly mentioned.

Each meaningful change can produce a temporary manifest:

change:
  domain:
    - licensing
  behavior_changed: true
  api_changed: true
  security_changed: false
  user_visible: true
docs:
  required:
    - licensing-domain
    - api-reference
    - user-license-guide
  reviewed:
    - licensing-domain
  outstanding:
    - user-license-guide

This can disappear after merge.

It gives agents a deterministic checklist.

⸻

28. README Governance

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

⸻

29. Internal vs External Documentation

For mixed projects:

docs/
├── public/
└── internal/

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

⸻

30. Staleness Model

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

⸻

31. Documentation Health

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

⸻

32. Search and Discovery

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

⸻

33. Context Packs for Agents

This is another feature I strongly recommend.

Command:

/docgov context licensing

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

⸻

34. Commands / Skills

The initial product surface could be surprisingly small:

/docgov init
/docgov onboard
/docgov create
/docgov organize
/docgov review
/docgov health
/docgov drift
/docgov impact
/docgov context
/docgov find
/docgov publish

Example:

/docgov create trd licensing

automatically:

1. finds licensing PRD;
2. finds canonical licensing specification;
3. finds applicable ADRs;
4. finds architecture context;
5. selects TRD template;
6. generates initial structure;
7. checks relationships;
8. registers document.

⸻

35. Proposed Plugin Architecture

docgov/
│
├── plugin/
│
├── skills/
│   ├── init/
│   ├── onboard/
│   ├── create/
│   ├── review/
│   ├── drift/
│   ├── impact/
│   ├── organize/
│   └── publish/
│
├── agents/
│   ├── classifier/
│   ├── architect/
│   ├── drift-reviewer/
│   └── quality-reviewer/
│
├── hooks/
│   ├── pre-write
│   ├── post-write
│   └── pre-commit
│
├── templates/
│
├── lenses/
│
├── schemas/
│
├── rules/
│
└── cli/

⸻

36. Local State

Do not put the whole documentation intelligence into prompts.

Maintain:

.docgov/
├── config.yaml
├── registry.yaml
├── graph.json
├── capabilities.json
├── cache/
└── reports/

registry.yaml might contain:

documents:
  licensing-domain:
    path: docs/03-architecture/domains/licensing.md
    authority: canonical
    visibility: internal
  licensing-prd:
    path: docs/01-product/features/licensing.md
    authority: requirements
  licensing-api:
    path: openapi/licensing.yaml
    authority: machine-contract

⸻

37. Configuration

Example:

version: 1
project:
  mode: team
  visibility: mixed
documentation:
  root: docs
governance:
  canonical_changes_require_review: true
  prevent_duplicate_domains: true
limits:
  readme:
    soft_lines: 300
    hard_lines: 500
  prd:
    soft_lines: 800
quality:
  readme: 85
  prd: 90
  trd: 90
  security: 95
drift:
  enabled: true
generated:
  allow_manual_edit: false

Everything important should be configurable.

⸻

38. Git Integration

Git should remain the audit log.

DocGov uses:

git diff
git blame
git log
tags
branches
PR metadata

to determine:

* when behavior changed;
* which documents were affected;
* who owns an area;
* whether docs and implementation changed together.

No separate documentation version-control system is needed.

⸻

39. CI Mode

Provide:

docgov check

Suitable for GitHub Actions or other CI systems.

Exit statuses:

0 PASS
1 deterministic documentation violation
2 drift requiring review
3 configuration error

Potential:

docgov check --changed
docgov check --all
docgov drift --base main

⸻

40. Human Override

Absolutely necessary.

Agents will occasionally be wrong.

Allow:

docgov suppress DRIFT-381 \
  --reason "Intentional implementation experiment"

But suppressions should:

* require a reason;
* be recorded;
* optionally expire;
* appear in reports.

Never silently ignore them.

⸻

41. Safe Migration

Existing project onboarding must be transactional.

Before:

/docs/architecture.md
/design.md
/spec.md
/notes.md

Proposed migration should show:

MOVE
architecture.md
→ docs/03-architecture/overview.md
SPLIT
design.md
→ docs/02-design/ux.md
→ docs/03-architecture/components.md
MERGE
spec.md + relevant notes.md
→ docs/01-product/requirements/core.md
ARCHIVE
notes.md remainder
→ docs/99-archive/notes-2026.md

Nothing moves until approved.

And links must be repaired automatically.

⸻

42. Plugin Interoperability Principle

DocGov should follow:

Govern, don’t monopolize.

If another installed capability is better at:

Mermaid diagrams
OpenAPI
security review
GitHub operations
database inspection

DocGov should delegate and then validate the resulting documentation.

That will make it much more durable than building an enormous monolithic documentation agent.

⸻

43. Security Model

Because DocGov may process internal architecture:

Default:

local-first
repository-scoped
no telemetry containing documentation
no automatic publication
no cross-project document leakage

External publication should always have a deliberate boundary.

⸻

44. Acceptance Criteria for V1

V1 is successful if a developer can clone DocGov and run:

/docgov onboard

on a messy repository containing 100+ documentation files and receive:

1. accurate inventory;
2. classification;
3. authority analysis;
4. duplicate detection;
5. oversized-document analysis;
6. proposed canonical structure;
7. missing-document analysis;
8. internal/external classification;
9. migration plan;
10. documentation graph.

Then approve migration and receive:

organized repository
+
repaired links
+
metadata
+
registry
+
agent documentation rules
+
CI validation

without losing information.

⸻

45. V2

Add:

drift detection
change impact
reverse drift
context packs
quality scoring
invariant enforcement
PR review

⸻

46. V3

Add organizational governance:

shared organizational templates
custom lenses
custom taxonomy
organization invariants
central policies
cross-repository standards
documentation analytics
public documentation publishing

⸻

47. Critical Design Decision: Don’t Make It Claude-Only Internally

I’d build the core as a deterministic standalone engine:

                DocGov Core
                    │
        ┌───────────┼───────────┐
        ↓           ↓           ↓
      CLI      Claude Plugin     CI
                    │
                 Skills
                    │
                 Agents

Meaning:

docgov-core
    taxonomy
    registry
    graph
    validators
    templates
    rules
    git analysis
Claude layer
    semantic classification
    contradiction analysis
    splitting recommendations
    writing
    quality evaluation

This gives you three major benefits:

Portability: tomorrow it can support Claude Code, Codex, Cursor, VS Code or other agent harnesses.

Testability: deterministic governance can have proper unit/integration tests instead of being buried inside prompts.

Reliability: an LLM doesn’t decide whether docgov.id is duplicated. Software does.

⸻

48. The Feature I Think Completes the Product

Your original concept is primarily:

“Make agents write documentation correctly.”

I would broaden the invariant to:

“No material project change should be able to occur without DocGov understanding its documentation implications.”

That means DocGov participates in:

PLAN
  ↓
identify affected specifications
IMPLEMENT
  ↓
inject relevant context + invariants
WRITE DOCS
  ↓
classify + template + govern
REVIEW
  ↓
check contradictions + quality
COMMIT
  ↓
deterministic validation
PR
  ↓
impact + drift analysis
MERGE
  ↓
update documentation graph
RELEASE
  ↓
release/user-documentation verification

At that point it stops being another documentation generator.

It becomes a documentation integrity system for agentic development.

That distinction is important because Claude already has increasingly sophisticated tool use, long-horizon agent behavior and subagent orchestration.   Trying to compete with those capabilities would create a brittle plugin. DocGov should instead provide the persistent rules, schemas, authority graph, lifecycle hooks, templates and verification mechanisms within which those agents operate.

I would also make plugin/skill capability discovery dynamic rather than depending on a fixed list of Claude features, because the Claude ecosystem and model capabilities are actively evolving. Anthropic’s own model lifecycle documentation shows that models and capabilities are regularly replaced or deprecated.  

The resulting architecture is essentially:

              ┌─────────────────────────┐
              │      Agent Ecosystem    │
              │ Claude / skills / MCPs  │
              └────────────┬────────────┘
                           │
                    ┌──────▼──────┐
                    │   DOCGOV    │
                    │ CONTROL     │
                    │   PLANE     │
                    └──────┬──────┘
                           │
       ┌───────────────────┼────────────────────┐
       │                   │                    │
       ▼                   ▼                    ▼
   INTENT DOCS         CONTRACTS              CODE
       │                   │                    │
       └───────────────────┼────────────────────┘
                           │
                           ▼
                    CONSISTENCY GRAPH
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
               CI GATE          AGENT CONTEXT

That is the architecture I would build around.