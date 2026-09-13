---
name: publish
description: Analyze which documentation is safe to publish externally, detect information that would leak, and produce external-lens rewrite briefs. Use before publishing docs, opening a repository, or moving internal documentation to a public site.
disable-model-invocation: true
allowed-tools: Bash(docgov *) Read Write Edit
argument-hint: "[--target docs/11-external]"
---

# Publishing analysis

!`docgov publish --json --compact $ARGUMENTS 2>&1 | head -c 10000`

## The rule this skill exists to enforce

**An external document is a different artifact, not a copy of an internal one.** They serve
different readers and answer different questions. Copying internal documentation outward —
even with the secrets removed — produces documentation that is technically safe and
practically useless, and it leaks information structure even when it leaks no values.

## What to do

1. **`blocked[]` — report and stop.** These contain detected sensitive patterns. List the
   file, line and what was found. Do not publish, do not "clean up and publish anyway" on
   your own judgement. Hand it back to the user.

2. **`rewrite[]` — write a new document, do not edit the old one.** Use the brief in
   `briefs[]`. Under the external lens:
   - no internal jargon, team names, ticket ids, or hostnames
   - no unmitigated risks, no infrastructure topology
   - task-oriented: what the reader wants to do, not how the system is built
   - prerequisites stated explicitly, because the external reader has none of your context
   - every example runnable exactly as written

3. **`publishable[]` — still read before shipping.** Soft flags (ticket references, email
   addresses, work-in-progress markers) are judgement calls, not false positives.

4. **Never publish.** This skill analyzes and drafts. A human approves and a human ships.
   Say that explicitly when you report, and do not offer to push anything.

## The threat model / public security model pair

These are the canonical example of the same subject needing two documents. The threat model
is `visibility: internal` and names unmitigated risks. The public security model is
`visibility: public` and says what you protect and how to report a vulnerability. One is
not a redaction of the other.
