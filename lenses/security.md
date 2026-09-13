# Security lens

**The question:** does this document let a reader reason correctly about what is protected,
from whom, and what is not protected at all?

## Evaluates

- **Trust boundaries.** Where trust changes, and what crosses each boundary.
- **Threat actors.** Who, with what capability and what motive. "Hackers" is not an actor.
- **Assets.** What is worth protecting, and why, in order.
- **Authorization.** Subjects, resources, actions, and the rule that joins them. Checked
  where — at the edge, in the service, in the database?
- **Secret handling.** Where secrets live, how they rotate, who can read them.
- **Abuse cases.** Not just "can an attacker get in" but "what can a legitimate user do that
  they should not".
- **Assumptions.** What must be true for the model to hold. When an assumption breaks, this
  is the list that tells you what else just broke.
- **Residual risk.** What remains after the controls, and who accepted it.

## Fails the lens

- Controls with no threats. A control list is not a threat model.
- Threats with no controls and no residual-risk entry — silently accepted risk.
- "We use encryption." Which data, at rest or in transit, which algorithm, whose keys?
- Compliance framework names standing in for a security argument.
- **Visibility error:** a threat model that names unmitigated vulnerabilities must be
  `internal`. If it is in a public path, that is a critical finding, not a style note.

## The internal/external pair

A threat model (`internal`) and a public security model (`public`) are two documents, not
one document with redactions. The public one says what you protect and how to report a
vulnerability. The internal one says what you have not fixed yet.
