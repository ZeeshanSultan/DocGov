---
docgov:
  id: examples-policy-packs-readme
  type: docs.index
  authority: audience
  audience:
    - engineering
  visibility: internal
  status: active
  generation:
    mode: human-maintained
---
# Policy packs

DocGov's organizational governance layer. A pack is a directory of configuration that
layers under a repository's own `.docgov/config.yaml`.

```yaml
# in a repository's .docgov/config.yaml
policy_packs:
  - ../org-policy/regulated        # a path, a vendored copy, or a submodule
```

## Merge order

```
defaults  <  policy pack  <  repository config
```

The organization raises the floor; the repository keeps the last word. A pack that could
silently override a repository would make every repository's visible configuration
misleading, and people would stop reading it — which is worse than no central policy.

When a repository must not be able to relax something, enforce it in CI rather than in the
merge order: run `docgov check` with the pack applied and a repository config you control.

## What a pack may set

Anything in [`schemas/config.json`](../../schemas/config.json): mode, quality thresholds,
limits, visibility paths, generated paths, drift severity gates, domains, contracts.

Packs may also ship shared assets, which DocGov picks up from the pack directory:

```
org-policy/regulated/
├── policy.yaml
├── templates/          # overrides for specific document classes
└── lenses/             # custom or stricter review lenses
```

## What a pack deliberately cannot do

- **Phone home.** There is no DocGov service and no telemetry. Distribution is git.
- **Define new document classes that only it understands.** A repository whose documents
  cannot be read by a plain DocGov install is a repository locked to your pack.
- **Publish anything.** Publication always crosses a human gate (see `/docgov:publish`).
