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
  that satisfies its own gate* is what keeps every class honest — adding a class with mismatched
  sections fails immediately.
- **That a published document whose source moved is reported at high severity**, naming the
  relationship in words, and that adding a relationship type does not require editing a second
  list to stop it being called invalid.
- **That a superseded document is withheld from a context pack and named**, and that its prose
  never reaches the agent — the assertion that matters is the last one.
- **That every persisted artifact declares a version**, that one from a newer DocGov is
  refused with a message naming both versions, and that a file predating the check still
  loads — the last is the one that matters, because it is every existing adopter.
- **That every `--json` output declares one too**, asserted by running each command rather
  than by reading the source, so a new output cannot be added without one going unnoticed.
- **That the fix plan is checked before `fix` or `inspect` acts on it** — refused when newer,
  accepted when unversioned, and named plainly when unparseable. This is the artifact whose
  misreading actually moves files.
- **That a page with TOML or JSON frontmatter comes out byte-identical**, and is named as
  left alone rather than silently skipped.
- **That a scan which could not see everything says so**, in both the human output and
  `--json`, whether or not there were findings.
- **That a hand-edited plan cannot escape the repository**, by relative traversal, an absolute
  path, or a normalised `docs/../../` — with and without git.
- **That every option the plugin advertises changes behaviour**, and that only options it can
  honour are declared.
- **That a generated documentation site is classified but never moved.** Both halves
  matter: the pages are recognised from the site config, and no action relocates one, because
  its path is its URL.
- **That prose alone never makes a classification trustworthy**, while a documentation
  layout somebody chose does — and that a lone candidate is not reported as a close call
  against a rival that does not exist.
- **That one bad document does not stop the rest.** A migration containing a document whose
  frontmatter the parser refuses still completes, still reports which it left alone, and does
  not touch the readable ones.
- **That a plan is runnable.** Two documents with one canonical destination get distinct
  paths rather than colliding, a fixed-path class keeps one holder and leaves the rest alone,
  and `fix --dry-run` exits 0 in both cases. The assertion that matters is the last one: a
  plan nobody can execute is not a plan.
- **That a plan says when it cannot run.** Two documents proposed for one destination, and
  a destination that already exists — `review` must name both, and flag the actions, rather
  than leaving `fix` to discover it at execution. Also that test fixtures and `testdata/`
  are not governed as documentation, because moving a fixture breaks the test that reads it.
- **Static-site link semantics.** That an image under `static/`, a section link without a
  trailing slash, and a page-relative `../sibling/` all resolve inside a content tree, while a
  target with nothing behind it is still reported. These are resolved against the rendered URL
  rather than the file path, and getting that wrong made every image on a documentation site
  look broken.
- **Signals that must not over-match.** That a hyphenated dependency name in a licence
  table (`memory-pager`) does not read as an on-call runbook, while a real runbook still
  does. `\b` treats a hyphen as a word boundary, which is how a third-party notices file
  was classified as operations documentation.
- **The paths other tools hard-code.** That no layout relocates README, CONTRIBUTING,
  CODE_OF_CONDUCT, SECURITY, SUPPORT, CLAUDE.md, AGENTS.md or GEMINI.md, and that the agent
  files resolve to three distinct destinations rather than collapsing onto CLAUDE.md. Each of
  those moves is invisible in this repository and breaks a different piece of software in
  someone else's.
- **Output that must survive a pipe.** `types --json` is larger than the 8 KB pipe buffer, and
  the test asserts both that it exceeds it and that it still parses. This guards a real bug:
  the CLI called `process.exit()`, which discards unflushed asynchronous writes, so on Node 20
  every `--json` payload over 8 KB arrived truncated mid-string.
- **Parsers at their edges.** YAML round-trip identity, refusal of unsupported constructs,
  headings inside code fences, ordinal-prefixed headings.
- **The difference between "none" and "unknown".** A context pack reports its contents'
  staleness as unknown when no git history was handed in, and the test asserts the word.
  Collapsing the two is how a tool ends up claiming a clean result it never established, and
  it is invisible in any test that only checks the happy path.
- **That a model cannot promote its own verdict.** A judgements file with `blocking: true`
  and `deterministic: true` written into it is loaded, flattened, and must still leave the
  exit code at 0. This is the one test that guards the separation the whole product rests on,
  and the failure it catches is silent: everything still renders, just in the wrong column.
- **That a presentation change still describes the code.** The plan's "needs review" tier is
  asserted against what `migrate` actually executes, not against the wording alone. A tier
  that said `fix` would skip a move it in fact performs would be a lie no test of the renderer
  on its own could catch.
- **The agreements between files, by breaking them.** `doctor`'s checks are tested against a
  deliberately broken plugin tree — a hook naming an event the CLI dropped, a skill whose
  `name:` no longer matches its directory, an option nothing reads, two manifests at different
  versions. Each is a failure that ships silently and that no test of a single file can see.
- **That a refactor changed nothing, by diffing it.** A pure restructuring is not verified by
  a passing suite — the suite only covers what it covers. Splitting the CLI was checked by
  running every command, the whole hook protocol and the plan writer against three real
  repositories on both builds and comparing the bytes. It found a path assumption the tests
  did not: `pluginRootOf` counted directories up from its caller.
- **That an extension point is still a boundary.** Custom document classes are tested for what
  they must refuse as much as what they allow: a shipped id, a malformed id, no paths, an
  unknown authority tier, a hard limit below the soft one. And the abstain case is asserted in
  the same test as the match, because a custom class that quietly became a catch-all would
  pass every test that only checked it classifies its own documents.
- **That a prompt still says what it is for.** The two review prompts are asserted on: that
  there are two of them, that each names its own false-positive tolerance, that every lens
  appears in the audience prompt, and that neither can block a write. Prompts are the one part
  of the system with no other test — nothing fails when a prompt quietly loses the sentence
  that made it conservative.
- **Both sides of a refusal.** `create` refusing a competing document is only worth having if
  it refuses the right ones, so the tests assert the false-positive side as hard as the true
  one: a narrower name is reported and still written, an unrelated name is written silently,
  and a superseded document does not block the replacement that supersedes it. A refusal test
  that only covers the refusal ships a tool nobody can create a document with.
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
