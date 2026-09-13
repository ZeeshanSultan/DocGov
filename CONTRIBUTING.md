# Contributing

The most valuable contributions are **false positives and false negatives** — a rule that
fired on documentation people consider fine, or drift DocGov missed. Those decide whether
anyone keeps the plugin installed, and they are much harder to find than new features.

## Before you start

One rule governs every change here, and it is the whole architecture:

> **Software decides what blocks. A model decides what is subjective. Neither crosses over.**

`core/` is deterministic and has no model calls. It is allowed to fail CI because it can
always show its reasoning. `skills/` and `agents/` handle judgement and only ever *propose*.
A PR that puts a model's opinion behind a blocking gate will be declined regardless of how
good the opinion is — see [docs/FEASIBILITY.md](docs/FEASIBILITY.md) §3.6 for why.

Two more constraints worth knowing before you write code:

- **Zero dependencies.** Node 20+ stdlib only. The plugin has to work from a `git clone`
  with no install step and no network. If something needs a library, it probably needs less code.
- **Enforcement is a cost.** Every rule that blocks buys correctness with someone's patience.
  Propose rules as warnings unless they are unambiguous.

## Development setup

```bash
git clone https://github.com/ZeeshanSultan/DocGov.git
cd DocGov
npm test                 # 60 tests, no install needed
./bin/docgov health      # DocGov governing itself
```

There is no build step. `core/` is plain ESM; `bin/docgov` runs it directly.

To use your working copy as the plugin:

```bash
claude plugin marketplace add .
claude plugin install docgov
```

See [docs/development.md](docs/development.md) for the module map and how to work on each layer.

## Submitting changes

1. **Write the test first if the logic is non-trivial.** The test that matters is the one that
   fails when the logic breaks, not the one that passes when it works. Tests run against real
   temporary git repositories — see `tmpRepo()` in `test/docgov.test.js`.
2. **Run the gates.** `npm test` and `./bin/docgov check`. DocGov governs its own repository,
   so a documentation change has to satisfy the rules it ships.
3. **Say where your rule produces a false positive.** Every rule has cases. Naming them is how
   we decide whether it blocks, warns, or belongs in a lens instead.
4. **Keep the diff shaped like the change.** A reviewer should be able to tell what you did
   from the diff without reading the description.

### Adding a document class

Add it to `TYPES` in [core/taxonomy.js](core/taxonomy.js) with its authority, lens, locations
in both layouts, limits and required sections. Add classification signals to
[core/classify.js](core/classify.js). A hand-written template in `templates/<type>.md` is only
needed when the section headings alone are not enough scaffolding — otherwise it is synthesized.

The existing test *every document class produces a document that satisfies its own gate* will
tell you if you got it wrong.

### Adding a rule

Add it to `RULES` in [core/check.js](core/check.js) with a severity, emit it from `run()`, and
decide which `MODE_PROFILES` block it in [core/config.js](core/config.js). If it should also
run before a write lands, add it to `preWrite()` — that path must stay fast, since it runs on
every edit.

## Review process

Expect a response within a week. Reviews focus on four things, in order:

1. Does it keep the deterministic/subjective line intact?
2. Is there a test that fails if the logic breaks?
3. Does a new rule earn the noise it makes?
4. Does it stay dependency-free and build-step-free?

Small, focused PRs get merged. A PR that changes the taxonomy, the authority model or the
frontmatter schema is a breaking change for everyone's repository, so open an issue first and
let us agree on the shape before you write it.

Participation is covered by the [code of conduct](CODE_OF_CONDUCT.md). By contributing you
agree your work is licensed under the [MIT License](LICENSE).
