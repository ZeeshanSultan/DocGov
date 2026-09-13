---
name: health
description: Score documentation health across coverage, freshness, consistency, structure, discoverability, cross-linking, canonical integrity and metadata, and list the gaps the repository's own stack implies. Use for "how are my docs doing", documentation audits, or a periodic review.
allowed-tools: Bash(docgov *) Read
---

# Documentation health

!`docgov health --json --compact 2>&1 | head -c 8000`

## How to report this

1. **The score, then the single highest-leverage fix.** Not eight bullet points of
   component scores the user has to rank themselves. Lead with: "91/100. The one thing
   worth fixing is X."

2. **Explain any component below 80 in terms of what is actually wrong** — the files, not
   the metric. "Freshness 67" means nothing; "four canonical documents have had no review
   while the code they describe changed 30 times" is a fact someone can act on.

3. **Coverage gaps are the most actionable part.** Each one means the repository's stack
   implies documentation that does not exist — Kubernetes manifests with no deployment
   guide, OAuth with no authentication model. Offer to create the top two or three with
   `/docgov:create`.

4. **Do not recommend raising the score.** Recommend fixing specific documents. A score
   that goes up because someone added frontmatter to archived notes is worse than a score
   that stays flat.

## Context for the numbers

- **canonical integrity** below 100 is the serious one: it means the authority model itself
  has been violated, and every other number is built on sand.
- **coverage** counts both what is classified and what the stack implies should exist.
- **freshness** is semantic, not calendar-based — a correct document that has not changed
  in two years scores fine.
