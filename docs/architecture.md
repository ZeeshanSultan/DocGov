---
docgov:
  id: architecture-overview
  type: architecture.overview
  authority: canonical
  audience:
    - engineering
    - architecture
  visibility: public
  status: active
  owner: docgov
  documents:
    - "core/**"
    - "bin/docgov"
  relationships:
    implements:
      - docgov-prd
    depends_on:
      - docgov-feasibility
  review:
    cadence: 90d
    last: 2026-09-13
  generation:
    mode: human-maintained
---
# Architecture

## Purpose

DocGov is a control plane around a repository's documentation. This document explains how it
is built and which boundary every change has to respect.

## Context

Documentation rots in agentic repositories because documents are produced faster than any
review process can keep them coherent. DocGov's answer is to make the *relationships* between
intent, contracts and code machine-checkable, rather than to generate more prose.

The shape of the solution was forced by two facts about Claude Code, both established in
[FEASIBILITY.md](FEASIBILITY.md):

1. **Hooks can only run shell commands.** They cannot invoke a skill or a tool. So the
   governance engine has to be a binary, not a prompt.
2. **A hook runs on every edit.** Anything in that path has to cost milliseconds, which rules
   out a model call.

## Components

```
                      Claude Code
                           │
        ┌──────────────────┼───────────────────┐
        │                  │                   │
     hooks/            skills/ (11)        agents/ (4)
   3 enforcement      thin: call the      judgement only,
       rings           CLI, interpret     always advisory
        │                  │                   │
        └──────────────────┼───────────────────┘
                           ▼
                     bin/docgov
              argument parsing · hook protocol
                           │
                           ▼
                        core/
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
    taxonomy +        one snapshot        decisions
  config (policy      inventory →      check · drift ·
    as data)        document → graph   impact · migrate
                     paths (shared
                      predicates)
                           │
                           ▼
                      .docgov/
            config · registry · graph · suppressions
```

**`core/` decides what blocks.** Deterministic, no network, no model. It is allowed to fail CI
because it can always show its reasoning.

**`skills/` and `agents/` decide what is subjective.** They only ever propose. A model never
decides whether `docgov.id` is duplicated; software never decides whether prose is clear.

**`bin/docgov` is the only interface**, and it serves three callers on one implementation:
skills via `--json`, hooks via `docgov hook <event>` speaking the hook JSON protocol, and CI
via exit codes. That is deliberate — a governance decision must not differ between the editor
and the pipeline.

## Data flows

**Per command.** `config.load` → `inventory` (one filesystem walk) → `Document` objects →
`registry.build` → `graph.build` → the command. Nothing re-reads a file after the snapshot, so
a single run cannot observe two versions of the repository.

**Per write, in the editor.** `PreToolUse` → `docgov hook pre-tool` → route on the path:
markdown goes to the documentation gate, code goes to invariant injection. Either returns a
deny with a reason, or context, or nothing. ~95 ms, node startup included.

**Per change, at review time.** `git diff` → graph lookup → impacted documents → narrowed
review packets with the diff hunks attached → an agent reads kilobytes instead of the repository.

## Key decisions

| Decision | Why |
|---|---|
| Deterministic core, thin model layer | Required, not merely preferred: hooks cannot call skills. It also makes governance unit-testable instead of buried in prompts. |
| Zero dependencies, no build | The plugin has to work from a `git clone` with no install and no network. `core/yaml.js` is a strict subset that throws rather than guess. |
| Three enforcement rings | A tool that blocks a README typo gets uninstalled. Most rules warn; only the unambiguous ones block, and how many depends on project mode. |
| Drift reports facts, not verdicts | "This document is now unverified" is decidable. "The prose contradicts the code" is not, and claiming otherwise would cost more trust than the feature is worth. |
| Narrow, then ask | Contradiction detection across 100 documents is ~5,000 model pairs. Local tf-idf gets to ~20 candidates first. |
| Git is the audit log | No parallel history. Migration is revertible because git makes it so, which is the only honest basis for "without losing information". |
| The graph decides relevance, not a file-extension list | A mapping lookup asks "does a document claim this path?", and the graph answers it. Gating that on a list of source extensions discarded every extensionless executable, shell script and Dockerfile a document had explicitly mapped — `bin/docgov` included, so the engine could not see changes to itself. Extension lists are for heuristics only, where a false negative is free. |
| The CLI sets `process.exitCode`, never `process.exit()` | When stdout is a pipe its writes are asynchronous, and `process.exit()` discards whatever has not flushed — silently truncating any output past the 8 KB pipe buffer, which `types --json` exceeds. Letting Node exit on its own drains stdout first. The exit code is the contract; killing the process early breaks the output that carries it. |
| Generation is a property of a document, not of its class | Marking a whole class generated made `create` stamp `generation.mode: generated`, which the `generated-edit` check then blocked — so the Reference class could not be used for the hand-written case at all. Generated *paths* remain the real guard. |
| Policy packs, not a service | Organizational governance ships as git-distributed config. A backend would contradict the local-first promise. |

## Where to go next

- [development.md](development.md) — the module map, how to run it, how to debug a hook
- [engineering/testing.md](engineering/testing.md) — what is covered and what deliberately is not
- [FEASIBILITY.md](FEASIBILITY.md) — the six places the specification does not survive contact with the platform
- [product/PRD.md](product/PRD.md) — the full specification
