---
name: onboard
description: Inventory, classify and produce a migration plan for a repository that already has documentation. Detects duplicates, contradictions, oversized documents, wrong locations, missing frontmatter and coverage gaps, then writes a plan that changes nothing until approved. Use for existing repositories, messy documentation trees, or "organize my docs".
disable-model-invocation: true
allowed-tools: Bash(docgov *) Bash(git status*) Bash(git log*) Read Write Edit
---

# Onboard an existing repository

## Plan

!`docgov onboard --json --compact 2>&1 | head -c 24000`

## What to do

The JSON above is the full plan; `.docgov/onboarding-plan.md` is the human-readable version.
**Nothing has been changed.**

1. **Summarize honestly, shortest first.** How many documents, how many DocGov could not
   classify, how many moves, how many real judgement calls. Do not pad the summary with
   the things that went fine.

2. **Work the low-confidence classifications.** `classifications[]` entries with
   `needsReview: true` are where the deterministic classifier gave up. Read each document
   (just enough of it) and decide its class yourself. Run `docgov types` if you need the
   list. Then write the decision into the document's frontmatter:

   ```
   docgov:
     id: <kebab-id>
     type: <class>
     authority: <from the class>
     visibility: internal|public|confidential
   ```

   Declaring the type is what turns a guess into a fact — the classifier never overrides
   a declared type.

3. **Adjudicate the contradiction candidates.** `contradictionCandidates[]` is a narrowed
   list, not a verdict. For each pair, read both and decide: genuine contradiction,
   acceptable overlap (different audiences saying the same thing in different words), or
   genuine duplicate. Use the `architect` agent for the non-obvious ones. Only real
   contradictions need fixing, and the higher-authority document is the one that is right
   unless you have a reason to think otherwise.

4. **Propose, do not perform, the high-risk actions.** `SPLIT`, `MERGE` and `EXTRACT`
   rewrite prose. Present them to the user as a short list with your recommendation, and
   handle them one at a time through `/docgov:organize`.

5. **When the user approves, run the mechanical half:**
   ```bash
   docgov migrate --dry-run     # every file operation, nothing touched
   docgov migrate               # on a branch, with link repair and verification
   ```
   `migrate` refuses to run without git or with a dirty tree. That is deliberate: the
   "no information lost" promise is only real if every change is revertible.

6. **Verify.** After migrating, run `docgov check` and `docgov health`. Report the health
   score and the top three things that would raise it most.

## Do not

Do not move files yourself — `migrate` repairs links in the same transaction and your
`mv` will not. Do not merge two documents' prose without showing the user what you are
about to delete.
