---
name: affected
description: Analyze which documents a code change affects and produce the documentation change manifest — required updates, optional updates, and the PR-ready review comment. Use before committing, when opening a PR, or for "what docs do I need to update".
allowed-tools: Bash(docgov *) Bash(git diff*) Bash(git status*) Read Write Edit
argument-hint: "[--base main]"
---

# Change impact

## Impact and manifest

!`docgov affected --json --compact $ARGUMENTS 2>&1 | head -c 10000`

## What to do

1. **Report the required list first.** Entries with `required: true` and `updated: false`
   are the work. Everything else is context. Lead with the short list of files the user
   actually has to touch.

2. **Update them.** For each, read the document, find the part the change invalidates, and
   make the minimal correct edit. Do not rewrite a document because one sentence is wrong.

3. **Write the manifest** with `docgov checklist`. It lands in `.docgov/checklist.yaml` as a
   deterministic checklist that survives across sessions and CI — and is deleted after
   merge. Use it rather than holding the list in your head.

4. **For a PR,** run `docgov checklist --pr` and post the output as a comment. It states the
   code impact, the documentation impact, what is covered and what is outstanding.

5. **If a required document genuinely does not need updating,** say why, explicitly, in the
   PR comment or the commit message. "No documentation change needed because the refactor
   preserved the documented behaviour" is a legitimate answer. Silence is not.

## Signals worth reacting to

- `securityChanged` — the security architecture and threat model are almost always affected
  and almost always forgotten. Check them specifically.
- `apiChanged` without a contract change — either the contract is now wrong, or the change
  was internal and the signal is a false positive. Work out which.
- `behaviorChanged` without `testsChanged` — not a documentation problem, but worth saying
  out loud once.
