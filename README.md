# DocGov

**Your agent wrote 40 markdown files last week. How many of them are lies?**

DocGov is the adult in the room for AI-written docs. It decides where files go, notices when
two documents contradict each other, and tells you what went stale the moment you change code.

It's a Claude Code plugin and a standalone CLI. Node 20+, zero dependencies, nothing leaves
your machine.

## What it looks like

You point it at a repo that's been vibe-coded for a few months:

```
$ docgov review

DocGov review
─────────────
5 documents inventoried · 0 machine contracts · stack: none detected

Finding                        Count
-----------------------------  -----
unclassified                   3
moves proposed                 1
frontmatter to add             5
suspected duplicates           1
missing documents              1
broken internal links          0

Plan written to .docgov/fix-plan.md — nothing has changed.
4 of 11 actions need a judgement call.

Read the plan, delete anything you disagree with, then: docgov fix --dry-run
```

That duplicate pair is two API docs at 91% overlap that disagree about whether tokens
expire and whether charges retry three times or five. DocGov won't merge prose on its own —
it narrows the candidates and hands them to you.

**Try it on a repo that isn't yours:** `./examples/demo.sh` builds a deliberately messy
repository and runs the whole flow against it. Real run, nothing pre-baked, about 30 seconds.

Nothing moved. It wrote you a plan. You read it, delete the parts you disagree with, and run
`docgov fix` — which works on a branch and reverts itself if anything fails to verify.

## Install

```bash
claude plugin marketplace add ZeeshanSultan/DocGov
claude plugin install docgov
```

That gets you the hooks, which are the good part: your agent gets handed the rules before it
edits governed code, and gets stopped before it writes a doc in the wrong place.

Not using Claude Code? The CLI works on its own, and it's the same binary CI runs:

```bash
npx docgov-cli setup
```

(The package is `docgov-cli` because npm won't hand out `docgov`. The command you type is
still `docgov`.)

## Usage

Your first five minutes:

```bash
docgov setup     # turn it on. infers your project's shape, writes .docgov/config.yaml
docgov review    # look at the docs you already have. writes a plan, changes nothing
docgov fix       # run the plan, on a branch, reverting itself if verification fails
```

Then, day to day:

```bash
docgov check     # did I just break a rule?
docgov stale     # which docs did the code move out from under?
docgov affected  # I changed this — what do I need to update?
docgov health    # how bad is it, out of 100?
```

Every command takes `--json`. Full list: **[docs/reference/commands.md](docs/reference/commands.md)**.

## What it actually does

| | |
|---|---|
| **Knows what a document is** | A class for every kind of document, and each one has a place it belongs, sections it must have, and a size past which it stops being that kind of document. Point it at a file and it'll tell you what you wrote. |
| **Knows which docs outrank which** | Your spec beats the tutorial that paraphrases it. A README can't quietly contradict an ADR. When two documents disagree, there's a defined answer for which one is wrong. |
| **Hands your agent the rules** | Write `INV-LIC-001 A license belongs to exactly one organization.` in a spec, map it to the code it governs, and every agent that touches that code gets the rule before it writes a line. Cheapest useful thing in here. |
| **Notices when docs go stale** | Code moved and the doc didn't. Spec moved and the code didn't. Your OpenAPI file is ahead of the page describing it. Scored by what changed *around* a document, not by how old it is. |
| **Tells you what to update** | You changed this file — here are the docs that need to change with it, split into required and optional, as a checklist your agent can work through and CI can check. |
| **Packs context for agents** | `docgov brief billing` returns the minimum authoritative context for an area and nothing else. It's the only documentation your agent pays tokens for. |
| **Won't let you leak** | Before anything goes public it flags what would leak and writes rewrite briefs. An external doc is a different artifact, not a redacted copy. Nothing publishes automatically. |

## How it decides things

Two halves, and the split is the whole design:

**Software decides what blocks.** Is this id a duplicate? Is this file in the right place? Did
code change that a spec claims to describe? Same answer in your editor and in CI, and it can
always show its working.

**A model decides what's subjective.** Do these two documents actually contradict each other?
Should this be split? Is this prose still true? Reported for review, never enforced.

> An LLM never decides whether `docgov.id` is duplicated. Software never decides whether your
> prose is clear.

A governance tool that blocks a README typo gets uninstalled, so enforcement ramps: adopting
DocGov on a repo that already has docs starts in warn-only, and `setup` tells you when to turn
that off.

## Honest limits

- **Stale ≠ wrong.** DocGov tells you, as a fact, that a document claims to describe code that
  changed while the document didn't. Whether the prose now *contradicts* the code is a
  judgement call, made by an agent, and it's advisory. Claiming otherwise would be the fastest
  way to lose your trust.
- **Quality scores don't fail builds.** A subjective judgement that fails a build is one nobody
  can appeal.
- **`fix` needs git and a clean tree.** "Without losing anything" is only a real promise if
  every change is revertible.

## Where everything else is

- **[docs/reference/commands.md](docs/reference/commands.md)** — every command, what it does, what it writes
- [docs/architecture.md](docs/architecture.md) — how it's built
- [SECURITY.md](SECURITY.md) — what the hooks run, and what never leaves your machine
- [CONTRIBUTING.md](CONTRIBUTING.md) — the one architectural rule
- [CHANGELOG.md](CHANGELOG.md) — what changed
- [examples/policy-packs](examples/policy-packs/README.md) — governance across a whole organization
- [Issues](https://github.com/ZeeshanSultan/DocGov/issues) — bugs, and especially false
  positives. A rule that fires when it shouldn't is the bug that decides whether anyone trusts
  this thing.

`npm test` runs the suite against real temporary git repos. DocGov governs its own repository,
so `docgov check --all` here is a real end-to-end test.

[MIT](LICENSE).
