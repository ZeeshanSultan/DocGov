---
docgov:
  id: prd-system
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
# PRD — System design and operation

## Summary

The shape of the thing that has to be built: its command surface, its architecture, the state
it keeps, how it is configured, how it uses git, how it behaves in CI, and where a human can
always override it.

## Behaviour

### Commands / Skills

The initial product surface could be surprisingly small:

/docgov setup
/docgov review
/docgov create
/docgov tag
/docgov inspect
/docgov health
/docgov stale
/docgov affected
/docgov brief
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


### Proposed Plugin Architecture

```
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
├── policy/
│
└── cli/
```


### Local State

Do not put the whole documentation intelligence into prompts.

Maintain:

```
.docgov/
├── config.yaml
├── registry.yaml
├── graph.json
├── tools.json
├── cache/
└── reports/
```

registry.yaml might contain:

documents:
  licensing-domain:
```
    path: docs/03-architecture/domains/licensing.md
    authority: canonical
    visibility: internal
```
  licensing-prd:
```
    path: docs/01-product/features/licensing.md
    authority: requirements
```
  licensing-api:
```
    path: openapi/licensing.yaml
    authority: machine-contract
```


### Configuration

Example:

version: 1
project:
```
  mode: team
  visibility: mixed
```
documentation:
  root: docs
governance:
```
  canonical_changes_require_review: true
  prevent_duplicate_domains: true
```
limits:
  readme:
```
    soft_lines: 300
    hard_lines: 500
```
  prd:
    soft_lines: 800
quality:
```
  readme: 85
  prd: 90
  trd: 90
  security: 95
```
drift:
  enabled: true
generated:
  allow_manual_edit: false

Everything important should be configurable.


### Git Integration

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


### CI Mode

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
docgov stale --base main


### Human Override

Absolutely necessary.

Agents will occasionally be wrong.

Allow:

docgov ignore DRIFT-381 \
  --reason "Intentional implementation experiment"

But suppressions should:

* require a reason;
* be recorded;
* optionally expire;
* appear in reports.

Never silently ignore them.


### Safe Migration

Existing project onboarding must be transactional.

Before:

```
/docs/architecture.md
/design.md
/spec.md
/notes.md
```

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


### Plugin Interoperability Principle

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


### Security Model

Because DocGov may process internal architecture:

Default:

local-first
repository-scoped
no telemetry containing documentation
no automatic publication
no cross-project document leakage

External publication should always have a deliberate boundary.

### Design decision: the core must not be Claude-only

The core is built as a deterministic standalone engine:

```
                DocGov Core
                    │
        ┌───────────┼───────────┐
        ↓           ↓           ↓
      CLI      Claude Plugin     CI
                    │
                 Skills
                    │
                 Agents
```

Meaning:

docgov-core
```
    taxonomy
    registry
    graph
    validators
    templates
    rules
    git analysis
```
Claude layer
```
    semantic classification
    contradiction analysis
    splitting recommendations
    writing
    quality evaluation
```

This gives you three major benefits:

Portability: tomorrow it can support Claude Code, Codex, Cursor, VS Code or other agent harnesses.

Testability: deterministic governance can have proper unit/integration tests instead of being buried inside prompts.

Reliability: an LLM doesn’t decide whether docgov.id is duplicated. Software does.

## Requirements

- The core engine must have no dependency on any particular agent harness, so the same engine
  can back a different one.
- The same binary must run in an editor session and in CI.
- All repository state must live under `.docgov/`, and derived state must be regenerable from
  the repository at any time.
- Git is the audit log. DocGov must read git history rather than maintain a parallel one.
- Every command must support machine-readable output.
- Exit codes must distinguish pass, deterministic violation, review required, and configuration
  error.
- A human must always be able to override a finding, and the override must be recorded rather
  than hidden.
- DocGov must govern without monopolizing: where another tool already does a job, delegate to
  it and validate the result.
- No telemetry. No network calls in the engine.

## Edge cases

- **A required capability is missing.** DocGov does the job itself. Absence degrades to
  self-service, never to failure.
- **Derived state is edited by hand.** It is regenerated and the edit is lost; that is why it is
  derived and why the rule against editing generated documents blocks.
- **Two documents claim the same id.** Registry rebuild fails rather than silently picking one.
- **CI runs on a shallow clone.** Drift analysis needs history; the workflow must fetch enough
  of it.

## Acceptance criteria

- `core/` imports nothing specific to a single agent harness.
- Every command accepts `--json` and returns the documented exit codes.
- Deleting `.docgov/registry.yaml` and the graph, then rebuilding, produces an identical result.
- The engine makes no network call, and no documentation leaves the machine.

## Related

- [PRD index](../PRD.md)
- [Architecture](../../architecture.md) — what was actually built
- [FEASIBILITY](../../FEASIBILITY.md) — where this specification did not survive contact
