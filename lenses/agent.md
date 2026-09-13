# Agent lens

**The question:** can a different agent, with no access to this conversation, act on this
document and get it right?

This is the lens that matters most in a repository most of whose authors are agents, and
the one human reviewers never apply.

## Evaluates

- **Self-containment.** No reliance on context that lived in a chat.
- **Stated prerequisites.** An agent will not infer an unstated precondition; it will
  proceed confidently without it.
- **No ambiguous authority.** It is clear whether this document is authoritative or
  describes something else that is.
- **No TBD as fact.** `TODO`, `TBD`, `???` and "coming soon" will be read as current state.
  Either state what is true or say explicitly that it is unknown and who owns it.
- **Verifiable claims.** Numbers, paths and versions an agent can check. An unsourced claim
  gets propagated as authoritative.
- **Runnable examples.** Exactly as written, with no implied edits.
- **Declared relationships.** A document outside the graph is invisible to impact analysis,
  so nothing will ever tell an agent it went stale.
- **Fits a context window.** Past roughly 1,200 lines an agent will see a truncated half of
  the document and will not know which half.
- **Unambiguous terminology.** One term per concept. A document that uses "tenant",
  "organization" and "account" for the same thing will produce code that uses all three.

## Fails the lens

- "As discussed" / "per the decision" with no link.
- Two sections describing the same behaviour differently; an agent may read either.
- Aspirational present tense, which an agent will implement against.
- Examples with placeholders (`<your-key>`) and no statement that they are placeholders.

## The test

Strip the document of everything except its own text. Would an agent reading only that make
a wrong assumption? Each wrong assumption is a finding.
