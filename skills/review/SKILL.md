---
name: review
description: Review documentation quality against its audience lens, find contradictions between documents, and check whether another agent could safely act on a document. Use for "review my docs", documentation quality checks, contradiction hunting, or before publishing.
allowed-tools: Bash(docgov *) Read
argument-hint: "[--path <file>] [--contradictions] [--lens readme|developer|architecture|security|user|agent|operations]"
---

# Review documentation

## Deterministic findings (already decided, do not re-litigate)

!`docgov check --json --compact 2>&1 | head -c 10000`

## What to review

Everything above is settled by software. Your job is the part software cannot decide.
Work only on these four questions, and say plainly when the answer is "this is fine".

### 1. Audience fit — apply the right lens

Read the lens for the document's class in `lenses/<lens>.md` and judge against it, not
against your general taste. The lenses are: `readme`, `developer`, `architecture`,
`security`, `user`, `agent`, `operations`. A document that is excellent under the wrong
lens is a defect: an architecture essay inside a getting-started guide fails even if every
sentence is true.

### 2. Contradictions

Run `docgov review contradictions --json`. You get narrowed candidate pairs with excerpts,
not a verdict. For each:
- **Genuine contradiction** — two documents state incompatible facts. The higher-authority
  document is presumed right; name which one must change and why.
- **Equal authority** — no tie-break exists. This is the dangerous case. Escalate it to the
  user rather than picking.
- **Acceptable overlap** — different audiences saying the same thing differently. Leave it.

Quote the conflicting sentences. A contradiction report without the two sentences in it is
unactionable.

### 3. Agent readiness

Could a different agent act on this document without making a wrong assumption? Check for:
unstated prerequisites, `TBD`/`TODO` that reads as fact, examples that cannot run as
written, stale version numbers, and claims with no source. This lens matters more every
month and is the one humans skip.

### 4. Quality scores — advisory, and say so

Run `docgov review quality --json` for the deterministic dimensions (structure, grounding,
cross-references, freshness). Add your judgement on clarity, completeness, audience fit and
security reasoning. Present the result as advice with the reasoning attached, never as a
pass/fail. Do not tell the user a document "scores 87" without saying what the missing 13
actually is.

## Output

Findings ordered by what you would fix first, each with the file, the line or section, and
the concrete edit. No scores without reasons. No praise padding.
