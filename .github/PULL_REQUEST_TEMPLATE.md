## What this changes

<!-- One or two sentences. -->

## Why

<!-- The problem, not the patch. -->

## Checklist

- [ ] `npm test` passes
- [ ] `./bin/docgov check` passes
- [ ] New non-trivial logic has a test that fails if the logic breaks
- [ ] If this adds or changes a **rule**: it is decidable by software, and the PR says
      whether it blocks or warns and in which project modes
- [ ] If this adds a **document class**: `npm test` still passes the
      "every document class produces a document that satisfies its own gate" test
- [ ] If this changes behaviour users rely on: `CHANGELOG.md` updated
