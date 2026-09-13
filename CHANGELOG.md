# Changelog

All notable changes to DocGov. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

DocGov is at 0.x, so a **minor** bump may break compatibility — semver permits it and this
is young enough to need the room. Two things count as breaking, because people's repositories
depend on them: a change to `docgov.id` semantics or to the frontmatter schema, and a rule
moving from warning to blocking in an existing project mode. Either will be called out here
with a migration note.

## [Unreleased]

### Added

- **Every persisted artifact declares a version, and every read checks it.** Config, the
  registry, the graph, suppressions, the fix plan, the checklist and the capability registry
  each carry a top-level `version`; so does every `--json` document — findings, the context
  pack, health and the rule set — because a skill, a hook or a CI job parses those, and a
  shape someone else's code parses is a contract whether or not it was saved to disk.
  Versions live in one place, `core/schema.js`.

  Several files already said `version: 1` and nothing ever read it back, so a future DocGov
  writing version 2 would have been silently misread by an older build rather than refused.
  Now: a file from a **newer** DocGov is refused outright, naming both versions; a file with
  **no** version predates the check, is treated as version 1, and keeps working — that is
  every repository which adopted DocGov before this existed, and none of them break. The fix
  plan is the case that mattered most, being the only artifact DocGov both writes and reads
  and the only one whose misreading moves files; `fix` and `inspect contradictions` now share
  one checked loader so neither can skip it.

  No version has been raised, so there is nothing to migrate. The compatibility policy —
  when to raise a number, and what a raise obliges you to ship with it — is written down in
  [CONTRIBUTING.md](CONTRIBUTING.md#changing-a-persisted-format). The field is `version`
  rather than `schemaVersion` because that is what the files already in the wild say.

- **`create` searches before it creates.** It only ever checked whether its own target path
  was taken, so `docgov create user.guide "Setup"` cheerfully wrote a fourth setup guide
  beside `docs/getting-started.md` — well-formed, correctly typed, in the right directory,
  and a second source of truth. It now asks who already owns the topic first. It refuses
  where software can decide it: a single-document class that is already held, or an existing
  document of the same class already named for everything you asked for. Where the names
  merely share vocabulary it names the candidates and writes the document anyway, because
  whether "Setup" and "Getting started" are one responsibility is a judgement call.
  `--force` overrides a refusal.
### Changed

- **`docgov doctor` also checks that every source directory is published.** Splitting the CLI
  put `cli/` outside `package.json` `files`, which would have shipped a binary importing a
  directory that was not in the tarball — visible only on an install.
- **`bin/docgov` is a dispatcher, not the whole CLI.** It was 1,394 lines of parsing,
  formatting, every command and the entire hook protocol, with `flags` and `JSONOUT` as module
  globals that every function could read and no signature named — which is what made it the
  one file a mechanical edit could not be trusted on. Now 93 lines; the rest is `cli/parse.js`,
  `cli/output.js`, `cli/context.js`, `cli/hooks.js` and `cli/commands/{adopt,author,verify,
  state}.js`, grouped by what the user is doing. Commands take their flags as an argument and
  output mode is configured once. No behaviour changed: every command's output was diffed
  byte-for-byte against the previous build across three repositories, along with the hook
  protocol and the plans `review` writes.

- **The fix plan is grouped by what it asks of you**, not by what kind of action each one is,
  and it leads with the shape: `SAFE` / `HIGH CONFIDENCE` / `NEEDS REVIEW` with a count each.
  Two thousand actions in one undifferentiated list read as "this tool wants to rewrite my
  repository" and nothing on the page said which tenth needed a decision. The tier is derived
  from data every action already carried; nothing about what `fix` executes has changed. Each
  action carries its `tier` in the JSON. The old Risk table is gone — it was the same fact,
  said twice.

- **`docgov doctor` — is any of this actually working?** Fourteen checks, each of the form
  *does this file still agree with that one*: hooks naming events the CLI implements and
  pointing at files that exist, skills whose `name:` matches their directory, plugin options
  the engine actually reads, manifests agreeing on a version, stored artifacts still readable,
  the registry not pointing at deleted files, and `.claude/rules/documentation.md` agreeing
  with the config that generated it. A hook is invisible when it works and mystifying when it
  does not; none of these failures is a bug in any one file, so no test of one file sees them.
  Exit 0 clear, 2 to look at, 1 broken. It found two live problems on its first run.
- **`docgov setup --rules`** regenerates `.claude/rules/documentation.md` and touches nothing
  else. It is generated but committed, so it does not self-heal when the mode or layout
  changes — and the only repair before this was `setup --force`, which rewrites
  `.docgov/config.yaml` from scratch and takes every registration and domain with it.

- **`docgov judge` records what a model concluded, as a different kind of object.** Software
  decides what blocks and a model decides what is subjective; the risk was never that the two
  were stored together but that they *rendered* the same. Judgements live in
  `.docgov/judgements.json`, print in their own JUDGEMENT section, are a separate array in
  `check --json` rather than entries in `findings`, and never change an exit code.
  `deterministic: false`, `blocking: false` and `source: "model"` are set on write and
  re-applied on read, so an agent cannot mark its own opinion as a rule even by editing the
  file. `confidence` and `evidence` are mandatory — a verdict without them is refused, not
  stored.
- **`brief` compiles a pack instead of retrieving one.** It opens with a map — what governs
  this area, the invariants in force, the code claimed, what derives from what, what is
  already known to be stale, and where two documents play the same role — so an agent handed
  twelve thousand characters knows what it is looking at in six lines. Every row is countable
  and points at a document in the pack. `KNOWN STALE` reads `unknown` outside a git
  repository, which is not the same as `none`.
- **`brief --explain`** says what happened to every document it considered: selected,
  headings-only because the budget ran out before its body, or rejected with the reason. The
  same trace is in `--json` as `decisions`. A pack that comes back too thin or too wide used
  to be a guess.
- **`create --check`** answers the ownership question and writes nothing — what an agent
  should run before it decides. Exits `0` for `create-new` and `2` otherwise, so a script can
  branch on the exit code; `--json` adds the owner, the candidates, the required sections and
  the size limit.

## [0.2.4] — 2026-09-13

Classification. Across three repositories DocGov had never seen, 86-96% of
documents had no classification anyone should act on — and the reason was not
that the documents were unclear.

    chainsaw     91% → 32% without a trustworthy classification
    DefectDojo   96% →  3%
    ShellPilot   66% → 59%   (no generated documentation site)

Every newly-confident classification was checked by hand rather than inferred
from a number moving.

### Fixed

- **Every location signal described DocGov's own canonical layout**, so
  structural evidence fired only on a repository that had already adopted
  DocGov — exactly not the case adoption is for. The Diátaxis names DocGov
  already says it adopts, and the trees Hugo, Docusaurus and MkDocs generate
  from, are now recognised, weighted below the canonical globs so an adopted
  layout still wins on its own terms.
- **Evidence was scored without regard to its kind.** Where a document sits and
  what it is called are decisions somebody made about what it is; a regex
  matching its prose is a guess. A correct path match scoring 54 and a branching
  model misread as a runbook scoring 45 were indistinguishable under one
  threshold. Structural evidence now decides trustworthiness; prose still scores
  and can break a tie, but cannot carry a type alone. Measured across the three,
  269 of 278 doubtful classifications rested on structural evidence and were
  right, while the content-only ones were wrong.
- **A filename pattern found somewhere in a path is a hint, not a decision.**
  `integration` matches `docs/content/en/integrations/parsers/api/cobalt.md`,
  which is a user's import guide. Treating that as structural made 188 documents
  confidently wrong, which is worse than leaving them flagged.
- **Ambiguity was measured against a rival that did not exist.** With one
  candidate the gap was its own score, so an unrivalled classification scoring
  11 was reported as a close call against nothing.

### Added

- **A generated documentation site is recognised, and never relocated.** A
  content tree is, by the site's own configuration, the documentation a project
  publishes, but its sections are named for readers — `ai-assistant/`,
  `cli-reference/`, `errors/` — so no naming convention reaches them: one
  repository had 363 such pages matching nothing at all. They are classified
  from where they sit, and then left there, because a page's path inside a
  content tree is its URL and the navigation, section indexes and inbound links
  are built from it. Recognising them without anchoring them proposed moving 287
  pages out of one tree, which does not tidy a site up — it publishes a
  different one. DefectDojo's plan went from 291 proposed moves to 4, none of
  them out of the content tree.

## [0.2.3] — 2026-09-13

`docgov fix` could not produce a runnable plan on any of the three repositories
it had been tried on. All three now can.

### Fixed

- **The destination rule collided with itself.** `<canonical dir>/<basename>`
  discards the directory a document came from, so any two documents sharing a
  basename resolved to the same path — and `fix` refuses to move two documents
  onto each other. One repository produced 29 such collisions, which made its
  entire plan unrunnable. Where the class has a directory, enough of the source
  path is now kept to tell them apart: `core/docs/policy.md` becomes
  `…/policies/core/policy.md`. The leading segment is used because in a monorepo
  it names the module. A fixed-path class cannot be disambiguated — only one
  document can be *the* changelog — so one holds it and the rest are left in
  place for a human, and a destination already occupied by a document that is
  staying is never taken.
- **One unreadable document aborted the whole migration.** `patchDocgov`
  re-parses the file it is annotating and threw, so two files out of 299 stopped
  every other document from being migrated. Those documents are now left alone
  and named with the parser's own message; a skip is never silent. Refusing to
  guess at frontmatter is unchanged.
- **Test fixtures are no longer governed as documentation.** A README inside a
  fixture describes the fixture, and moving it out breaks the test that resolves
  paths into that tree. `testdata/`, `fixtures/`, `__fixtures__/` and
  `__snapshots__/` are excluded.

### Added

- **`review` says when a plan cannot run.** Destination collisions were only
  discovered by `fix`, at execution, after the plan had been read and approved.
  They are now named in the finding table, the closing summary and the plan
  itself, with both sides flagged as needing a human — though after the fix
  above there should rarely be any left.

### Verified

    fix --dry-run     chainsaw  exit 0    DefectDojo  exit 0    ShellPilot  exit 0

All three were refusing before this release.

## [0.2.2] — 2026-09-13

Nine bugs, found by running DocGov over three repositories it had never seen —
a 1,045-document Go monorepo, a 42-document Electron app, and a 299-document
Python project with a Hugo documentation site. Every one of them was in link
resolution, and every one was invisible in DocGov's own repository, whose
documentation happens to use none of the conventions involved.

The headline: `broken-link` is the highest-severity check, and on a real
repository it was mostly wrong.

    chainsaw     1,304 → 181
    DefectDojo     110 → 4
    ShellPilot       1 → 0

Every surviving finding on all three was confirmed by hand. The four left on
DefectDojo are one authoring mistake repeated — label and target swapped.

### Fixed

- **The inventory's file set was treated as truth.** It holds no directories,
  and skips dotfiles and untracked source files, so `./core/`, `.golangci.yml`
  and `core/coverage/gate.go` were all reported broken while existing. A miss is
  now confirmed against the filesystem; the stat runs only on misses.
- **Link destinations stopped at the first `)`.** CommonMark allows balanced
  parentheses, and Next.js route groups put them in real paths:
  `app/(dashboard)/billy/` was captured as `app/(dashboard`. Angle-bracketed
  destinations are parsed now too.
- **Five resolution conventions had no fallback**: static-site permalinks,
  repo-root-relative paths, directories, dotfiles and `file.go:43` line
  references. Each is tried only after the previous misses, and each still
  requires the target to exist.
- **A link that climbs out of the repository is not an internal link.** GitHub
  resolves it against the repository URL — which is how the
  private-vulnerability-reporting link GitHub documents is written,
  `[report](../../security/advisories/new)`.
- **Documentation sites resolve links against the rendered URL, not the file
  path.** `static/` is served at the site root; a page renders as its own
  directory, so `../sibling/` is a sibling of the page; the trailing slash is
  optional. On a Hugo site this was 106 of 110 findings — 93 of them every
  image in the tree.
- **A misplaced singleton was deleted rather than classified.**
  `docs/CODE_OF_CONDUCT.md` came back `unknown`, "no signal matched", when being
  in the wrong place is what should have been reported. Off-canonical singletons
  are demoted, not dropped; a nested README still loses to `docs.index`.
- **Layout relocated documents other tools locate by path.** `full` layout sent
  SECURITY.md to `docs/11-external/`, SUPPORT.md into `docs/09-governance/`, and
  every agent-instruction file onto CLAUDE.md — a collision, not a move. GitHub,
  Claude Code, Gemini CLI, Cursor and Copilot each hard-code a path.
- **GitHub templates were governed in one spelling but not the other.** The
  exclude carried `PULL_REQUEST_TEMPLATE.md`; a repository spelling it
  `pull_request_template.md` had a `docgov:` block proposed for the top of every
  pull request description.
- **`\b` treats a hyphen as a word boundary**, so the runbook signal matched the
  dependency `memory-pager` in a licence table and classified
  THIRD-PARTY-NOTICES.md as operations documentation.

### Added

- `governance.attribution` — NOTICE, THIRD-PARTY-NOTICES, ATTRIBUTIONS, CREDITS.
  Unclassified, they were proposed for `docs/10-internal/`, which would hide a
  public legal notice and mark it internal.
- `.githooks`-style protection for the paths other tools read: agent-instruction
  files keep their own filename instead of resolving onto CLAUDE.md.
- 11 regression tests, each verified to fail without its fix.
- Counts that drift are gone from the prose. The number of document classes was
  written into six files and was wrong three separate times in one day; the test
  count was wrong in three. Neither number told a reader anything `docgov types`
  and `npm test` do not.

## [0.2.1] — 2026-09-13

Everything here was found after 0.2.0 was published, by testing the Node 20 lower bound
`package.json` has always declared.

### Fixed

- **`--json` output over 8 KB was silently truncated on Node 20.** The CLI called
  `process.exit()`, which discards asynchronous stdout writes that have not flushed — so
  piping anything larger than the pipe buffer, `docgov types --json` included, produced JSON
  that ended mid-string. It now sets `process.exitCode` and lets Node exit once stdout has
  drained. It reproduced on Node 20 and never on 22.
- **The Reference class could not be used for a hand-written document.** Marking a class
  `generated: true` made `create` stamp `generation.mode: generated`, which the blocking
  `generated-edit` check then guarded — so a CLI reference or a hand-written configuration
  reference had nowhere to live. Generation is now a property of a document, declared in its
  frontmatter; generated *paths* remain the real guard, and both still block correctly.

### Added

- **CI tests Node 20 as well as 22**, in a job separate from the one that comments on pull
  requests, so a matrix cannot race `gh pr comment --edit-last`. It paid for itself on the
  first run.
- **`examples/demo.sh`** — builds a deliberately messy repository and runs `setup`, `review`,
  `health` and `fix --dry-run` against it. A real run, nothing pre-baked.
- The taxonomy is 59 document classes, not 57; the count was stale in six places.

## [0.2.0] — 2026-09-13

### Changed

- **Every command was renamed.** Breaking, deliberately, and without aliases — nothing depends
  on the old names yet and they were the single biggest barrier to anyone understanding this
  tool. `init` and `onboard` in particular were indistinguishable to a first-time reader, and
  `organize` described something it has never done: it adds frontmatter and has never moved a
  file.

  | Old | New | |
  |---|---|---|
  | `init` | `setup` | |
  | `onboard` | `review` | it reviews the docs you have and writes a plan |
  | `migrate` | `fix` | it executes that plan |
  | `review` | `inspect` | the LLM review packets; sub-argument `drift` is now `stale` |
  | `organize` | `tag` | it adds frontmatter, nothing more |
  | `suppress` | `ignore` | |
  | `manifest` | `checklist` | |
  | `classify` | `whatis` | |
  | `drift` | `stale` | |
  | `impact` | `affected` | |
  | `context` | `brief` | |
  | `capabilities` | `tools` | |
  | `invariants` | `rules` | |

  Slash commands moved with them: `/docgov:onboard` is now `/docgov:review`, and so on.

  State files moved too: `.docgov/onboarding-plan.{md,json}` → `.docgov/fix-plan.{md,json}`,
  `.docgov/manifest.yaml` → `.docgov/checklist.yaml`, `.docgov/capabilities.json` →
  `.docgov/tools.json`. The `manifest` key in `affected --json` and `checklist --json` is now
  `checklist`.

  **Migrating:** delete `.docgov/onboarding-plan.*` and re-run `docgov review`. Nothing else
  carries over, and nothing else needs to.

- **The README was rewritten for the people who actually use this.** It was 184 lines of
  architecture written for someone who already knew what a documentation authority graph was.
  It is now 130 lines that answer what this is, what it looks like running, and how to start —
  and it passes `lenses/readme.md`, which it previously did not.
- One product description now, used everywhere, instead of five different ones across the
  README, `package.json`, the plugin manifest, the marketplace manifest and the CLI banner.

- **The `rules` collision was removed at the root, not papered over.** `docgov rules` now means
  one thing. What `check` reports are **checks**, not rules: `RULES` became `CHECKS`, the
  finding field `rule` became `check`, and the summary key `byRule` became `byCheck` — so
  `docgov check --json` now emits `"check"` where it emitted `"rule"`. DocGov's own `rules/`
  source directory became `policy/`. The install destination stays `.claude/rules/`, which is
  Claude Code's namespace rather than DocGov's. Suppression ids are unaffected: they hash the
  finding's *value*, not the field name.
- **The PRD was rewritten and split.** It was 1,808 lines of pasted chat transcript — no
  headings, no code fences, `⸻` separators, opening mid-conversation — which is why it was
  failing its own size limit and reporting 13 missing sections. It is now a 276-line
  requirements document with all 13 sections, plus [vision](docs/product/vision.md),
  [roadmap](docs/product/roadmap.md) and six specification parts under
  [docs/product/prd/](docs/product/prd/README.md). All 27 original goals and 9 non-goals are
  preserved; only the chat preamble was dropped.
- The roadmap no longer describes V1/V2/V3. V1 and V2 both shipped in 0.1.0, so it now states
  what is actually shipped, next, later and not planned.

### Added

- **Published to npm as `docgov-cli`.** npm refuses the name `docgov` as too similar to
  `docco` and `doctoc`, so the package carries the `-cli` suffix. The binary it installs is
  still `docgov`, and the Claude Code plugin is still `docgov` — those are separate namespaces.
- **Two document classes the taxonomy was missing.** `governance.code-of-conduct`, because
  `CODE_OF_CONDUCT.md` is one of the six standard community health files and the taxonomy could
  only classify it as a Policy belonging in `docs/governance/` — where a code host will not
  render it. And `release.changelog`, because Keep a Changelog structures a changelog by release
  rather than by fixed sections, and DocGov adopts established conventions rather than competing
  with them.
- **DocGov's own repository now passes `docgov check --all` with no findings at all** for the
  first time.

- `docs/reference/commands.md` — every command documented: what it does, its flags, what it
  writes to disk, and its exit codes.
- `version` and `help` now appear in `docgov help`, which they never did.
- `--version` / `-v` and `--help` / `-h` as aliases for the `version` and `help` commands.

### Fixed

- **`checklist --write` could not be turned off.** The guard tested `flags.write !== false`,
  but `--no-write` sets `flags.no_write` and `--write false` yields the string `'false'`, so
  neither route worked and the file was always written. `--no-write` now works.
- `core/migrate.js` hardcoded `.docgov/onboarding-plan.json` in its collision error instead of
  using `PLAN_DATA_PATH`, printing a wrong path in the one message you see at exactly the
  moment you need to edit that file. It imports the constant now.
- The README claimed 56 document classes and 60 tests. There are 57 and 63.
- **Stale and affected were blind to extensionless files.** Both gated their graph lookup on a
  source-extension list before asking whether any document claimed the path, so every
  extensionless executable, shell script, `Dockerfile` and `Makefile` a document had
  explicitly mapped was silently skipped — DocGov's own `bin/docgov` included, meaning the
  engine could not see changes to itself. The mapping lookup now consults the graph directly;
  extension matching is confined to the "did behaviour change" heuristic, where a false
  negative costs nothing. Path predicates now live once in `core/paths.js`.

## [0.1.0] — 2026-09-13

First release. Complete and tested, but unproven outside its own repository —
hence 0.1.0 rather than 1.0.0.

### Added

- **Taxonomy** — 57 document classes across 8 authority tiers, each with a canonical
  location, required sections, size limits, visibility default and review lens. Every
  field overridable from `.docgov/config.yaml` or a policy pack.
- **Authority model** — `constitution > canonical > requirements > contract > code >
  generated > audience > historical`, with structural violations detected rather than
  merely discouraged.
- **Documentation graph** — ten typed relationships with automatic inverses; internal
  markdown links become inferred edges, so the graph is useful before anyone declares one.
- **Invariant injection** — invariants written in canonical documents are parsed into
  first-class objects and injected into any agent editing the code they govern.
- **Drift detection** — forward, reverse, contract and dependency drift, plus semantic
  staleness scored from surrounding change rather than from age.
- **Impact analysis** and the change manifest, with a PR-ready report.
- **Context packs** — minimal authority-ordered context for a topic.
- **Transactional migration** — plan first, execute on a branch, repair every internal
  link in the same operation, verify, and revert on failure.
- **Publishing analysis** — leak detection and external-lens rewrite briefs. Never publishes.
- **Three enforcement rings** — a ~95 ms CLI gate on every write, one prompt hook on new
  documents, subagents for review. `solo` blocks 3 rules, `enterprise` blocks 12.
- **Adoption ramp** — `init` starts in `warn_only` when documentation predates DocGov, so
  switching governance on does not fail the next build.
- 11 skills, 4 agents, 7 audience lenses, JSON Schema for frontmatter and config.
- **Policy packs** for organizational governance, distributed as git rather than a service.
- **External registration** — `documentation.registrations` governs a document from config
  instead of a frontmatter block, so the files GitHub renders on a project's front page do not
  open with a metadata table.
- Zero dependencies; 60 tests against real temporary git repositories.

### Known limits

- Symbol-level drift is reported as "this document is now unverified", which is a fact.
  Whether the prose contradicts the code is an agent's judgement and never a hard gate.
- Quality scores are advisory by construction.
- Migration requires git and a clean tree.
- Capability discovery is filesystem probing, not an API, so it will drift as the
  ecosystem changes. Absence always degrades to "DocGov does it itself".

[Unreleased]: https://github.com/ZeeshanSultan/DocGov/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ZeeshanSultan/DocGov/releases/tag/v0.1.0
