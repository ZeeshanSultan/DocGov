---
docgov:
  id: testing-strategy
  type: engineering.testing
  authority: canonical
  audience:
    - engineering
  visibility: public
  status: active
  owner: docgov
  documents:
    - "test/**"
  relationships:
    depends_on:
      - development
  generation:
    mode: human-maintained
---
# Testing strategy

## Levels

One level: integration tests over the real engine, in
[test/docgov.test.js](../../test/docgov.test.js).

There is no unit layer and no mocking layer, on purpose. The modules are pure functions over
a filesystem snapshot, so calling them directly *is* a unit test; and the bugs that actually
shipped in this codebase were in how git, paths and markdown behave in reality, which a mock
would have hidden. Tests that touch git build real temporary repositories with `tmpRepo()`,
commit real files, and run the real binary as a subprocess.

## What we test

- **Every decision that can block.** Duplicate ids, generated-tree edits, visibility-path
  violations, unparseable frontmatter, exit-code semantics, and the mode profiles that decide
  which of those block.
- **The drift contract, both directions.** Forward drift fires when mapped code moves and the
  document does not; it does *not* fire when they move together; reverse drift fires when a
  specification moves alone. Finding ids are stable across runs, because suppressions depend on it.
- **Migration end to end.** Documents move, links are repaired in both directions, the result
  verifies, and an unclassifiable document is left alone rather than guessed at.
- **The hook protocol as a subprocess.** Denials, context injection, silence on ungoverned
  paths, and failing open on a malformed payload.
- **Every template against its own gate.** The test *every document class produces a document
  that satisfies its own gate* is what keeps 57 classes honest — adding a class with mismatched
  sections fails immediately.
- **Parsers at their edges.** YAML round-trip identity, refusal of unsupported constructs,
  headings inside code fences, ordinal-prefixed headings.

Each of these exists because it either caught a real defect or guards a promise made in the
README. A test that guards nothing is deleted.

## What we do not test

- **Anything a model decides.** Lens judgements, contradiction verdicts and quality scores are
  not deterministic and asserting on them would test the model, not DocGov. The lenses and
  agent prompts are reviewed as prose.
- **Output formatting.** Table alignment and wording change freely. `--json` shape is what
  consumers depend on, and *that* is asserted.
- **Third-party tools.** Capability discovery is tested for its probe logic, not by installing
  lychee or Vale.
- **Performance, as a gate.** The ~95 ms per-edit budget is measured when the hook path
  changes, not asserted — a timing assertion on shared CI is a flaky test wearing a useful label.

## Tooling

`node:test` and `node:assert/strict`. No framework, no runner, no fixtures directory, no
snapshots. The test file is readable top to bottom and every helper is in it.

```bash
npm test
node --test --test-name-pattern='migrate' test/*.test.js
```

## Gates

Both must pass before merge, and CI runs them in this order:

1. `npm test` — every test.
2. `./bin/docgov check` — DocGov governing its own repository. Exit 1 fails the build; exit 2
   (drift) is reported but does not.

A new non-trivial code path arrives with one test that fails if the logic breaks. Not a suite
per function — the smallest check that would have caught the bug.
