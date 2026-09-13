---
docgov:
  id: development
  type: engineering.development
  authority: audience
  audience:
    - engineering
  visibility: public
  status: active
  owner: docgov
  relationships:
    depends_on:
      - docgov-prd
  generation:
    mode: human-maintained
---
# Development

How to work on DocGov itself. For the rules of contribution see [CONTRIBUTING.md](../CONTRIBUTING.md);
this document is the map.

## Prerequisites

Node 20 or later, and git. That is all — there is no build step, no dependency install and no
toolchain. `npm test` works on a fresh clone.

```bash
git clone https://github.com/ZeeshanSultan/DocGov.git
cd DocGov
node -v        # 20+
npm test       # 60 tests
```

## Setup

Nothing to set up. `core/` is plain ESM and `bin/docgov` imports it directly.

To run your working copy as the plugin inside Claude Code:

```bash
claude plugin marketplace add .
claude plugin install docgov
```

Editing a file under `skills/` or `agents/` takes effect on the next session; editing
`hooks/hooks.json` needs `/reload-plugins` or a restart.

## Running

```bash
./bin/docgov help                 # the full surface
./bin/docgov health               # DocGov governing itself
./bin/docgov check --all          # every finding, including advisory
./bin/docgov graph --dot | dot -Tsvg > graph.svg
```

Every command takes `--json`, which is what the skills consume. When a skill behaves oddly,
run its underlying command with `--json` and read what it actually got.

To exercise a hook the way Claude Code does:

```bash
echo '{"cwd":"'$PWD'","tool_name":"Edit","tool_input":{"file_path":"'$PWD'/core/drift.js"}}' \
  | ./bin/docgov hook pre-tool
```

### The module map

| Layer | Where | Rule |
|---|---|---|
| Policy as data | [core/taxonomy.js](../core/taxonomy.js) | document classes, authority, relationships, limits. No logic. |
| Configuration | [core/config.js](../core/config.js) | defaults, mode profiles, policy-pack merge |
| One snapshot | [core/inventory.js](../core/inventory.js), [core/document.js](../core/document.js) | the filesystem is read once per run; nothing re-reads a file afterwards |
| Path predicates | [core/paths.js](../core/paths.js) | one definition of mappable / code / contract / test. Defined once on purpose: drift and impact each used to carry a copy, and they drifted apart |
| Derived state | [core/registry.js](../core/registry.js), [core/graph.js](../core/graph.js) | ids and edges |
| Decisions | [core/check.js](../core/check.js), [core/drift.js](../core/drift.js), [core/impact.js](../core/impact.js) | everything that may block |
| Judgement input | [core/context.js](../core/context.js), [core/find.js](../core/find.js), [core/health.js](../core/health.js) | what the model layer reads |
| Mutation | [core/migrate.js](../core/migrate.js) | the only module that moves files, and only under git |
| Interface | [bin/docgov](../bin/docgov) | argument parsing, output, and the hook protocol |

Two invariants hold across the engine, and breaking either one causes bugs that look like
something else:

- **INV-DG-001** No module in `core/` makes a network call or invokes a model. This is what
  lets `check` fail CI and what [SECURITY.md](../SECURITY.md) promises.
- **INV-DG-002** Every command builds its state from one `inventory()` call, so a single run
  cannot see two different versions of the repository.

## Testing

```bash
npm test                                             # all of it
node --test --test-name-pattern='drift' test/*.test.js
```

One file, [test/docgov.test.js](../test/docgov.test.js), using `node:test` and `node:assert`.
Tests that touch git build real temporary repositories via `tmpRepo()` — there are no mocks
for git, because the bugs worth catching live in how git actually behaves.

See [engineering/testing.md](engineering/testing.md) for what is covered and what deliberately is not.

## Troubleshooting

**A hook produces no output.** That is the success case: no output means no decision. To see
why, run the same command with the payload on stdin — errors go to stderr and the hook always
exits 0, so `2>&1` is how you find them.

**`check` reports documents you do not consider documentation.** Add them to
`documentation.exclude` in `.docgov/config.yaml`. Excludes accumulate over the defaults, so
you keep the built-in exclusions for agent infrastructure.

**The YAML parser refuses your config.** It is a strict subset and it refuses anchors,
aliases, tags, block scalars and tabs rather than guess. The error names the line. This is
deliberate: see [FEASIBILITY.md](FEASIBILITY.md) §4.

**`fix` refuses to run.** It needs git and a tree clean of everything except `.docgov/`.
The error lists the uncommitted paths.

**A classification is wrong.** Declare the type in frontmatter — a declared type always wins
over every heuristic. If the heuristic is wrong for a whole class of filenames, that is a bug
worth reporting.
