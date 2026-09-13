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
  that satisfies its own gate* is what keeps 59 classes honest — adding a class with mismatched
  sections fails immediately.
- **Output that must survive a pipe.** `types --json` is larger than the 8 KB pipe buffer, and
  the test asserts both that it exceeds it and that it still parses. This guards a real bug:
  the CLI called `process.exit()`, which discards unflushed asynchronous writes, so on Node 20
  every `--json` payload over 8 KB arrived truncated mid-string.
- **Parsers at their edges.** YAML round-trip identity, refusal of unsupported constructs,
  headings inside code fences, ordinal-prefixed headings.
- **Path predicates, in both directions.** That the mapping predicate is broad enough to
  cover the extensionless executables, Dockerfiles and assets a document maps, and that the
  behaviour heuristic stays narrow enough not to call a CSV a code change. This pair had a
  real bug: drift gated its graph lookup on a source-extension list, so `bin/docgov` was
  invisible to the engine governing it.

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
node --test --test-name-pattern='fix' test/*.test.js
```

CI runs the suite on Node 20 and Node 22, because `package.json` declares `>=20` and an
untested lower bound is a guess. That matrix is a separate job from the governance job, which
comments on the pull request — two matrix runs would race the same `gh pr comment --edit-last`.
It earned its place immediately: the pipe-truncation bug above reproduced only on 20.

## Gates

Both must pass before merge, and CI runs them in this order:

1. `npm test` — every test.
2. `./bin/docgov check` — DocGov governing its own repository. Exit 1 fails the build; exit 2
   (drift) is reported but does not.

A new non-trivial code path arrives with one test that fails if the logic breaks. Not a suite
per function — the smallest check that would have caught the bug.
