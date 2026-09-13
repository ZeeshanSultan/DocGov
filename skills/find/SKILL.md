---
name: find
description: Search documentation with authority-aware ranking, so the canonical specification is returned before the tutorial that paraphrases it. Use for "where is X documented", "what do we say about Y", or finding the authoritative source for a behaviour.
allowed-tools: Bash(docgov *) Read
argument-hint: "<query>"
---

# Find documentation

!`docgov find "$ARGUMENTS" 2>&1 | head -c 10000`

## How to read this

Results are ordered by **authority first, relevance second**. That ordering is deliberate:
an agent that reads the user guide before the canonical specification writes confidently
wrong code.

- `[CONSTITUTION]` / `[CANONICAL]` — authoritative. Start here. If something below
  contradicts these, the thing below is wrong.
- `[REQUIREMENTS]` / `[DECISION]` — why it was built this way. ADRs explain decisions you
  might otherwise reverse by accident.
- `[CONTRACT]` — machine-readable and authoritative over any prose about it.
- `[AUDIENCE]` — written for a reader, not for precision. Do not treat a guide as a spec.
- `[HISTORICAL]` — may be out of date on purpose. Check `status` before believing it.

If a result is marked `deprecated` or `superseded`, follow its `supersedes` edge to the
current document instead of using it.

## If nothing relevant comes back

That is a coverage gap, not a search failure. Run `docgov health` to see whether DocGov
already knows the document is missing, and offer to create it with `/docgov:create`.
