# Operations lens

**The question:** can an on-call engineer, woken at 3am, who did not build this, execute
this correctly on the first attempt?

## Evaluates

- **Trigger.** The exact signal that starts this. An alert name, a symptom, a threshold.
- **Preconditions.** Access required, approvals needed, what must be true first.
- **Diagnostics before action.** Commands that establish what is actually happening.
  Procedures that act before confirming cause make outages worse.
- **Numbered steps, one action each.** Each with its expected result.
- **Copy-pasteable commands.** No placeholders that need thought to fill.
- **Validation.** How you know it worked, measured not assumed.
- **Rollback.** How to undo, and the point past which you cannot.
- **Escalation.** Who to wake, at what threshold, by what route.
- **Time expectations.** If a step takes eleven minutes, say so, or it will be declared
  hung and interrupted.

## Fails the lens

- Prose. Under pressure, prose is unreadable. Numbered steps.
- "Investigate the issue" as a step.
- "Contact the team" with no name, rotation or channel.
- A step whose outcome is not observable.
- Commands requiring access the preconditions did not mention.
- Last reviewed two years ago with no verification that the commands still exist.

## The test

Could someone who has never seen this system execute it without asking a question? If not,
the missing answer is the finding. A runbook is tested by being executed, not by being read.
