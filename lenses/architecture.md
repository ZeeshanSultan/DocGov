# Architecture lens

**The question:** can a reader tell what this system guarantees, where its boundaries are,
and which changes are safe?

## Evaluates

- **Boundaries.** What is inside, what is outside, what crosses. Unambiguous.
- **Responsibilities.** What each component owns. Two components owning one thing is a
  finding, not a detail.
- **Data flows.** What moves where, in what shape, triggered by what.
- **Dependencies.** Direction included. Cycles are findings.
- **Invariants.** What must always hold. Given ids so they can be enforced and cited.
- **Trade-offs.** What was given up. An architecture document with no trade-offs is a sales
  document.
- **ADR references.** Decisions linked rather than re-argued, so nobody reverses one by
  accident.

## Fails the lens

- Installation or usage instructions. Wrong document.
- A diagram with no text. A diagram shows structure; it cannot state a guarantee.
- "Scalable", "robust", "performant" with no number or mechanism.
- Present tense describing aspiration. If it is not built, say so and link the PRD.
- Restating a schema that lives in a machine contract, creating a second source of truth.

## The test

Could a reader use this document to decide whether a proposed change is safe? If not, it
describes the system without governing it.
