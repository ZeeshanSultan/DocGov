# User lens

**The question:** can the intended reader — who does not know how the system is built and
should not have to — complete the task they came for?

## Evaluates

- **Task orientation.** Organized around what the reader wants to do, not around how the
  system is structured. Readers arrive with goals, not with a mental model of your modules.
- **Jargon.** Every internal term either removed or defined on first use.
- **No internal leakage.** No service names, team names, ticket ids, or hostnames.
- **Prerequisites.** Stated before step one, not discovered at step four.
- **Examples.** Runnable exactly as written, with realistic values.
- **Expected results.** Each step says what the reader should see. Without that they cannot
  tell success from silent failure.
- **Failure recovery.** What to do when a step does not work, or where to go.

## Fails the lens

- Architecture explained to justify an instruction.
- "See the API reference" where a concrete example belongs.
- Screenshots of a UI that has since changed, with no version note.
- Steps written from the author's environment: absolute paths, personal directories.
- Diátaxis confusion: a tutorial that is really a reference, a how-to that is really an
  explanation. Each of the four forms answers a different need; mixing them serves none.

## The test

Hand it to someone who has never used the system. If they ask a question the document could
have answered, that question is the finding.
