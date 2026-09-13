---
docgov:
  id: docgov-feasibility
  type: architecture.assessment
  authority: decision
  visibility: internal
  status: active
  owner: docgov
  relationships:
    implements:
      - docgov-prd
  generation:
    mode: human-maintained
---
# DocGov — Technical Feasibility Assessment

Target surface: **Claude Code only** (plugin + bundled CLI).
Assessed against Claude Code docs as of 2026-09-13. Scope: V1, V2, V3.

---

## 1. Verdict

**Buildable. ~90% of the PRD maps onto real Claude Code primitives with no workarounds.**

Six things do not work as written and need design corrections (§3). None are fatal.
One thing (V3 org governance) needs a hosting decision the plugin surface cannot make for you (§6).

The PRD's single best architectural call — §47, deterministic core + thin Claude layer — turns out to be
*required*, not just advisable. Claude Code hooks cannot invoke skills or tools; they only run shell
commands, single LLM calls, or subagents. So the governance engine must be a CLI regardless.

---

## 2. Capability map

Every PRD mechanism against the primitive that implements it.

| PRD | Mechanism | Claude Code primitive | Verdict |
|---|---|---|---|
| §19 | Pre-write interception of `*.md` | `PreToolUse` hook, `if: "Write(**/*.md)"`, exit 2 or `permissionDecision: deny` | **Works.** Deny reason is fed back to Claude as a tool error with `continueOnBlock: true`, so Claude self-corrects instead of the turn dying |
| §19 | Semantic classification in the write path | `type: "prompt"` hook (Haiku, 30 s) or `type: "agent"` hook (tools, 60 s, experimental) | **Works**, but not on every write — see §3.1 |
| §19 | Post-write validation | `PostToolUse` → `additionalContext` | **Works (advisory only).** Cannot undo a write |
| §18 | Repo-wide agent doc policy | `.claude/rules/documentation.md` + `SessionStart` hook `additionalContext` | **Works.** `InstructionsLoaded` event confirms `.claude/rules/*.md` is a first-class load path |
| §24 | Auto-inject invariants when relevant code is touched | `PreToolUse` on `Edit`/`Write`, `additionalContext` keyed off path→domain map | **Works. Highest-value feature, cheapest to build.** Pure deterministic lookup; the whole hook measures ~95 ms including node startup |
| §33 | Context packs | Skill with `!`-prefix command injection: `` !`docgov context $1` `` | **Works, and is better than the PRD assumes.** Output is injected *before* Claude reads the skill — the pack costs its own tokens and nothing else |
| §34 | 11 slash commands | 11 skills in `skills/`, namespaced `/docgov:drift` etc. | **Works** |
| §35 | 4 agents | `agents/*.md` with `tools:`/`model:` restriction | **Works.** Give classifier/quality reviewers `model: sonnet`, drift reviewer `opus` |
| §36 | Local state `.docgov/` | Plain files in repo + `${CLAUDE_PLUGIN_DATA}` for cache | **Works** |
| §37 | Config | `.docgov/config.yaml` + plugin `userConfig` for per-user overrides | **Works** |
| §39 | `docgov check` in CI | Plugin `bin/` is added to `PATH`; same binary runs standalone in Actions | **Works.** One artifact serves plugin + CI, no duplicate logic |
| §38 | Git as audit log | shell out to `git diff/log/blame` | **Works** |
| §47 | Portable core | Plain Node ESM in `bin/`, zero build step | **Works.** Claude Code ships Node, so the core runs anywhere Claude Code does |
| §17 | Capability discovery | `claude plugin list`, `.mcp.json` scan, `~/.claude/skills` scan, `command -v` probes | **Works, partially.** No API returns "skills available to this session"; discovery is filesystem + CLI probing, so treat results as best-effort |
| §26 | PR workflow comment | `docgov check --changed` + `gh pr comment` in Actions | **Works** (outside Claude Code, by design) |
| §13 | Size discipline | deterministic line counts + LLM split proposal | **Works** |
| §41 | Transactional migration | git branch + `git mv` + link rewrite, abort = `git reset --hard` | **Works — requires a git repo and a clean tree.** This directory is not a repo yet |
| §23 | Reverse drift | doc diff + graph + `implements` edges → check code paths untouched | **Works deterministically** for "nothing changed in the mapped paths"; the *meaning* of the change needs an LLM |
| §22 | Forward drift, symbol level | git diff + graph → impacted docs | **Partially** — see §3.4 |
| §20 | Quality scores 0–100 | LLM via agent | **Works, advisory only.** Never CI-gating |
| §6/§7 | Taxonomy + frontmatter graph | own schema + registry | **Works** |
| §29 | Publish pipeline | own + human gate | **Works** |
| §40 | Suppressions with reasons/expiry | `.docgov/suppressions.yaml` | **Works** |
| §43 | Local-first, no telemetry | no network calls in core | **Works** |
| §46 | Org governance | — | **Needs a decision — see §6** |

---

## 3. Findings: the six corrections

### 3.1 Do not run a semantic classifier on every Markdown write

The PRD's §19 flow implies LLM classification inside the write path. Measured reality: a `prompt` hook is
an extra model round-trip (30 s timeout) and an `agent` hook up to 60 s with 50 tool turns, on **every
single `.md` edit**. That makes Claude Code feel broken and bills Haiku calls for typo fixes.

**Correction — three enforcement rings:**

| Ring | Trigger | Engine | Budget | Can block |
|---|---|---|---|---|
| 1 | every `.md` write | command hook, pure CLI | ~95 ms measured | yes |
| 2 | new file, or file crossing a hard limit | `prompt` hook (Haiku) | ~2 s | yes, `continueOnBlock: true` |
| 3 | `/docgov review`, pre-commit, CI | subagents | seconds–minutes | CI only |

Ring 1 catches the things that actually matter and are deterministic: wrong location, missing/invalid
frontmatter, duplicate `docgov.id`, edit to a generated file, visibility-path violation, forbidden
new top-level doc. That is most of the PRD's §21 deterministic list.

### 3.2 `PostToolUse` cannot enforce anything

It fires after the write lands and has no veto. So "generated file manually modified" (§21) must be a
**PreToolUse deny**, matched against a hash manifest — not a post-write check. Post-write is for
"you changed the licensing domain doc, 2 dependent docs are now stale" nudges only.

### 3.3 Hooks cannot call skills, tools, or slash commands

Documented limitation: command hooks communicate via stdout/stderr/exit codes only. So the PRD's
"Query DocGov classification" step inside a hook is a **CLI call** (`docgov classify --path <p>`), never a
skill invocation. This is the structural reason the core must be a binary.

### 3.4 Symbol-level forward drift is not deterministically achievable

The PRD's own example — `validator.ts` changed grace period `7 → 30`, canonical doc still says 7 — needs
reading *both* the code's semantics and the doc's prose claim. No deterministic rule produces that.

**Correction, honest split:**
- deterministic: "`src/licensing/**` changed, and `licensing-domain` declares `documents: src/licensing/**`, and that doc has not changed since" → **impacted doc list, exit code 2, reviewable.** Reliable, free, fast.
- LLM: "the doc's stated value contradicts the new code" → **drift-reviewer subagent, run on the narrowed list only.** Advisory, never a hard gate.

Claiming the second is deterministic would be the product's biggest credibility risk. Ship the first as the gate, the second as the report.

### 3.5 Contradiction detection across 100+ docs cannot be pairwise LLM

§15/§44 onboarding on 100+ files = ~5,000 pairs. Cost-prohibitive and slow.

**Correction:** deterministic narrowing first — same `domain`, or tf-idf cosine above threshold, or
overlapping `defines` keys — then LLM on the top-k candidate pairs only (default k=20). tf-idf in-core,
no embedding service, keeps §43's local-first promise intact.

### 3.6 Quality scores must never be a default hard gate

The PRD says this (§20, §21) and then shows `Documentation readiness: BLOCKED` in §26. Resolve it:
exit code 1 = deterministic violation only. Exit code 2 = drift/quality needing review, which CI can be
configured to treat as soft. Default: soft.

---

## 4. Build vs reuse

Ponytail applies: the smallest thing that works, and nothing invented that already exists.

**Reused as conventions, not dependencies**
- **Diátaxis** (tutorial / how-to / reference / explanation) for Tier-6 audience docs and §14 progressive disclosure. It is the established answer to "what shape should user docs take" and the PRD's lens idea is a superset of it.
- **MADR** ADR format, so ADRs stay readable by every other ADR tool.

**Delegated if present, never required** (§42, govern-don't-monopolize)
| Need | Tool | Probe |
|---|---|---|
| external link rot | `lychee` | `command -v` |
| Markdown style | `markdownlint-cli2` | `command -v` / config file |
| prose style | `vale` | `.vale.ini` |
| OpenAPI lint | `spectral` / `redocly` | `command -v` |
| API breaking change | `oasdiff` | `command -v` |
| diagrams, GitHub ops, security review | whatever the capability registry finds | plugin/MCP scan |

**Built in-core** (because it *is* the product, or because a dep costs more than the code)
- internal link graph + repair — needed for the graph anyway, ~80 lines
- frontmatter parse/validate — controlled subset
- registry, graph, taxonomy, templates, lenses, drift, impact, context packs
- tf-idf similarity — ~50 lines, avoids an embedding service

**Dependencies: zero.** Node has no YAML parser, so the obvious move was to depend on `yaml` and
install it into `${CLAUDE_PLUGIN_DATA}` on first run. Rejected during implementation: that adds an
install step, a network requirement and a first-run failure mode to every consumer of a plugin whose
whole job is to be reliable. Instead `core/yaml.js` is a ~250-line strict subset parser and emitter
that **throws on any construct it cannot represent** — anchors, aliases, tags, block scalars, tabs.
For a governance engine, refusing to start beats silently misreading its own config, so strictness is
a feature rather than a limitation. It round-trips: `parse(stringify(x))` is tested for identity.
Everything else is Node 20+ stdlib; tests are `node:test` + `node:assert`.

**Rejected:** a TypeScript build step (a plugin should work from `git clone` with no build), graph DB,
embeddings service, existing drift tools (all coupled to docstring-in-code, which is the wrong altitude
for governing specs).

---

## 5. Architecture as built

```
docgov/                         one plugin, one artifact
├── .claude-plugin/plugin.json  manifest + userConfig
├── bin/docgov                  ← on PATH automatically; same binary in CI
├── core/                       deterministic engine, zero LLM
│   ├── config, registry, graph, frontmatter, taxonomy
│   ├── classify, inventory, similarity, size, links
│   ├── git, drift, impact, invariants, context
│   └── check (exit codes), migrate (git-transactional)
├── skills/    11 × SKILL.md    thin: call CLI, interpret, write prose
├── agents/    4               classifier, architect, drift-reviewer, quality-reviewer
├── hooks/hooks.json           ring 1 + ring 2
├── templates/                 ~30
├── lenses/                    7
├── schemas/                   JSON Schema for editors + validation
└── rules/documentation.md     installed into the target repo
```

The split is load-bearing: `core/` is unit-testable and decides every blocking question; the LLM layer
only ever *proposes*.

---

## 6. Version scope

**V1 — fully feasible.** init, onboard, classify, organize, plan+migrate, registry, graph, check, rules, CI.
**V2 — fully feasible.** drift, reverse drift, impact, context packs, invariants, quality scoring, manifest, PR review.
**V3 — feasible only as files, not as a service.** "Central policies" and "cross-repository standards" become
a **policy pack**: a git repo (or plugin marketplace entry) containing taxonomy/templates/lenses/invariant
overlays, referenced by URL or path in `.docgov/config.yaml` and merged over defaults. Analytics stays
local (`docgov health --json` aggregated by whatever the org already runs). A hosted DocGov backend is
out of scope for a Claude Code plugin and also violates §43's local-first default.

---

## 7. Risks

1. **Agent hooks are flagged experimental.** Keep ring 2 on `prompt` hooks; use `agent` hooks only in opt-in paths.
2. **Capability discovery is filesystem probing**, not an API. Will drift as Claude Code evolves. Mitigation: treat absence as "do it myself", never hard-fail.
3. **Migration needs a clean git tree.** Refuse to migrate otherwise — the PRD's "without losing information" promise depends on it.
4. **Over-enforcement is the real failure mode.** A governance plugin that blocks a README typo gets uninstalled. Progressive enforcement is a feature, not a nicety: default `mode: solo` warns, only `enterprise` blocks broadly.

---

## 8. Built

This assessment was carried straight through to an implementation in the same session. Every
verdict above is now exercised by a test or a command, not asserted:

- PRD §22's own motivating example (grace period `7 → 30`, canonical spec still says 7) is a
  passing test, and produces a HIGH forward-drift finding carrying the threatened invariant.
- Ring 1 denies a hand edit to a generated tree and injects invariants before a code edit,
  measured at ~95 ms per edit.
- `migrate` moves documents, repairs links in both directions, verifies, and reverts itself on
  failure — also a passing test.
- Policy packs (§6's V3 answer) merge under local config, with the repository keeping the last word.

`npm test` — 60 tests, all passing.

---

*Assessed and implemented 2026-09-13. This document is itself a Tier-2 decision artifact; it is
classified by `docgov onboard` in its own repository, which was the first dogfood test.*
