---
docgov:
  id: prd-adoption
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
# PRD — Adoption and onboarding

## Summary

How DocGov enters a repository that already exists, and how it learns enough about that
repository to be useful without being told.

The governing constraint: adoption must never be the thing that breaks someone's build or
loses their work.

## Behaviour

### Progressive Disclosure

Every documentation tree should follow:

Overview
   ↓
Concept
   ↓
Detailed Guide
   ↓
Reference

Users should not encounter 5,000 words before understanding what the subsystem does.


### Existing Project Onboarding

Command:

/docgov review

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

.docgov/fix-plan.md

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


### Repository Understanding

DocGov should inspect:

README*
docs/**
```
CLAUDE.md
AGENTS.md
```
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


### Capability / Plugin Discovery

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

```
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
```

DocGov then delegates.

This is better than:

if plugin == X

because ecosystems change rapidly.

Anthropic’s current guidance also favors clearly defined tools/capabilities and letting Claude orchestrate appropriate subagents rather than hardcoding every possible orchestration path.  


### Agent Documentation Policy

DocGov installs project-level instructions.

For example:

```
.claude/
└── rules/
    └── documentation.md
```

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

## Requirements

- Onboarding must inventory and classify every existing document and produce a plan.
- The plan must change nothing. It is a file a human reads, edits, and then executes.
- Execution must run on a branch, repair internal links in the same transaction, verify the
  result, and revert itself if verification fails.
- Adoption on a repository with pre-existing documentation must start in warn-only, so the
  first build after switching DocGov on does not fail over documents that predate it.
- Repository understanding must be derived from what is actually present — stack, contracts,
  infrastructure, ownership — not from configuration the user has to write first.
- Capability discovery must detect documentation tooling that is already installed and delegate
  to it, then validate the result. An absent capability degrades to DocGov doing the job
  itself, never to a failure.
- Every proposed action must carry a risk level and a flag for whether it needs human
  judgement.

## Edge cases

- **The repository is not a git repository.** Migration refuses to run. "Without losing
  information" is only a real promise if every change is revertible.
- **The working tree is dirty.** Migration refuses, and names the uncommitted paths.
- **Two documents would migrate to the same destination.** Migration aborts before moving
  anything and names both documents.
- **A document cannot be classified.** It is left exactly where it is. Guessing is worse than
  leaving it alone.
- **Actions need prose rewritten** (split, merge, extract). These are deferred to an agent, not
  performed mechanically.

## Acceptance criteria

- `docgov review` on a repository with 100+ documents produces an inventory, classification,
  authority analysis, duplicate detection, oversized-document analysis, a proposed structure,
  missing-document analysis, internal/external classification, a migration plan and a graph —
  and changes nothing on disk outside `.docgov/`.
- `docgov fix` on that plan produces an organized repository with repaired links, metadata, a
  registry and agent rules, without losing information.
- A failed verification leaves the repository byte-identical to its pre-migration state.

## Related

- [PRD index](../PRD.md)
- [Architecture](../../architecture.md) — what was actually built
- [FEASIBILITY](../../FEASIBILITY.md) — where this specification did not survive contact
