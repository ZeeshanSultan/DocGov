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
| Some documents are located by tools outside the repository | GitHub reads README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY and SUPPORT from the root; Claude Code reads CLAUDE.md, Gemini CLI GEMINI.md, Copilot `.github/copilot-instructions.md`. Their location is a contract with software nobody here controls, so layout never moves them. `full` layout used to send SECURITY.md into `docs/11-external/` and SUPPORT.md into `docs/09-governance/`, where GitHub stops finding either — a silent breakage dressed as a tidy-up. A class whose filename varies (agent instructions) is marked `anchored` and keeps its own; the rest simply resolve to the same path in both layouts. |
| Evidence has kinds, and only some of it confers confidence | Where a document sits and what it is called are decisions somebody made about what it is; a regex matching its prose is a guess. Scored on one scale they were indistinguishable, so a correct path match and a wrong prose match fell under the same threshold. Structural evidence now decides whether a classification is trustworthy; prose still scores, and can break a tie, but cannot carry a type on its own. A filename pattern that merely appears somewhere in the path is a hint too — `integration` matches a user's import guide. |
| DocGov only writes frontmatter it owns | Hugo accepts TOML (`+++`) and JSON frontmatter as well as YAML. The fence only matches YAML, so such a document looked like one with none, and annotating it prepended a YAML block *above* the real frontmatter — the site then reads the injected block and renders the original as body text, losing the page's title, weight and draft status. Those documents are left byte-identical and named. `patchDocgov` refuses outright, so no path can reach it. |
| A clean result means the scope was inspected | The sweep silently gave up on directories deeper than its limit, on directories it could not read, and on symlinks it does not follow. A "no findings" that was really "I could not look" is the worst output a governance tool can produce. Everything skipped is recorded and reported, in the human output and in `--json`. |
| Nothing writes outside the repository | Every path in a migration plan is validated to resolve under the repository root before the first action executes. The plan is an editable file, so anything that can write it can choose where a document lands; until this existed the boundary was held only by `git mv` refusing an outside path — incidental, and absent entirely on `--no-git`, where a hand-edited plan moved a file out of the repository. SECURITY.md claimed this guarantee before the code provided it. |
| An option that does nothing is worse than no option | `plugin.json` advertised three settings and the engine read none of them, including one that claimed to switch off the only thing leaving the machine. Claude Code passes `userConfig` to *command* hooks as `CLAUDE_PLUGIN_OPTION_<key>` and offers no way to gate a `prompt` hook, so `enforcement` and `session_briefing` are read from the environment where they apply, and `semantic_gate` was removed rather than left as a setting that silently did nothing. |
| A plan is approved where it is executed | The rendered plan told the reader to delete actions they disagreed with, and `fix` read the JSON — so deleting from the Markdown changed nothing and every action still ran. Actions carry a stable id, the Markdown is a view that says so, and `fix --skip DG-01234` drops one without editing either artifact. |
| A generated site is documentation, and its paths are its URLs | A static-site generator's content tree is, by the site's own configuration, the documentation that project publishes — but its sections are named for readers (`ai-assistant/`, `cli-reference/`, `errors/`), so no naming convention reaches them: one repository had 363 such pages matching nothing at all. Where they sit is the evidence. They are classified from it and then never relocated, because a page's path inside a content tree is its URL and the navigation, section indexes and inbound links are all built from it. Classifying them without anchoring them proposed moving 287 pages out of one tree, which publishes a different site. |
| Path signals described only our own layout | Every location signal named DocGov's canonical tree, so structural evidence fired only on repositories that had already adopted DocGov — exactly not the case adoption is for. Three unfamiliar repositories left 86-96% of documents without a trustworthy classification, not because the documents were unclear but because nobody had put them where DocGov expected. The Diátaxis names and the content trees Hugo, Docusaurus and MkDocs generate from are now recognised, weighted below the canonical globs so an adopted layout still wins on its own terms. |
| One unreadable document does not stop the rest | The YAML subset refuses what it cannot represent rather than guessing, which is right — but `patchDocgov` re-parsed the file it was annotating and threw, aborting the whole migration. Two files out of 299 left an entire repository ungovernable. `Document` already degrades by recording the error and carrying on; `fix` now matches it, skips those documents and names them with their error. |
| A destination keeps enough of its source to be unique | `<canonical dir>/<basename>` discards the directory a document came from, so two documents sharing a basename fought for one path — 29 on one repository, which made its whole plan unrunnable. Where the class has a directory, the leading source segment is kept: `core/docs/policy.md` becomes `…/policies/core/policy.md`. The leading segment is used because in a monorepo it names the module. A fixed-path class cannot be disambiguated at all, so one document holds it and the rest are left where they are for a human to decide. |
| A plan that cannot run says so while it is still a plan | `fix` refuses a destination collision, because two documents at one path destroys one of them — but it only discovered them at execution, after the plan had been read and approved. Three real repositories carried 29, 12 and 1; every one of those plans was unrunnable and nothing said so. They arise because two documents sharing a basename in different directories both resolve to `<canonical dir>/<basename>`. |
| A documentation site has its own link semantics | Inside a static-site content tree, a link is resolved against the *rendered URL*, not the file path: `static/` is served at the site root, a page renders as its own directory so `../sibling/` means a sibling of the page rather than of the file, and the trailing slash is optional. On a Hugo documentation site, checking the file path alone reported 110 broken links of which 4 were real — 93 of them every image in the tree. |
| A link out of the repository is not ours to judge | GitHub resolves a relative link that climbs above the repository against the repository *URL*: `[report](../../security/advisories/new)` in a root SECURITY.md is the private-vulnerability-reporting link GitHub itself documents. There is nothing on disk to check it against and it is not in the graph, so reporting it as a missing file was wrong twice over. |
| Tool configuration is not documentation | `.github/` issue and pull-request templates are rendered into a new issue or PR. Governing them would put a `docgov:` block at the top of every pull request description. They are excluded — in either case, because GitHub accepts both `PULL_REQUEST_TEMPLATE.md` and `pull_request_template.md` and the exclude previously matched only the first. |
| Links resolve by convention, not by one path | A link is broken only when nothing a human plausibly meant resolves. Directories, dotfiles, `file.go:43` line references, static-site permalinks and repo-root-relative paths are each tried after the document-relative path misses, and each still requires the target to exist. On a 1,045-document repository the single-path check reported 1,304 broken links where 189 were real. |
| `types` lists classes, not the fallback | `unknown` is where a document lands when classification fails; it is not something anyone creates. Listing it made `docgov types` report 60 where the taxonomy documents 59 — a one-off discrepancy between the tool and its own prose, which is exactly the drift this engine exists to catch. |
| Generation is a property of a document, not of its class | Marking a whole class generated made `create` stamp `generation.mode: generated`, which the `generated-edit` check then blocked — so the Reference class could not be used for the hand-written case at all. Generated *paths* remain the real guard. |
| Policy packs, not a service | Organizational governance ships as git-distributed config. A backend would contradict the local-first promise. |

## Where to go next

- [development.md](development.md) — the module map, how to run it, how to debug a hook
- [engineering/testing.md](engineering/testing.md) — what is covered and what deliberately is not
- [FEASIBILITY.md](FEASIBILITY.md) — the six places the specification does not survive contact with the platform
- [product/PRD.md](product/PRD.md) — the full specification
