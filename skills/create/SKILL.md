---
name: create
description: Create a new governed document of the right class in the right place, with its template, its required sections, and its relationships already wired into the documentation graph. Use whenever new documentation is needed — a PRD, TRD, ADR, threat model, runbook, domain spec, guide or README.
allowed-tools: Bash(docgov *) Read Write Edit
argument-hint: "<type> \"<name>\" [--domain <domain>]"
---

# Create a governed document

## Before writing anything

1. **Check it does not already exist.** Run `docgov create <type> "<name>" --check --json`.
   It writes nothing and tells you who already owns the topic: `create-new` means go ahead,
   `review-first` names documents worth reading first, and `update-existing` names the
   document you should be editing instead. Read the named documents before you decide it is
   wrong — a second document on the same subject is how contradictions are born.
   For a wider look across every class, `docgov find "<topic>"` returns results in authority
   order.

2. **Pick the class.** `docgov types` lists all 56. If the user said "write docs for X",
   decide which class X actually is rather than defaulting to a guide. Do not invent a class.

3. **Load the authoritative context.** Run `docgov brief <domain-or-topic>`. Read it
   before writing. It carries the constitution, the canonical spec, the invariants in
   force and the machine contracts — the things your document must not contradict.

## Create it

```bash
docgov create <type> "<name>" --domain <domain>
```

This puts the file in the canonical location, applies the template, declares the right
authority and visibility, and wires `depends_on` / `implements` edges from documents it
found to be related. It prints the required sections and the line limits.

If it refuses because an existing document already owns the name, that is the answer: go and
edit that document. `--force` exists, but using it means the new document must say how it
differs from the one it now sits beside.

## Then write it

- **Fill every required section.** They are a deterministic gate: a TRD with no failure
  analysis fails `docgov check`, and rightly so.
- **Stay inside the limit** the command printed. If the content genuinely needs more, the
  document is probably two documents.
- **Reference, do not restate.** Machine contracts (OpenAPI, schemas, migrations) are
  authoritative; link them. Copying a schema into prose creates a second source of truth
  that will be wrong within a month.
- **Declare invariants** if this is a canonical document. Any line beginning
  `INV-<DOMAIN>-001` becomes a first-class object that gets injected into every agent that
  later touches the matching code. This is the highest-value thing you can write.
- **Map the code** this document describes, in frontmatter: `documents: ["src/licensing/**"]`.
  Without it the document is invisible to drift detection.
- **Write for the class's audience.** A README is not an architecture document. A runbook
  is numbered steps with expected results, not an essay.

## Finish

Run `docgov check --path <new-file>` and fix what it reports. Then `docgov affected` to see
whether creating this document obliges you to update anything else.
