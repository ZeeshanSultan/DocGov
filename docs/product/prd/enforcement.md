---
docgov:
  id: prd-enforcement
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
# PRD — Enforcement and drift

## Summary

What DocGov actually blocks, what it merely reports, and how it notices that documentation
and code have come apart.

The load-bearing split: software decides everything that blocks, a model decides everything
subjective, and neither crosses over.

## Behaviour

### Hooks

Hooks are where the plugin becomes significantly stronger.

Potential lifecycle:

Agent wants to write *.md
          ↓
DocGov pre-write hook
          ↓
Classify intended document
          ↓
Existing equivalent?
```
       /        \
     YES        NO
      ↓          ↓
```
Update?     Determine location
      ↓          ↓
Template/lens validation
          ↓
Allow write
          ↓
Post-write validation

Do not block every Markdown edit.

Use progressive enforcement.


### Quality Gates

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


### Deterministic vs AI Rules

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


### Drift Engine

Command:

/docgov stale

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


### Reverse Drift

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
```
entitlements.yaml
tests/
```

Flag:

SPECIFICATION IMPLEMENTATION MISMATCH


### Invariant Enforcement

Canonical invariants become first-class objects.

INV-LIC-001
License belongs to exactly one organization.
INV-AUTH-003
Only organization owners can transfer ownership.

Agents modifying relevant code should receive applicable invariants automatically.

This is one of the highest-value features.


### Change Impact Analysis

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


### PR Workflow

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


### Documentation Change Manifest

I would add another feature you hadn’t explicitly mentioned.

Each meaningful change can produce a temporary manifest:

change:
  domain:
    - licensing
```
  behavior_changed: true
  api_changed: true
  security_changed: false
  user_visible: true
```
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

### The invariant that completes the product

The narrow framing of this product is:

“Make agents write documentation correctly.”

The broader invariant it should actually hold to:

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

```
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
```
   INTENT DOCS         CONTRACTS              CODE
```
       │                   │                    │
       └───────────────────┼────────────────────┘
                           │
                           ▼
                    CONSISTENCY GRAPH
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
               CI GATE          AGENT CONTEXT
```

That is the architecture I would build around.

## Requirements

- Enforcement must run in rings: a fast deterministic check on every write, one fast model call
  when a new document is created, and deeper subagent review on demand or in CI.
- Ring 1 must be decidable by software alone and must complete fast enough to sit in a write
  path.
- Only deterministic findings may block. A subjective judgement must never fail a build,
  because a subjective judgement that fails a build is one nobody can appeal.
- Which findings block must depend on the project mode, and must be overridable per repository.
- Drift must cover forward drift (code changed, documentation did not), reverse drift
  (specification changed, code did not), contract drift, and dependency drift.
- Staleness must be scored from what changed around a document, not from the document's age.
- Change impact must name the documents a change affects, split into required and optional, and
  must be expressible as a checklist an agent can work through and CI can verify.
- Invariants declared in canonical documents must be injected to any agent before it edits the
  code those invariants govern.
- Every deliberate exception must be recordable, must carry a reason, may expire, and must stay
  visible in every report.

## Edge cases

- **A document claims to describe code that changed.** That is reported as a fact. Whether the
  prose now contradicts the code is a judgement, made by an agent, on the narrowed list, and is
  advisory.
- **A rule is wrong for a particular case.** It is suppressed with a reason, not silenced.
  Suppressions remain visible and expired ones are reported.
- **DocGov itself fails.** Hooks fail open. A bug in DocGov may stop it governing; it must never
  stop the user's session working.
- **A governance rule would block a trivial change.** It must not. A tool that blocks a README
  typo gets uninstalled.
- **Contradiction detection across many documents.** Pairwise model comparison does not scale;
  candidates must be narrowed locally before any model is asked.

## Acceptance criteria

- `docgov check` exits 1 only on findings the mode marks as blocking, and 2 when drift needs
  review.
- Every blocking finding names the rule, the path, the reason and a fix.
- `docgov stale` distinguishes forward, reverse, contract and dependency drift, and scores
  staleness independently of file age.
- `docgov affected` and `docgov checklist` agree on the same set of documents.
- An agent editing governed code receives the invariants governing that code before it writes.

## Related

- [PRD index](../PRD.md)
- [Architecture](../../architecture.md) — what was actually built
- [FEASIBILITY](../../FEASIBILITY.md) — where this specification did not survive contact
