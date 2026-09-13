---
docgov:
  id: docgov-vision
  type: product.vision
  authority: requirements
  visibility: internal
  status: active
  owner: docgov
  relationships:
    depends_on:
      - docgov-prd
  generation:
    mode: human-maintained
---
# DocGov — product vision

## Context

Documentation does not rot because people are lazy. It rots because a repository with many
authors produces documentation faster than any review process can keep coherent — and most of
those authors are now agents.

Agents working in the same repository will independently create duplicate documents, invent
directory structures, contradict canonical specifications, write enormous Markdown files, put
documentation in the wrong place, update implementations without updating specifications,
update specifications without updating implementations, write README content aimed at the
wrong audience, mix internal and external information, and ignore ADRs that already decided
the question.

None of that is a writing problem. Every one of it is a *governance* problem: nobody and
nothing holds the relationships between intent, contracts and code.

## Vision

Documentation is not a folder of Markdown files. It is a governed representation of the
software system, and the relationships inside it can be made machine-checkable.

DocGov governs those relationships. Humans define intent. Machine-readable artifacts define
facts wherever they can. Code implements behaviour. Git records history. DocGov governs the
relationships and the consistency between them — and aggressively avoids creating a second
source of truth for anything.

The split that makes this work is that software decides everything that can be decided by
software, and a model decides only what is genuinely subjective. An LLM never decides whether
a document id is duplicated. Software never decides whether prose is clear.

## Success looks like

- A developer adopts DocGov on a messy existing repository and gets an accurate, reviewable
  plan without anything being moved.
- An agent editing governed code is handed the rules governing that code before it writes a
  line, without anyone remembering to ask.
- A change that makes documentation wrong is surfaced at the moment it is made, not at the next
  audit.
- The tool is still installed six months later, because it never blocked anything trivial.

## Non-goals

- DocGov does not write documentation for you, and it does not grade prose as a gate.
- It does not maintain a history parallel to git.
- It does not publish anything. Publication always crosses a human gate.
- It does not replace tools that already do a job well; where one is installed it delegates and
  validates the result.
- It does not phone home. No telemetry, no network calls in the engine.

## Related

- [PRD](PRD.md) — the requirements themselves
- [Roadmap](roadmap.md) — what is shipped and what is next
