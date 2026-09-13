---
name: tag
description: Reorganize existing documentation — add missing frontmatter, split oversized documents, extract overgrown README sections, merge duplicates, and archive superseded documents. Use for "clean up the docs", oversized files, duplicate documents, or after onboarding leaves judgement calls.
disable-model-invocation: true
allowed-tools: Bash(docgov *) Bash(git *) Read Write Edit
argument-hint: "[--path <file>]"
---

# Reorganize documentation

## State

!`docgov tag --json 2>&1 | head -c 8000`

## Mechanical work first

`docgov tag --apply` writes missing frontmatter for everything it can classify
confidently. Run it, then report how many documents it annotated. Moves stay with
`docgov fix` so that link repair and the move happen in one transaction.

## Then the judgement calls, one at a time

### Splits

A document flagged for splitting holds several independently addressable concepts. Do it
like this, and only this way:

1. Create each part with `docgov create <type> "<part name>" --domain <d>` so it lands in
   the right place with the right frontmatter.
2. Move the content across **verbatim**. Rewriting while splitting is how information gets
   lost; if prose needs improving, that is a separate change.
3. Turn the parent into an index: a short overview plus a link to each part. Not a stub —
   an overview that is useful on its own.
4. Add `depends_on` from each part back to the parent, so the graph keeps the structure.
5. Run `docgov check` to confirm no link broke.

### README extraction

A README section that has grown past ~40 lines belongs elsewhere. Move the body to the
document class DocGov names, then leave behind a summary of roughly one line per fifteen
removed, plus a link. A README answers "what is this, why would I use it, how do I start,
where is the depth" — it is not the project encyclopedia.

### Merges

Never merge prose silently. Show the user both documents, say which content you would
keep, which you would drop, and why. Then merge into the **higher-authority** path, point
`supersedes` at the retired one, and archive rather than delete it.

### Archiving

Superseded documents go to the archive namespace with `status: superseded` and a
`supersedes` edge from their replacement. The archive is a record: do not edit it
afterwards, and DocGov will block attempts to.

## Report

End with the `docgov health` score before and after, and the single change that would
raise it most.
