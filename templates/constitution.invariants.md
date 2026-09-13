# Invariants

> Project-level rules that must hold at all times. These are enforced, not aspirational:
> any line beginning with an id becomes an object DocGov injects into agents editing the
> code it governs.

## How to write one

```
- INV-<DOMAIN>-<NNN> <A single statement, present tense, falsifiable.>
```

Good:  `INV-LIC-001 A license belongs to exactly one organization.`
Bad:   `INV-LIC-001 Licensing should be robust.`

An invariant that cannot be violated by a specific code change is not an invariant, it is a
principle — put it in `PRINCIPLES.md` instead.

Map the code each invariant governs in the frontmatter of the document that states it:

```yaml
docgov:
  documents: ["src/licensing/**", "migrations/*licen*"]
```

Without that mapping the invariant is documentation. With it, every agent that edits
licensing code is handed the rule before it writes a line.

## Invariants

<!--
- INV-<DOMAIN>-001 <statement>
- INV-<DOMAIN>-002 <statement>
-->

## Changing an invariant

Changing one of these is a deliberate act. State what changed, why, what it breaks, and
which ADR records the decision. Do not soften an invariant to make a failing change pass —
that is the one manoeuvre this document exists to prevent.
