# Security

DocGov runs a shell command on every file write in your editor and can deny tool calls.
That deserves a plain account of what it does, because you should not have to read the
source to find out.

## What we protect

**Your documentation never leaves your machine.** The engine makes no network calls of any
kind — no telemetry, no license check, no update ping, no model calls. `grep -rn "fetch\|https://" core/`
returns nothing but comments. Everything DocGov knows lives in `.docgov/` inside your repository.

**DocGov never publishes.** `docgov publish` analyzes and drafts; it has no code path that
pushes, commits to a remote, or writes outside the repository root. Publication always
crosses a human.

**What the plugin executes.** Four command hooks, all of them `node <plugin>/bin/docgov hook <event>`:

| Hook | Event | What it does |
|---|---|---|
| `pre-tool` | before `Write`/`Edit`/`MultiEdit`/`NotebookEdit` | reads config, registry and the target path; may deny the write |
| `post-write` | after a markdown write | re-reads the repository and reports findings |
| `session-start` | session start | reads the registry and injects the authoritative-document list |
| `stop` | turn end | runs impact analysis against `git diff` |

They read files and run `git`. They do not write outside `.docgov/`, do not execute anything
from your repository, and do not interpret file contents as commands.

One `prompt` hook sends a newly written markdown file's path and content to a fast model for
an audience-lens and visibility-leak judgement. **That is the only thing that leaves your
machine, it only fires on `Write` of a `.md` file, and it is switchable:** set
`semantic_gate: false` in the plugin's user config, or remove that hook from
`hooks/hooks.json`.

**Failing open.** Every hook catches its own errors and exits 0. A bug in DocGov can make it
stop governing; it cannot make your session stop working.

## Scope

**In scope** — anything that would let DocGov read or write outside the repository it is
governing, execute content from a governed file, leak documentation off the machine, or be
induced by crafted file content to permit a write it should deny (for example frontmatter
that defeats the `generated-edit` or `visibility-path` gate).

**Also in scope, and genuinely useful** — a path traversal in the hook's relative-path
handling, or a `docgov publish` case where the leak scanner misses a credential pattern it
claims to detect. The scanner is a safety net, not a guarantee: treat a clean report as "no
known pattern matched", never as "this document contains no secrets".

**Out of scope** — a rule you disagree with, a classification DocGov gets wrong, an
unhelpful score, or the YAML parser refusing a construct it does not support. Those are
bugs or proposals, not vulnerabilities. Open an issue.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |

DocGov is at 0.x: there is one supported line, and it is the latest one. Security fixes go
out as a patch release on it rather than being backported.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/ZeeshanSultan/DocGov/security/advisories/new).
Do not open a public issue for something exploitable.

Include what an attacker controls, what they achieve, and a reproduction — a small repository
and the command is ideal. Expect an acknowledgement within a week. If it is real you will be
credited in the advisory unless you would rather not be.
