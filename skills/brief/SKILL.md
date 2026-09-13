---
name: brief
description: Load the minimal authoritative documentation context for a topic or domain before changing code — the constitution, the canonical specification, the invariants in force, the relevant ADRs and the machine contracts, and nothing else. Use before implementing or modifying anything in a governed area.
allowed-tools: Bash(docgov *) Read
argument-hint: "<domain-or-topic>"
---

# Authoritative context

!`docgov brief $ARGUMENTS 2>&1 | head -c 28000`

## How to use this

Everything above is authoritative and ordered: the most authoritative document is first.
It replaces reading the documentation tree — that is the point, and it is why the pack is
small.

**The rules while you work in this area:**

1. **Invariants are binding.** If one blocks your approach, the invariant wins. Changing it
   means changing its source document in the same change, with a stated reason. Do not
   route around it.

2. **Machine contracts beat prose.** Where a schema, OpenAPI document or migration is
   listed, it is authoritative over any description of it, including the one in this pack.

3. **Lower authority may not contradict higher.** If you find the canonical specification
   and a guide disagreeing, the canonical specification is right and the guide is a bug.

4. **If the pack is wrong, fix the document.** Do not write code that works around
   incorrect documentation and leave the documentation incorrect — that is exactly the
   state this product exists to prevent.

5. **"Not included in full"** entries are real documents that did not fit the budget. Read
   them directly if your change touches what their headings describe.

After you change code here, run `/docgov:affected` to find out which of these documents you
now owe an update.
