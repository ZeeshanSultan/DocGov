# Developer lens

**The question:** can a competent engineer who does not know this system reproduce what the
document describes, and predict what happens when it goes wrong?

## Evaluates

- **Technical precision.** Exact names, exact paths, exact versions. "Configure the service"
  is not an instruction.
- **Reproducibility.** Every command runnable as written. Prerequisites stated, not assumed.
- **Examples.** At least one complete one. Fragments that assume surrounding context fail.
- **Assumptions stated.** What must already be true. This is the most common omission and
  the most expensive.
- **Failure modes.** What breaks, how it surfaces, what to do. A document that only
  describes the happy path is half a document.
- **Dependencies.** What this needs, and what degrades when each is unavailable.
- **Links to architecture.** Why, not just how — otherwise the reader cannot tell which
  parts are safe to change.

## Fails the lens

- Passive voice hiding the actor: "the token is validated" — by what, when, and what happens
  if it is not?
- Version-less instructions that were true once.
- "Simply", "just", "obviously". Each one marks a step the author skipped.
- Copy-pasted schema or config instead of a link to the authoritative source.
