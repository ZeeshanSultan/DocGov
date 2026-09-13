---
name: stale
description: Detect documentation drift — implementation changed but documentation did not, documentation changed but implementation did not, machine contracts ahead of their derived docs, and semantic staleness. Use for "are my docs still true", before a release, or after a large change.
allowed-tools: Bash(docgov *) Bash(git diff*) Bash(git log*) Read
argument-hint: "[--base main]"
---

# Detect documentation drift

## Deterministic drift report

!`docgov stale --json --compact $ARGUMENTS 2>&1 | head -c 14000`

## What this report is, and is not

The findings above are facts: a document claims to describe code that changed while the
document did not, or a specification changed with no corresponding implementation change.
Those are decided from the diff and the graph.

What the report does **not** claim is that the prose actually contradicts the new code.
That is your job, and it needs the diff.

## Confirm each finding

Run `docgov inspect stale --json` for review packets: each finding comes with the relevant
diff hunks and the document excerpt, so you read kilobytes instead of the repository.

For each packet decide one of three things and say which:

1. **Real drift.** The document states something the code no longer does. Quote the
   document's claim and the code that contradicts it, then make the edit. Be specific —
   "the document says the offline grace period is 7 days; `validator.ts:42` now uses 30"
   is actionable, "the licensing docs look stale" is not.
2. **Not drift.** The code changed in a way the document does not speak to. Say so in one
   line and move on. Most findings are this, and saying so quickly is the valuable part.
3. **Reverse drift.** The document is right and the code is wrong — the specification was
   updated and the implementation never followed. This is the more dangerous direction,
   because the code ships. Flag it as an implementation gap, not a documentation task.

## Invariants

If a finding carries invariants, check them specifically: an invariant the code now
violates is a higher-severity problem than a stale sentence, and it is the one thing here
that can be objectively wrong.

## Staleness

The `staleness` array scores risk from what changed *around* a document, not from its age.
A document untouched for two years with no implementation churn is not stale. Only report
entries whose signals you can explain.

## If a finding is wrong

`docgov ignore DRIFT-xxxxx --reason "..." [--expires YYYY-MM-DD]`. It stays visible in
every report. Suppress the finding, never the rule.
