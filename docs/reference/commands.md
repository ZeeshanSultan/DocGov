---
docgov:
  id: commands
  type: user.reference
  authority: generated
  audience:
    - engineering
  visibility: public
  status: active
  owner: docgov
  relationships:
    depends_on:
      - architecture-overview
  generation:
    mode: human-maintained
---
# Commands

Every `docgov` command, what it does, and what it writes to disk.

Every command takes `--json` (and `--compact` for single-line JSON). Exit codes are the same
everywhere: **0** fine · **1** blocked · **2** needs a look · **3** config error.

Every `--json` document carries a top-level `version`, as does every file DocGov writes into
`.docgov/`. If you parse one, read that field: a shape you do not recognise is a DocGov newer
than the code reading it. See
[CONTRIBUTING.md](../../CONTRIBUTING.md#changing-a-persisted-format) for when it changes.

Each command is also a skill, so `/docgov:review` in Claude Code does what `docgov review`
does in your terminal, then reads the result for you.

---

## Start here

You run these three once, in order, when you adopt DocGov on a repository.

### `docgov setup`

Turns DocGov on. Looks at your repo and guesses its shape — a repo with a LICENSE and a
CONTRIBUTING is open-source, one with CODEOWNERS is a team, otherwise you're solo — then
writes `.docgov/config.yaml`, creates the directories the taxonomy expects, installs
`.claude/rules/documentation.md` so *every* agent in the repo knows the rules, and builds the
initial registry and graph.

```bash
docgov setup
docgov setup --mode team --layout full
docgov setup --rules      # regenerate .claude/rules/documentation.md, touch nothing else
```

`--force` rewrites `.docgov/config.yaml` from scratch, which takes your registrations and
domains with it. Use `--rules` when all you need is the agent rules file back in step with the
config — it is generated but committed, so it does not self-heal when the mode or layout
changes. `docgov doctor` tells you when that has happened.

| Flag | |
|---|---|
| `--mode solo\|team\|enterprise\|open-source` | how much is allowed to block. `solo` blocks 3 rules, `enterprise` blocks 12 |
| `--layout full\|compact` | numbered directory tree, or a flat one. Defaults to `full` past 25 documents |
| `--visibility internal\|mixed\|public` | the default visibility for new documents |
| `--force` | overwrite an existing config |

**Writes:** `.docgov/config.yaml`, `.docgov/registry.yaml`, the graph, `.claude/rules/documentation.md`, and the taxonomy directories.

If your repo already has documentation that predates DocGov, setup starts you in warn-only so
your next build doesn't fail over docs you haven't fixed yet. It tells you when to turn that
off.

### `docgov review`

Reads every document you already have and writes you a plan. **Changes nothing.**

For each document it works out what class it is, how confident it is, who wrote it, and
whether it's in the right place. Then it proposes actions — reclassify, move, add frontmatter,
split, extract, archive, merge — each tagged with how risky it is and whether it needs a human
judgement call. It also looks for duplicate pairs, contradiction candidates, broken links, and
documents your stack implies you should have but don't.

```bash
docgov review
```

The plan is grouped by how much of it you have to read, not by what kind of action each one
is, and it leads with the shape so you can size it up before reading a single line:

```
SAFE               38  frontmatter and new documents; nothing moves
HIGH CONFIDENCE     5  files move to their canonical place, links repaired
NEEDS REVIEW       24  DocGov was not sure; read these before running `fix`
```

The first two are mechanical and reversible. The third is the part actually asking you
something — and it holds two different things: moves and classifications that `fix` **will**
carry out (what is uncertain is what the document *is*, not the operation), and splits, merges
and extractions that rewrite prose and so are never automatic. Each action carries its `tier`
in the JSON too.

**Writes:** `.docgov/fix-plan.md` (for you to read and edit) and `.docgov/fix-plan.json` (for
`docgov fix` to execute). Nothing else.

Run it on an ungoverned repo and it runs `setup` for you first.

### `docgov fix`

Executes the plan. On a branch. Reverting itself if anything doesn't verify.

By default it only does the mechanical things — moving files, adding frontmatter, archiving,
creating missing documents — and repairs every internal link in the same transaction. The
judgement calls (splitting a document, merging two, extracting a README section) are left for
`/docgov:tag`, which uses an agent to rewrite the prose.

```bash
docgov fix --dry-run                        # show every file operation, touch nothing
docgov fix                                  # mechanical actions, on a new branch
docgov fix --include split,merge,extract    # also the judgement calls
```

| Flag | |
|---|---|
| `--dry-run` | print the operations, change nothing |
| `--include split,merge,extract` | also run these action kinds |
| `--branch <name>` | branch to work on. Defaults to `docgov/migration-YYYY-MM-DD` |
| `--no-branch` | work on the current branch |
| `--no-git` | skip git entirely. You lose the revert guarantee |
| `--commit` | commit on success |
| `--skip <ID,..>` | drop individual actions by the id shown in the plan |
| `--keep` | don't revert if verification fails — useful for debugging |

**Needs git and a clean tree.** If verification finds problems it runs `git reset --hard` and
you're back where you started. That's the whole promise, and it only works if every change is
revertible.

---

## Every day

### `docgov create <type> "<name>"`

A new document, in the right place, with its template, its required sections, and its
relationships already wired into the graph. It searches your existing docs and auto-fills
`depends_on` with up to three higher-authority related documents. Create a TRD and it finds the
matching PRD and sets `implements` for you.

```bash
docgov create architecture.adr "Use Postgres for the event log"
docgov create user.guide "Deploying" --domain platform
docgov create user.guide "Deploying" --check     # who owns this already? writes nothing
```

**It searches before it creates.** A free path proves nothing — a fourth setup guide beside
`docs/getting-started.md` is well-formed, correctly typed, in the right directory, and a second
source of truth. So `create` asks who already owns the topic first, and answers in one of three
ways:

| Answer | What happens |
|---|---|
| `create-new` | Nothing already carries this name. It writes the document. |
| `review-first` | A document of the same class shares words with your name. It lists them on stderr and writes the document anyway. |
| `update-existing` | Either the class holds one document and it is taken, or an existing document of this class is already named for what you asked. **It refuses.** |

Only the decidable cases block. Whether "Setup" and "Getting started" are the same
responsibility is a judgement call, and DocGov does not block on judgement calls — it names the
candidates and lets you decide. `--force` overrides a refusal; use it and say in the new
document how it differs from the one it sat beside.

`--check` answers the question without writing anything, which is what an agent should run
before it decides. It exits `0` for `create-new` and `2` otherwise, so a script can branch on
the exit code without parsing output; with `--json` it also returns the owner, the candidates,
the required sections and the size limit.

Flags: `--domain`, `--path`, `--id`, `--owner`, `--visibility`, `--implements`, `--supersedes`,
`--check`, `--force`.

Run `docgov types` to see them all before deciding yours isn't one of them.

### `docgov check`

The deterministic rules. This is what runs on every write and in CI.

Duplicate ids, hand edits to generated trees, unparseable frontmatter, internal documents in
public paths, edits to the archive, broken links, documents past their hard size limit. How
much of that *blocks* depends on your mode. Everything else is advisory.

```bash
docgov check                # everything, advisory truncated at 25
docgov check --changed      # only what changed since HEAD
docgov check --base main    # only what changed since main
docgov check --all          # don't truncate
docgov check --no-drift     # skip the staleness pass
```

**Exit 1** means something blocking. **Exit 2** means drift worth a look.

### `docgov affected`

You changed some files. These are the documents that need to change with them, split into
required and optional, with a ✓ or ✗ for whether you already updated each one.

```bash
docgov affected
docgov affected --base main
docgov affected src/billing/invoice.js
```

### `docgov checklist`

The same answer as a checklist an agent can work through and CI can verify.

```bash
docgov checklist            # write and print .docgov/checklist.yaml
docgov checklist --pr       # print the PR comment body instead
docgov checklist --no-write # print only, write nothing
```

**Writes:** `.docgov/checklist.yaml` unless you pass `--no-write`. Delete it after merge.
Exit 2 if documentation obligations are outstanding.

### `docgov find "<query>"`

Search, ordered by authority first and relevance second — so the canonical spec comes back
before the tutorial that paraphrases it. Deprecated and superseded documents are pushed down.

```bash
docgov find "rate limiting"
docgov find "auth" --limit 5
```

### `docgov whatis`

What is this document, and where does it belong? Reports the class it inferred, how confident
it is, which signals produced that answer, where it should live, what sections it needs, and
what else it might have been.

```bash
docgov whatis --path docs/thing.md
docgov whatis                        # every document in the repo
```

Works on repos DocGov hasn't been set up on.

---

## When something is off

### `docgov stale`

Which docs did the code move out from under.

Four kinds: **forward** (code changed, the doc describing it didn't), **reverse** (the spec
changed, the code didn't), **contract** (your OpenAPI file is ahead of the prose describing
it), and **dependency** (something this document depends on moved). Plus a staleness score
from 0–100, computed from what changed *around* a document rather than how old it is.

```bash
docgov stale
docgov stale --base main
docgov stale --no-staleness
```

Exit 2 on anything critical or high. This is the deterministic half — whether the prose now
*contradicts* the code is a judgement call, and that's `/docgov:stale` in Claude Code.

### `docgov health`

Your documentation, scored out of 100: coverage, freshness, consistency, structure,
discoverability, cross-linking, canonical integrity, metadata. Then a list of documents your
stack implies you should have and don't — Kubernetes manifests but no deployment doc, that
kind of thing — each with a ready-to-run `docgov create` line.

```bash
docgov health
```

### `docgov inspect <what>`

Builds a review packet for an agent: narrow excerpts and diff hunks, sized so the reviewer
reads kilobytes instead of your whole repo.

```bash
docgov inspect stale            # default
docgov inspect contradictions   # pairs of documents that might disagree
docgov inspect quality          # documents worth a quality pass
```

Always prints JSON — the flag only changes the indentation. Always exits 0. You normally don't
run this yourself; `/docgov:inspect` does and then reads the result.

### `docgov tag`

Adds missing frontmatter. That's all it does — despite what you might expect, it does not move
files. Moves go through `review` + `fix` so they stay transactional and revertible.

```bash
docgov tag                        # show what it would add
docgov tag --apply                # write it
docgov tag --apply --path docs/x.md
```

### `docgov rules`

The rules your documents declare, and the code each one governs.

Write `INV-LIC-001 A license belongs to exactly one organization.` as a list item in a canonical
document, map it to a code glob, and every agent that edits that code gets handed the rule
before it writes a line. This is the cheapest useful thing in DocGov.

```bash
docgov rules
docgov rules --for src/billing/
```

**Exit 1** on duplicate rule ids. With no rules declared it prints a short how-to.

### `docgov ignore <ID>`

Record a deliberate exception. A finding id, a reason, and optionally a date it expires.

```bash
docgov ignore DRIFT-20828 --reason "the spec is the one that's wrong; ADR-014 pending"
docgov ignore BROKENLINK-1 --reason "external link is flaky" --expires 2026-12-01
docgov ignore list
docgov ignore --remove DRIFT-20828
```

**Writes:** `.docgov/suppressions.yaml`. Suppressed findings stay visible in `ignore list` and
in every report. Expired ones get their own section in `check`. Nothing disappears quietly.

### Choosing what gets reviewed

Two model reviews run on a documentation write, and they are two different questions:

```yaml
review:
  audience: true        # or a list of lenses: [operations, security]
  leak: true
```

**Audience fit** asks whether the document matches the standard for what it is. There is no
general standard for "good documentation" — a README optimises for a stranger getting running
in five minutes, a runbook for being executable at 3am by someone who did not write it, an ADR
for whether the reasoning survives the author leaving. DocGov picks the lens from the document
class (it knows the class; that is not a judgement call) and hands the model the lens itself,
from `lenses/`, so a finding names the standard it was judged against and you can disagree with
the standard rather than with the model. It is deliberately conservative: a false positive here
costs an argument about prose somebody was right about.

**Leak detection** asks whether something private is about to be written down. A deterministic
pattern scan runs first, in the write hook, with no model involved — and it runs on an edit as
well as a new file, because a credential is just as published when it is pasted into a document
that already existed. The model covers only what pattern matching cannot: the thing that is
private because of what it means. It is deliberately *not* conservative: ten seconds looking at
a string that turned out to be fine beats one published credential.

A clean leak result means no known pattern matched and nothing stood out. It never means the
document contains no secrets, and it is reported that way everywhere.

`docgov doctor` prints which of these are in force. Note that the two model prompts themselves
cannot be switched off from config — Claude Code offers no way to gate a `prompt` hook — so
`review:` governs the deterministic half and the lens DocGov hands over.

### Defining your own document classes

The taxonomy ships 60 classes. It does not enumerate every project's needs — measured on three
unfamiliar repositories, the honest residue after all the classification work is still working
notes, sales collateral and QA evidence. Until now the only escape hatch was abstention, which
is correct and terminal.

Add classes in `.docgov/config.yaml`, or in a policy pack so every repository in an
organization gets them:

```yaml
taxonomy:
  types:
    qa.evidence:
      label: QA Evidence
      authority: implementation       # any tier in the authority order
      paths:                          # required — see below
        - "qa/evidence/**"
      sections: [Scope, Method, Result]
      soft: 300                       # hard defaults to soft × 1.8
      lens: developer                 # optional
      visibility: internal            # optional
```

A class you define is a class like any other: `whatis` classifies into it, `create` gives it a
template built from its sections, `check` enforces those sections and its limits, and `types`
lists it marked as yours.

Four rules keep this an extension rather than a hole in the model:

1. **You cannot redefine a class DocGov ships.** Changing what `product.prd` means would make
   every other repository's answer to that question unverifiable. Refused by id.
2. **`paths` is required.** A class with no paths has no structural evidence behind it, so
   nothing could ever be classified into it without guessing from prose.
3. **Those paths are evidence, not a catch-all.** A document outside them still abstains
   rather than being forced into the nearest class you happen to have defined.
4. **Everything is validated at load** — the id shape, the authority tier, the limits, the
   visibility — while you are still looking at the file that declares it.

### `docgov doctor`

Is any of this actually working? A hook is invisible when it works and mystifying when it does
not — you find out it never fired by noticing its absence, weeks later, in the documentation it
failed to govern.

```bash
docgov doctor
docgov doctor --json
```

Fourteen checks, each of the form *does this file still agree with that one*: Node version,
the two manifests agreeing on a version, every registered hook naming an event the CLI
implements and pointing at a file that exists, every skill's `name:` matching its directory,
every advertised plugin option actually being read by the engine, git, the config, `.docgov/`
being writable, stored artifacts still readable by this build, the registry not pointing at
deleted files, `.claude/rules/documentation.md` agreeing with the config that generated it,
duplicate ids, and anything the scan could not reach.

Every one exists because the disagreement it looks for either happened here or was one edit
away. Two of them have already caught real bugs in this repository: three plugin options
advertised and honoured nowhere for two releases, and a rules file that still said `solo` after
the project became `open-source`.

**Exit 0** all clear · **2** something to look at · **1** something is broken. It runs on an
ungoverned repository too, and tells you that is what it found — a diagnostic that needs the
thing it diagnoses is not a diagnostic.

### `docgov judge --file <verdicts.json>`

Record what a model concluded. This is the only door a semantic finding comes through, and it
is deliberately not the door deterministic findings use.

```bash
docgov judge --file verdicts.json --agent quality-reviewer
docgov judge --file - --agent drift-reviewer < verdict.json   # what an agent actually does
docgov judge --clear [--agent NAME]
```

Each verdict needs `check`, `path`, `message`, `confidence` (`low`/`medium`/`high`, or a number
from 0 to 1) and `evidence` — a non-empty list of what was actually read. The last two are the
point: a verdict with neither is an assertion, and DocGov refuses it rather than storing it.

What DocGov does with them is fixed and not up to the sender. `deterministic: false`,
`blocking: false` and `source: "model"` are set on write and re-applied on read — an agent
cannot mark its own opinion as a rule, even by writing the file by hand. They print in their
own JUDGEMENT section in `check`, they are a separate `judgements` array in `check --json`
rather than entries in `findings`, and they never change an exit code.

A second run of the same agent on the same document replaces its earlier verdict rather than
stacking another one beside it.

**Writes:** `.docgov/judgements.json` — committed, like suppressions and unlike the transient
artifacts. A recorded dismissal is how the next run avoids re-litigating a finding somebody
already looked at, and that only works if it survives the branch.

### `docgov publish`

What's safe to publish externally and what would leak. Scans for internal hostnames, private
IPs, credential-shaped strings and internal references, then buckets each document into
publishable, blocked, or needs-a-rewrite — with a brief for the rewrite.

```bash
docgov publish
docgov publish --target docs/external
```

Always exits 0. Nothing is ever published automatically. An external document is a different
artifact, not a redacted copy.

---

## Plumbing

### `docgov types [filter]`

Every document class: authority, review lens, size limits, required section count. Filter
by type id or authority.

```bash
docgov types
docgov types architecture
docgov types canonical
```

### `docgov brief <topic>`

The minimum authoritative context for an area — the constitution, the canonical spec, the rules
in force, the relevant ADRs, the machine contracts, and nothing else. Full document bodies
until the token budget runs out, then headings only.

```bash
docgov brief billing
docgov brief auth --budget 4000
docgov brief billing --explain    # …and how every document was decided
```

It opens with a map, because an agent handed twelve thousand characters needs to know what it
is looking at in the first six lines:

```
AUTHORITATIVE   docs/architecture/billing.md, contracts/billing.yaml, docs/adr/018-ledger.md
INVARIANTS      INV-BILL-001, INV-BILL-004
IMPLEMENTATION  src/billing/**
DERIVED         README.md summarizes docs/architecture/billing.md
KNOWN STALE     docs/architecture/billing.md (forward, high)
CONFLICTS       none
```

Every row is countable and every row is sourced from documents also in the pack. `KNOWN STALE`
reads `unknown — no git history available` outside a git repository, because that is not the
same as `none` and printing the second would be a claim DocGov cannot make. `CONFLICTS` reports
only two documents of a constitution or canonical class naming the same domain — the case where
nothing ranks one over the other. Most classes are plural by design, and a domain with six ADRs
is not in conflict with itself.

`--explain` appends what happened to every document considered and why: `selected`,
`headings-only` (chosen, but the budget ran out before its body), or `rejected` with the
reason — no match, superseded, or ranked below the cut. A pack that comes back too thin or too
large is a question with an answer rather than a guess. `--json` returns the same trace as
`decisions`, alongside the map and the pack text.

**Always prints to stdout**, with or without `--json`. That's deliberate: this is what the
`/docgov:brief` skill injects into an agent's context.

### `docgov registry`

The id → path table. `--rebuild` rewrites `.docgov/registry.yaml` and the graph, and **exits 1
on id collisions**.

```bash
docgov registry
docgov registry --rebuild
```

### `docgov graph`

Nodes grouped by authority tier, their outbound relationships, and how many documents are
orphans.

```bash
docgov graph
docgov graph --dot > docs.dot    # Graphviz
docgov graph --save
```

### `docgov tools`

Probes for documentation tools you already have installed — lychee, markdownlint, Vale,
Spectral, oasdiff, diagram tools, MCP servers — so DocGov delegates to them instead of
reimplementing them. If a tool isn't there, DocGov does the job itself.

**Writes:** `.docgov/tools.json` every time.

### `docgov hook <event>`

The Claude Code hook protocol. Reads hook JSON on stdin, writes hook JSON on stdout. You don't
run this; `hooks/hooks.json` does.

Events: `pre-tool`, `pre-write`, `post-write`, `session-start`, `pre-code-edit`, `stop`.

**Always exits 0, always.** A bug in DocGov can stop it governing; it can't stop your session
working.

### `docgov version` · `docgov help`

```bash
docgov version      # or --version, -v
docgov help         # or --help, -h
```

---

## Related

- [README](../../README.md) — what DocGov is
- [architecture.md](../architecture.md) — how it's built
- [SECURITY.md](../../SECURITY.md) — what the hooks run and what stays on your machine
