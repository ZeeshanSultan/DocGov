import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as yaml from '../core/yaml.js';
import * as fm from '../core/frontmatter.js';
import { Document } from '../core/document.js';
import { classify, destinationFor } from '../core/classify.js';
import { globToRegExp, matchGlob } from '../core/util.js';
import { collect as collectInvariants, applicable, render as renderInvariants } from '../core/invariants.js';
import { similarPairs } from '../core/similarity.js';
import { rewriteLinks, brokenLinks } from '../core/links.js';
import { assess, splitCandidates, readmeOverreach } from '../core/size.js';
import * as check from '../core/check.js';
import * as cfgmod from '../core/config.js';
import * as reg from '../core/registry.js';
import * as graphmod from '../core/graph.js';
import * as inv from '../core/inventory.js';
import * as driftmod from '../core/drift.js';
import * as impactmod from '../core/impact.js';
import * as supp from '../core/suppressions.js';
import { scan as scanLeaks } from '../core/publish.js';
import { find } from '../core/find.js';
import { pack, compile, render } from '../core/context.js';
import { whoOwns } from '../core/responsibility.js';
import * as judgemod from '../core/judgements.js';
import * as onboardmod from '../core/onboard.js';
import * as migratemod from '../core/migrate.js';
import * as doctormod from '../core/doctor.js';
import * as tax from '../core/taxonomy.js';
import * as lensmod from '../core/lenses.js';
import * as competingmod from '../core/competing.js';
import { EXIT } from '../core/util.js';

const BIN = fileURLToPath(new URL('../bin/docgov', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}
function wf(dir, rel, content) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}
function commit(dir, msg = 'x') {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' });
  if (staged.trim() === '') return;
  execFileSync('git', ['commit', '-qm', msg, '--no-verify'], { cwd: dir });
}
function cli(dir, args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}
function snapshot(dir) {
  const { cfg } = cfgmod.load(dir);
  const i = inv.inventory(dir, cfg);
  const { registry } = reg.build(i.documents, i.contracts);
  const graph = graphmod.build(i.documents, registry, cfg, i.contracts);
  return { root: dir, cfg, inv: i, docs: i.documents, registry, graph };
}

// ───────────────────────────── yaml ─────────────────────────────

test('yaml: round-trips nested maps, sequences and scalar types', () => {
  const src = 'a: 1\nb:\n  c: true\n  d: [x, y]\nlist:\n  - id: one\n    n: 2\n  - id: two\ne: null\nf: "quoted: colon"\n';
  const v = yaml.parse(src);
  assert.deepEqual(v, { a: 1, b: { c: true, d: ['x', 'y'] }, list: [{ id: 'one', n: 2 }, { id: 'two' }], e: null, f: 'quoted: colon' });
  assert.deepEqual(yaml.parse(yaml.stringify(v)), v, 'emit → parse must be identity');
});

test('yaml: strips comments outside quotes, keeps # inside them', () => {
  assert.deepEqual(yaml.parse('a: 1 # comment\nb: "has # hash"\n'), { a: 1, b: 'has # hash' });
});

test('yaml: refuses constructs it cannot represent rather than guessing', () => {
  for (const bad of ['a: &anchor 1\n', 'a: *ref\n', 'a: !!str 1\n', 'a: |\n  block\n', 'a:\n\tb: 1\n']) {
    assert.throws(() => yaml.parse(bad), /not supported/, `should refuse: ${JSON.stringify(bad)}`);
  }
});

test('yaml: quotes scalars that would otherwise change type on re-read', () => {
  const round = yaml.parse(yaml.stringify({ a: 'true', b: '123', c: 'null', d: '' }));
  assert.deepEqual(round, { a: 'true', b: '123', c: 'null', d: '' });
});

// ───────────────────────────── frontmatter ─────────────────────────────

test('frontmatter: parses, preserves the body byte-for-byte, and patches docgov only', () => {
  const src = '---\ndocgov:\n  id: x\ntitle: T\n---\n# H\n\nbody  with   spacing\n';
  const p = fm.parse(src);
  assert.equal(p.data.docgov.id, 'x');
  assert.equal(p.body, '# H\n\nbody  with   spacing\n');
  const patched = fm.patchDocgov(src, { status: 'active' });
  const p2 = fm.parse(patched);
  assert.equal(p2.data.docgov.status, 'active');
  assert.equal(p2.data.docgov.id, 'x', 'existing keys survive the patch');
  assert.equal(p2.data.title, 'T', 'non-docgov frontmatter is untouched');
  assert.equal(p2.body, p.body, 'body must not change');
});

test('frontmatter: inserting a docgov block puts it first and keeps other keys', () => {
  const out = fm.patchDocgov('---\ntitle: T\n---\n# H\n', { id: 'a' });
  assert.match(out, /^---\ndocgov:\n  id: a\ntitle: T\n---\n/);
});

test('frontmatter: sections ignore headings inside code fences', () => {
  const s = fm.sections('## Real\n\n```\n## Fake\n```\n\n## Also real\n');
  assert.deepEqual(s.map((x) => x.title), ['Real', 'Also real']);
});

test('headings: ordinal prefixes are stripped without eating real words', async () => {
  const { normalizeHeading } = await import('../core/document.js');
  // The Roman-numeral branch must require a separator. Without it, [ivxlc]+ eats the first
  // letter of ordinary headings and every required section starting with c/d/i/l/m/v/x
  // silently stops matching — a defect that looks like a documentation problem, not a bug.
  for (const word of ['Verdict', 'Install', 'Context', 'Decision', 'Model', 'Limits', 'Usage', 'Validation', 'Dependencies']) {
    assert.equal(normalizeHeading(word), word.toLowerCase(), `"${word}" must survive normalization intact`);
  }
  assert.equal(normalizeHeading('1. Verdict'), 'verdict');
  assert.equal(normalizeHeading('2.1 Goals'), 'goals');
  assert.equal(normalizeHeading('IV. Context'), 'context');
  assert.equal(normalizeHeading('iii) Threats'), 'threats');
  assert.equal(normalizeHeading('Step 3 — Rollback'), 'rollback');
  assert.equal(normalizeHeading('Non-goals'), 'non goals');
});

test('required sections match numbered headings', () => {
  const src = '---\ndocgov:\n  id: a\n  type: architecture.adr\n---\n'
    + '# A\n\n## 1. Status\n\n## 2. Context\n\n## 3. Decision\n\n## IV. Alternatives\n\n'
    + '## 5. Consequences\n\n## 6. Security implications\n';
  const d = new Document('/tmp', 'a.md', src);
  assert.deepEqual(d.missingSections(), [], 'numbered and Roman-numbered headings must satisfy the gate');
});

// ───────────────────────────── glob ─────────────────────────────

test('glob: ** crosses path segments, * does not', () => {
  assert.ok(matchGlob('src/a/b/c.ts', 'src/**/*.ts'));
  assert.ok(matchGlob('src/c.ts', 'src/**/*.ts'), '** must match zero segments');
  assert.ok(!matchGlob('src/a/b.ts', 'src/*.ts'));
  assert.ok(matchGlob('a.yaml', '*.{yaml,yml}'));
  assert.ok(!matchGlob('docs/other/x.md', 'docs/internal/**'));
  assert.ok(matchGlob('docs/internal/deep/x.md', 'docs/internal/**'));
});

// ───────────────────────────── classifier ─────────────────────────────

test('classifier: declared type always wins over heuristics', () => {
  const doc = { path: 'README.md', body: '# x', frontmatter: { docgov: { type: 'architecture.adr' } } };
  const c = classify(doc);
  assert.equal(c.type, 'architecture.adr');
  assert.equal(c.confidence, 100);
  assert.ok(c.declared);
});

test('classifier: recognizes the obvious classes with high confidence', () => {
  const cases = [
    ['README.md', '# Project\n\n## Install\n\n## Usage\n', 'user.readme'],
    ['docs/adr/0003-use-postgres.md', '## Status\n\naccepted\n\n## Decision\n', 'architecture.adr'],
    ['docs/runbooks/db-failover.md', '## Trigger\n\n## Diagnostics\n\n## Procedure\n', 'operations.runbook'],
    ['docs/threat-model.md', 'trust boundary and threat actor analysis\n', 'security.threat-model'],
    ['CONTRIBUTING.md', '# Contributing\n', 'governance.contributing'],
  ];
  for (const [p, body, want] of cases) {
    const c = classify({ path: p, body, frontmatter: {} });
    assert.equal(c.type, want, `${p} → expected ${want}, got ${c.type}`);
  }
});

test('classifier: admits when it does not know instead of guessing confidently', () => {
  const c = classify({ path: 'docs/thoughts.md', body: 'some prose with no signal whatsoever\n', frontmatter: {} });
  assert.ok(c.needsReview, 'an unsignalled document must be flagged for review');
});

test('classifier: a singleton class only wins at its canonical path', () => {
  const body = '# T\n\n## Install\n\n## Usage\n';
  assert.equal(classify({ path: 'README.md', body, frontmatter: {} }).type, 'user.readme');
  const nested = classify({ path: 'docs/guides/README.md', body, frontmatter: {} });
  assert.equal(nested.type, 'docs.index', 'a nested README is a directory index, not THE README');
  assert.equal(destinationFor({ project: { layout: 'compact' } }, 'docs.index', 'docs/guides/README.md'),
    'docs/guides/README.md', 'an index belongs to its own directory and must never be relocated');
});

test('classifier: attribution notices are a class, and they stay at the root', () => {
  // Unclassified, THIRD-PARTY-NOTICES.md was proposed for docs/10-internal/ — hiding a
  // public legal notice and marking it internal. The filename varies by ecosystem.
  const body = '# Notices\n\n| memory-pager | 1.5.0 | MIT |\n';
  for (const f of ['THIRD-PARTY-NOTICES.md', 'NOTICE.md', 'ATTRIBUTIONS.md', 'CREDITS.md']) {
    const { type } = classify({ path: f, body, frontmatter: {} });
    assert.equal(type, 'governance.attribution', `${f} must classify as an attribution notice`);
    assert.equal(destinationFor({ project: { layout: 'full' } }, type, f), f, `${f} must stay put`);
  }
  assert.notEqual(classify({ path: 'docs/notes.md', body, frontmatter: {} }).type,
    'governance.attribution', 'the signal must not swallow an ordinary note');
});

test('classifier: a hyphenated dependency name does not read as a runbook signal', () => {
  // `\bpager\b` matched `memory-pager` in a third-party licence table — a hyphen is a
  // word boundary — and proposed moving THIRD-PARTY-NOTICES.md into docs/…/runbooks/.
  const licences = '# Third-Party Notices\n\n| memory-pager | 1.5.0 | MIT |\n'
    + '| node-severity-x | 2.0.0 | MIT |\n';
  assert.notEqual(classify({ path: 'THIRD-PARTY-NOTICES.md', body: licences, frontmatter: {} }).type,
    'operations.runbook', 'a licence table is not a runbook');
  const runbook = '# On-call\n\nOn a SEV-1, escalate to the pager rota. Severity is assessed first.\n';
  assert.equal(classify({ path: 'docs/ops/oncall.md', body: runbook, frontmatter: {} }).type,
    'operations.runbook', 'a real runbook must still be recognised');
});

test('classifier: files other tools locate by path are never relocated by layout', () => {
  // GitHub reads README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY and SUPPORT from the
  // repository root; Claude Code reads CLAUDE.md, Gemini CLI GEMINI.md, Copilot
  // .github/copilot-instructions.md. Moving any of them is a silent breakage, not a
  // tidy-up: `full` layout used to send SECURITY.md to docs/11-external/security.md and
  // SUPPORT.md into docs/09-governance/, where GitHub stops finding either.
  const body = '# T\n\n## Install\n\n## Usage\n';
  const rooted = ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md',
    'SUPPORT.md', 'CHANGELOG.md', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md',
    '.github/copilot-instructions.md'];
  for (const layout of ['full', 'compact']) {
    for (const f of rooted) {
      const { type } = classify({ path: f, body, frontmatter: {} });
      assert.equal(destinationFor({ project: { layout } }, type, f), f,
        `${f} must not move in ${layout} layout`);
    }
  }
  // and the agent files must not all collapse onto CLAUDE.md, which would be a collision
  const dests = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'].map((f) =>
    destinationFor({ project: { layout: 'full' } }, classify({ path: f, body, frontmatter: {} }).type, f));
  assert.equal(new Set(dests).size, 3, 'three agent files, three distinct destinations');
});

test('classifier: prose alone never makes a classification trustworthy', () => {
  // Where a document sits is a decision somebody made; a regex matching its prose is a
  // guess. Scoring both on one scale made a correct path match and a bad prose match
  // indistinguishable — a branching model read as a runbook, at the same confidence as a
  // genuine getting-started page.
  const prose = '# Branching model\n\nOn a SEV-1 we escalate to the on-call pager rota.\n';
  const byProse = classify({ path: 'docs/content/en/contributing/branching-model.md', body: prose, frontmatter: {} });
  assert.ok(byProse.needsReview, 'a content match alone must not be trusted');

  const byPath = classify({ path: 'docs/content/en/getting_started/installation.md', body: '# Install\n\nRun it.\n', frontmatter: {} });
  assert.equal(byPath.type, 'user.getting-started');
  assert.ok(!byPath.needsReview, 'a documentation layout somebody chose is evidence');
});

test('classifier: a lone candidate is not a close call', () => {
  // Gap was measured against a rival that did not exist, so an unrivalled classification
  // scoring 11 was reported as contested against nothing. Weak evidence is the structural
  // floor's job; ambiguity needs two candidates.
  const r = classify({ path: 'docs/runbooks/oncall.md', body: '# On-call\n\nSteps.\n', frontmatter: {} });
  assert.equal(r.type, 'operations.runbook');
  assert.ok(r.candidates.length >= 1);
  if (r.candidates.length === 1) assert.ok(!r.needsReview, 'nothing competes with it');
});

test('classifier: a misplaced singleton is still classified, not left unknown', () => {
  // Deleting off-canonical singletons left nothing to report: `docs/CODE_OF_CONDUCT.md`
  // came back `unknown` / "no signal matched", when being in the wrong place is precisely
  // what should have been said about it.
  const body = '# Code of conduct\n\nBe decent.\n';
  const off = classify({ path: 'docs/CODE_OF_CONDUCT.md', body, frontmatter: {} });
  assert.equal(off.type, 'governance.code-of-conduct');
  assert.ok(off.needsReview, 'low confidence off its canonical path');
  assert.ok(off.signals.some((w) => w.includes('canonical path')), 'it must say why');
  const at = classify({ path: 'CODE_OF_CONDUCT.md', body, frontmatter: {} });
  assert.ok(at.confidence > off.confidence, 'the canonical location must still win outright');
});

test('check: a plugin repository does not govern its own components', async () => {
  const cfgm = await import('../core/config.js');
  const dir = tmpRepo();
  wf(dir, '.claude-plugin/plugin.json', '{"name":"p"}');
  wf(dir, '.docgov/config.yaml', 'version: 1\nproject:\n  mode: team\n');
  wf(dir, 'skills/x/SKILL.md', '---\nname: x\n---\n# x\n');
  wf(dir, 'agents/y.md', '---\nname: y\n---\n# y\n');
  wf(dir, 'templates/z.md', '# z\n');
  wf(dir, 'docs/real.md', '# real\n');
  const { cfg } = cfgm.load(dir);
  const i = inv.inventory(dir, cfg);
  assert.deepEqual(i.documents.map((d) => d.path), ['docs/real.md'],
    'only real documentation should be inventoried in a plugin repository');
});

test('documents can be governed from config instead of frontmatter', () => {
  // GitHub renders YAML frontmatter in Markdown as a table, so a README that carried a
  // docgov block would open the project's front page with a metadata dump.
  const dir = tmpRepo();
  wf(dir, '.docgov/config.yaml', ['version: 1', 'project:', '  mode: open-source',
    'documentation:', '  registrations:', '    README.md:', '      id: readme',
    '      type: user.readme', '      visibility: public', '      owner: me'].join('\n') + '\n');
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  commit(dir);

  const s = snapshot(dir);
  const d = s.docs.find((x) => x.path === 'README.md');
  assert.ok(d.externallyRegistered);
  assert.equal(d.id, 'readme');
  assert.equal(d.type, 'user.readme');
  assert.equal(d.visibility, 'public');
  assert.ok(!d.source.startsWith('---'), 'the file itself must stay free of frontmatter');

  const { findings } = check.run(s);
  assert.ok(!findings.some((f) => f.path === 'README.md' && f.check === 'missing-frontmatter'),
    'an externally registered document is registered, not missing its frontmatter');

  // ...and `organize --apply` must not write a block into it.
  const r = cli(dir, ['tag', '--apply', '--json']);
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8').startsWith('---'), false, r.out);
});

test('coverage gaps use the inferred class, not only the declared one', () => {
  const dir = tmpRepo();
  wf(dir, '.docgov/config.yaml', 'version: 1\nproject:\n  mode: solo\n');
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  const { cfg } = cfgmod.load(dir);
  const i = inv.inventory(dir, cfg);
  const gaps = inv.coverageGaps(i).map((g) => g.type);
  assert.ok(!gaps.includes('user.readme'), 'an unannotated README must not be reported as missing');
});

test('classifier: destination respects the active layout', () => {
  const full = { project: { layout: 'full' } };
  const compact = { project: { layout: 'compact' } };
  assert.equal(destinationFor(full, 'architecture.adr', 'x/0001-a.md'), 'docs/03-architecture/adr/0001-a.md');
  assert.equal(destinationFor(compact, 'architecture.adr', 'x/0001-a.md'), 'docs/adr/0001-a.md');
  assert.equal(destinationFor(compact, 'user.readme', 'docs/README.md'), 'README.md', 'singletons go to a fixed path');
});

// ───────────────────────────── invariants ─────────────────────────────

test('invariants: parses every accepted notation and ignores code fences', () => {
  const src = ['---', 'docgov:', '  id: lic', '  documents: ["src/licensing/**"]', '---',
    '# L', '', '- INV-LIC-001 Plain list item.', '- **INV-LIC-002**: Bold with colon.',
    '- `INV-LIC-003` Code-wrapped.', '### INV-LIC-004', 'Statement on the next line.',
    '', '```', '- INV-FAKE-999 Inside a fence, must be ignored.', '```', ''].join('\n');
  const d = new Document('/tmp', 'x.md', src);
  const { invariants } = collectInvariants([d], { domains: {} });
  assert.deepEqual(invariants.map((i) => i.id), ['INV-LIC-001', 'INV-LIC-002', 'INV-LIC-003', 'INV-LIC-004']);
  assert.equal(invariants[1].statement, 'Bold with colon.', 'emphasis must be unwrapped, not left in the statement');
  assert.equal(invariants[3].statement, 'Statement on the next line.');
});

test('invariants: apply to a changed code path via the documents mapping', () => {
  const src = '---\ndocgov:\n  id: lic\n  documents: ["src/licensing/**"]\n---\n- INV-LIC-001 One org per license.\n';
  const d = new Document('/tmp', 'x.md', src);
  const set = collectInvariants([d], { domains: {} });
  assert.equal(applicable(set, ['src/licensing/validator.ts'], { domains: {} }).length, 1);
  assert.equal(applicable(set, ['src/billing/x.ts'], { domains: {} }).length, 0, 'must not leak across domains');
  assert.match(renderInvariants(applicable(set, ['src/licensing/v.ts'], { domains: {} })), /INV-LIC-001/);
});

test('invariants: duplicate ids across documents are reported, not silently merged', () => {
  const a = new Document('/tmp', 'a.md', '---\ndocgov:\n  id: a\n---\n- INV-X-001 First.\n');
  const b = new Document('/tmp', 'b.md', '---\ndocgov:\n  id: b\n---\n- INV-X-001 Second.\n');
  assert.equal(collectInvariants([a, b], { domains: {} }).duplicates.length, 1);
});

// ───────────────────────────── similarity ─────────────────────────────

test('similarity: flags near-duplicates and leaves unrelated documents alone', () => {
  const body = (t) => `---\ndocgov:\n  id: ${t}\n---\n`;
  const licensing = 'License validation happens offline using a signed token with a grace period. '
    + 'Licenses belong to organizations and seats are counted per organization each billing cycle. '
    + 'Offline validation tolerates clock skew within a bounded window.';
  const docs = [
    new Document('/tmp', 'a.md', body('a') + licensing),
    new Document('/tmp', 'b.md', body('b') + licensing + ' Some additional wording here.'),
    new Document('/tmp', 'c.md', body('c') + 'Kubernetes deployment uses a rolling strategy across three availability zones with readiness probes.'),
  ];
  const pairs = similarPairs(docs, { threshold: 0.4 });
  assert.equal(pairs.length, 1, 'exactly one pair should be similar');
  assert.deepEqual([pairs[0].a, pairs[0].b].sort(), ['a.md', 'b.md']);
});

// ───────────────────────────── links ─────────────────────────────

test('links: rewriting repairs both moved targets and moved sources', () => {
  const moves = new Map([
    ['docs/design.md', 'docs/03-architecture/overview/design.md'],
    ['docs/a.md', 'docs/01-product/requirements/a.md'],
  ]);
  const out = rewriteLinks('See [d](design.md) and [n](notes/x.md).', 'docs/a.md', 'docs/01-product/requirements/a.md', moves);
  assert.match(out, /\]\(\.\.\/\.\.\/03-architecture\/overview\/design\.md\)/);
  assert.match(out, /\]\(\.\.\/\.\.\/notes\/x\.md\)/, 'unmoved targets still need a new relative path');
});

test('links: external, anchor and mailto targets are never rewritten', () => {
  const src = '[e](https://x.test/a) [a](#section) [m](mailto:a@b.test)';
  assert.equal(rewriteLinks(src, 'docs/a.md', 'other/a.md', new Map([['docs/z.md', 'q/z.md']])), src);
});

test('links: a destination may contain balanced parens or be angle-bracketed', () => {
  // Next.js route groups put parentheses in real paths. Stopping at the first `)`
  // truncated the destination and then reported the truncation as a broken link.
  const body = '[a](../ui_new/src/app/(dashboard)/billy/) [b](./plain.md) '
    + '[c](<spaced path.md>) [d](https://x.test/a(b))';
  const d = new Document('/tmp', 'docs/x.md', `# T\n\n${body}\n`);
  const l = d.links();
  assert.deepEqual(l.internal, ['../ui_new/src/app/(dashboard)/billy/', './plain.md', 'spaced path.md']);
  assert.deepEqual(l.external, ['https://x.test/a(b)']);
});

test('links: broken internal links are detected, valid ones are not', () => {
  const d = new Document('/tmp', 'docs/a.md', '# A\n\n[ok](b.md) [bad](missing.md) [ext](https://x.test)\n');
  const broken = brokenLinks([d], '/tmp', new Set(['docs/a.md', 'docs/b.md']));
  assert.deepEqual(broken.map((b) => b.target), ['missing.md']);
});

test('links: a link to a directory, a dotfile or a source file is not broken', () => {
  // The inventory set holds tracked *files* only — no directories, and not every
  // dotfile or source file. Trusting it alone reported 306 valid links as broken on a
  // real repository, 287 of them plain links to directories.
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'core', 'coverage'), { recursive: true });
  wf(dir, 'core/coverage/gate.go', 'package coverage\n');
  wf(dir, '.golangci.yml', 'run: {}\n');
  const body = '# A\n\n[d](../core/) [dot](../.golangci.yml) [src](../core/coverage/gate.go) '
    + '[line](../core/coverage/gate.go:43) [gone](../core/nope.go)\n';
  wf(dir, 'docs/a.md', body);
  const d = new Document(dir, 'docs/a.md', body);
  // the fast-path set deliberately knows about none of them
  const broken = brokenLinks([d], dir, new Set(['docs/a.md']));
  assert.deepEqual(broken.map((b) => b.target), ['../core/nope.go'],
    'only the target that genuinely does not exist may be reported');
});

test('links: a static-site tree resolves assets, sections and page-relative links', () => {
  // Measured on a Hugo documentation site: 110 reported broken links, 4 real. 93 were
  // images under static/, 10 were page-relative, 3 omitted the trailing slash.
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'site', 'content', 'en', 'integrations'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'site', 'content', 'en', 'usage'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'site', 'static', 'images'), { recursive: true });
  wf(dir, 'site/config.toml', 'baseURL = "/"\n');
  wf(dir, 'site/static/images/dashboard.png', 'x');
  wf(dir, 'site/content/en/usage/permissions.md', '# P\n');
  wf(dir, 'site/content/en/integrations/social-authentication.md', '# S\n');

  const body = '# API\n\n[img](../../images/dashboard.png) '        // static/ at site root
    + '[section](../../usage/permissions) '                            // no trailing slash
    + '[sibling](../social-authentication/) '                          // page renders as a dir
    + '[gone](../../usage/nothing-here)\n';
  wf(dir, 'site/content/en/integrations/api.md', body);
  const d = new Document(dir, 'site/content/en/integrations/api.md', body);
  const broken = brokenLinks([d], dir, new Set(['site/content/en/integrations/api.md']));
  assert.deepEqual(broken.map((b) => b.target), ['../../usage/nothing-here'],
    'only the target with nothing behind it may be reported');
});

test('links: a target that climbs out of the repository is not an internal link', () => {
  // GitHub documents the private-vulnerability-reporting link as
  // `[report](../../security/advisories/new)` in a root SECURITY.md, and resolves it
  // against the repository URL rather than the filesystem. There is nothing on disk to
  // check it against, and it is not part of the graph, so it is not a broken link.
  const body = '# S\n\n[report](../../security/advisories/new) [up](../outside.md) '
    + '[ok](./real.md) [gone](./nope.md)\n';
  const d = new Document('/tmp', 'SECURITY.md', body);
  const broken = brokenLinks([d], '/tmp', new Set(['SECURITY.md', 'real.md']));
  assert.deepEqual(broken.map((b) => b.target), ['./nope.md'],
    'only the in-repository target that does not exist may be reported');
});

test('links: permalink and repo-root conventions resolve, genuinely missing ones do not', () => {
  // Measured on a 1,045-document repository: checking only the document-relative path
  // reported 1,304 broken links, of which 277 were real.
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'site', 'errors'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'core', 'malware'), { recursive: true });
  wf(dir, 'site/errors/CHW-1001.md', '# 1001\n');
  wf(dir, 'core/malware/index.go', 'package malware\n');
  const body = '# I\n\n[permalink](./CHW-1001/) [root](core/malware/index.go) '
    + '[rootline](core/malware/index.go:664) [gone](./CHW-9999/)\n';
  wf(dir, 'site/errors/_index.md', body);
  const d = new Document(dir, 'site/errors/_index.md', body);
  const broken = brokenLinks([d], dir, new Set(['site/errors/_index.md']));
  assert.deepEqual(broken.map((b) => b.target), ['./CHW-9999/'],
    'only the permalink with no backing document may be reported');
});

// ───────────────────────────── size ─────────────────────────────

test('size: line count alone never recommends a split', () => {
  const long = '---\ndocgov:\n  type: product.prd\n---\n# P\n\n' + 'filler line\n'.repeat(1400);
  const d = new Document('/tmp', 'p.md', long);
  const { cfg } = { cfg: cfgmod.merge ? null : null } ;
  const conf = cfgmod.defaults();
  conf.profile = cfgmod.MODE_PROFILES.solo;
  const a = assess(conf, d);
  assert.equal(a.level, 'hard', 'it is over the hard limit');
  assert.equal(a.recommendSplit, false, 'but one concept, however long, is not a split candidate');
});

test('size: several substantial sections plus an over-limit document does recommend a split', () => {
  const section = (n) => `## ${n}\n\n` + `prose about ${n}\n`.repeat(160);
  const src = '---\ndocgov:\n  type: architecture.overview\n---\n# A\n\n' + ['Auth', 'Licensing', 'Telemetry'].map(section).join('\n');
  const d = new Document('/tmp', 'a.md', src);
  const conf = cfgmod.defaults();
  conf.profile = cfgmod.MODE_PROFILES.solo;
  const a = assess(conf, d);
  assert.equal(a.independentConcepts, 3);
  assert.ok(a.recommendSplit);
  assert.deepEqual(splitCandidates(d).map((s) => s.suggested), ['auth.md', 'licensing.md', 'telemetry.md']);
});

test('size: README overreach names the document class the section belongs in', () => {
  const src = '---\ndocgov:\n  type: user.readme\n---\n# P\n\n## Architecture\n\n' + 'detail\n'.repeat(80);
  const d = new Document('/tmp', 'README.md', src);
  const over = readmeOverreach(cfgmod.defaults(), d);
  assert.equal(over.length, 1);
  assert.equal(over[0].moveTo, 'architecture.overview');
});

// ───────────────────────────── rules + gate ─────────────────────────────

test('preWrite: blocks a hand edit to a generated tree', () => {
  const { cfg } = cfgmod.load(ROOT);
  const r = check.preWrite({ cfg, relPath: 'docs/90-generated/api.md', registry: { documents: {} }, isNew: false, content: '# x' });
  assert.equal(r.length, 1);
  assert.equal(r[0].check, 'generated-edit');
  assert.ok(r[0].blocking, 'generated-edit blocks in every mode');
});

test('preWrite: blocks a duplicate id and says which document owns it', () => {
  const { cfg } = cfgmod.load(ROOT);
  const registry = { documents: { taken: { path: 'docs/a.md' } } };
  const r = check.preWrite({ cfg, relPath: 'docs/b.md', registry, isNew: true, content: '---\ndocgov:\n  id: taken\n---\n# b\n' });
  const dup = r.find((x) => x.check === 'duplicate-id');
  assert.ok(dup && dup.blocking);
  assert.match(dup.message, /docs\/a\.md/);
});

test('preWrite: blocks an internal document written into a public path', () => {
  const { cfg } = cfgmod.load(ROOT);
  cfg.governance.enforce = ['visibility-path'];
  const r = check.preWrite({ cfg, relPath: 'docs/11-external/leak.md', registry: { documents: {} }, isNew: true,
    content: '---\ndocgov:\n  id: leak\n  type: security.threat-model\n  visibility: internal\n---\n# t\n' });
  const v = r.find((x) => x.check === 'visibility-path');
  assert.ok(v && v.blocking, 'an internal threat model in an external path must be blocked');
});

test('preWrite: surfaces unparseable frontmatter before the write lands', () => {
  const { cfg } = cfgmod.load(ROOT);
  const r = check.preWrite({ cfg, relPath: 'docs/a.md', registry: { documents: {} }, isNew: true,
    content: '---\ndocgov:\n  id: &anchor x\n---\n# a\n' });
  assert.ok(r.some((x) => x.check === 'invalid-yaml'));
});

test('preWrite: a clean write produces no reasons at all', () => {
  const { cfg } = cfgmod.load(ROOT);
  const r = check.preWrite({ cfg, relPath: 'docs/adr/0001-x.md', registry: { documents: {} }, isNew: true,
    content: '---\ndocgov:\n  id: adr-0001-x\n  type: architecture.adr\n  visibility: internal\n---\n# x\n' });
  assert.deepEqual(r, []);
});

test('mode profiles: solo warns where enterprise blocks', () => {
  const solo = cfgmod.defaults(); solo.project.mode = 'solo';
  solo.governance.enforce = cfgmod.MODE_PROFILES.solo.block;
  const ent = cfgmod.defaults(); ent.project.mode = 'enterprise';
  ent.governance.enforce = cfgmod.MODE_PROFILES.enterprise.block;
  assert.equal(cfgmod.blocks(solo, 'missing-frontmatter'), false);
  assert.equal(cfgmod.blocks(ent, 'missing-frontmatter'), true);
  assert.equal(cfgmod.blocks(solo, 'generated-edit'), true, 'some rules block everywhere');
});

test('warn_only disables every block without changing the findings', () => {
  const c = cfgmod.defaults();
  c.governance.enforce = ['generated-edit'];
  c.governance.warn_only = true;
  assert.equal(cfgmod.blocks(c, 'generated-edit'), false);
});

test('exit codes: only deterministic violations produce 1; drift produces 2', () => {
  const cfg = cfgmod.defaults();
  assert.equal(check.exitCode({ findings: [], driftFindings: [], cfg }), EXIT.OK);
  assert.equal(check.exitCode({ findings: [{ blocking: true }], driftFindings: [], cfg }), EXIT.VIOLATION);
  assert.equal(check.exitCode({ findings: [{ blocking: false }], driftFindings: [{ severity: 'high' }], cfg }), EXIT.REVIEW);
  assert.equal(check.exitCode({ findings: [], driftFindings: [{ severity: 'low' }], cfg }), EXIT.OK,
    'low-severity drift must not fail a build');
});

// ───────────────────────────── graph ─────────────────────────────

test('graph: declared edges get inverses, and authority violations are caught', () => {
  const docs = [
    new Document('/tmp', 'a.md', '---\ndocgov:\n  id: a\n  type: user.guide\n  relationships:\n    defines: [b]\n---\n# a\n'),
    new Document('/tmp', 'b.md', '---\ndocgov:\n  id: b\n  type: constitution.product\n---\n# b\n'),
  ];
  const { registry } = reg.build(docs);
  const g = graphmod.build(docs, registry, cfgmod.defaults());
  assert.equal(g.out('a', 'defines').length, 1);
  assert.equal(g.in('a', 'defined_by').length, 1, 'inverse edge must exist for reverse traversal');
  const v = g.authorityViolations();
  assert.equal(v.length, 1, 'an audience document may not define the constitution');
});

test('graph: internal markdown links become inferred reference edges', () => {
  const docs = [
    new Document('/tmp', 'docs/a.md', '---\ndocgov:\n  id: a\n---\n[b](b.md)\n'),
    new Document('/tmp', 'docs/b.md', '---\ndocgov:\n  id: b\n---\n# b\n'),
  ];
  const g = graphmod.build(docs, reg.build(docs).registry, cfgmod.defaults());
  const e = g.out('a', 'references');
  assert.equal(e.length, 1);
  assert.ok(e[0].inferred, 'link-derived edges must be marked inferred, not declared');
});

// ───────────────────────────── suppressions ─────────────────────────────

test('suppressions: require a real reason', () => {
  const dir = tmpRepo();
  const cfg = cfgmod.defaults();
  assert.throws(() => supp.add(dir, cfg, { id: 'X-1', reason: 'no' }), /reason/);
  assert.ok(supp.add(dir, cfg, { id: 'X-1', reason: 'deliberate experiment, see ADR-12' }));
});

test('suppressions: an expired suppression stops suppressing and is reported', () => {
  const data = { suppressions: [{ id: 'A', reason: 'r', expires: '2020-01-01' }, { id: 'B', reason: 'r' }] };
  const r = supp.apply([{ id: 'A' }, { id: 'B' }], data, '2026-01-01');
  assert.deepEqual(r.active.map((f) => f.id), ['A'], 'the expired one is active again');
  assert.deepEqual(r.suppressed.map((f) => f.id), ['B']);
  assert.equal(r.expired.length, 1);
});

// ───────────────────────────── publish ─────────────────────────────

test('publish: detects hard leaks and redacts the samples it reports', () => {
  const leaks = scanLeaks({ body: 'db-01.internal at 10.0.3.4 with AKIAABCDEFGHIJKLMNOP' });
  const ids = leaks.map((l) => l.id);
  assert.ok(ids.includes('internal-host') && ids.includes('private-ip') && ids.includes('aws-key'));
  assert.ok(!leaks.some((l) => l.sample.includes('AKIAABCDEFGHIJKLMNOP')), 'a leak report must not reprint the secret');
});

// ───────────────────────────── search + context ─────────────────────────────

test('find: authority outranks relevance', () => {
  const mk = (id, type, body) => new Document('/tmp', `${id}.md`, `---\ndocgov:\n  id: ${id}\n  type: ${type}\n---\n# ${id}\n\n${body}\n`);
  const docs = [
    mk('guide', 'user.guide', 'license validation license validation license validation license validation'),
    mk('spec', 'architecture.domain', 'license validation happens offline'),
  ];
  const r = find({ docs, query: 'license validation' });
  assert.equal(r[0].id, 'spec', 'the canonical spec must come before the guide that repeats the phrase more often');
});

test('context: pack leads with the constitution and names the invariants in force', () => {
  const docs = [
    new Document('/tmp', 'p.md', '---\ndocgov:\n  id: product\n  type: constitution.product\n---\n# Product\n\nWhat we build.\n'),
    new Document('/tmp', 'l.md', '---\ndocgov:\n  id: lic\n  type: architecture.domain\n  domain: licensing\n---\n# Licensing\n\n- INV-LIC-001 One org per license.\n'),
  ];
  const cfg = cfgmod.defaults();
  const g = graphmod.build(docs, reg.build(docs).registry, cfg);
  const out = pack({ cfg, docs, graph: g, topic: 'licensing' });
  assert.match(out, /INV-LIC-001/);
  assert.ok(out.indexOf('# Product') < out.indexOf('# Licensing'), 'constitution must be rendered before the domain spec');
});

// ───────────────────────────── drift, end to end on a real repo ─────────────────────────────

test('drift: forward drift fires when mapped code changes and the document does not', () => {
  const dir = tmpRepo();
  wf(dir, 'src/licensing/validator.ts', 'export const GRACE = 7;\n');
  wf(dir, '.docgov/config.yaml', 'version: 1\nproject:\n  mode: team\n  layout: compact\n');
  wf(dir, 'docs/architecture/licensing.md',
    '---\ndocgov:\n  id: lic\n  type: architecture.domain\n  domain: licensing\n  visibility: internal\n  documents: ["src/licensing/**"]\n---\n'
    + '# Licensing\n\n## Invariants\n\n- INV-LIC-004 The grace period is 7 days.\n');
  commit(dir);
  fs.writeFileSync(path.join(dir, 'src/licensing/validator.ts'), 'export const GRACE = 30;\n');

  const s = snapshot(dir);
  const res = driftmod.analyze({ ...s, base: 'HEAD' });
  const f = res.findings.find((x) => x.kind === 'forward');
  assert.ok(f, 'forward drift must be detected');
  assert.equal(f.severity, 'high', 'canonical authority raises the severity');
  assert.match(f.document, /licensing\.md$/);
  assert.ok(f.invariants.some((i) => i.startsWith('INV-LIC-004')), 'the threatened invariant travels with the finding');
});

test('drift: extensionless executables and build files are not invisible', () => {
  // Regression: the forward-drift gate filtered candidates through a file-extension list
  // before consulting the graph, so every extensionless executable, shell script and
  // Dockerfile a document had explicitly mapped was silently skipped. DocGov's own
  // bin/docgov was invisible to the drift engine that governs it.
  const dir = tmpRepo();
  wf(dir, 'bin/tool', '#!/usr/bin/env node\nconsole.log(1);\n');
  wf(dir, 'scripts/deploy.sh', '#!/bin/sh\necho deploy\n');
  wf(dir, 'Dockerfile', 'FROM node:22\n');
  wf(dir, '.docgov/config.yaml', 'version: 1\nproject:\n  mode: team\n');
  wf(dir, 'docs/architecture/tooling.md',
    '---\ndocgov:\n  id: tooling\n  type: architecture.domain\n  visibility: internal\n'
    + '  documents: ["bin/tool", "scripts/**", "Dockerfile"]\n---\n# Tooling\n');
  commit(dir);

  fs.writeFileSync(path.join(dir, 'bin/tool'), '#!/usr/bin/env node\nconsole.log(2);\n');
  fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM node:24\n');
  fs.writeFileSync(path.join(dir, 'scripts/deploy.sh'), '#!/bin/sh\necho deployed\n');

  const s = snapshot(dir);
  const f = driftmod.analyze({ ...s, base: 'HEAD' }).findings.find((x) => x.kind === 'forward');
  assert.ok(f, 'a document mapping extensionless files must still see them change');
  assert.deepEqual(f.implementation.sort(), ['Dockerfile', 'bin/tool', 'scripts/deploy.sh']);

  const i = impactmod.analyze({ ...s, base: 'HEAD' });
  assert.ok(i.signals.behaviorChanged, 'a changed shell script is a behaviour change');
  assert.ok(i.affected.find((a) => a.id === 'tooling')?.required);
});

test('paths: the mapping predicate is broad, the behaviour heuristic is not', async () => {
  const { isMappable, isCode } = await import('../core/paths.js');
  // Mappable: the graph decides relevance, so anything a document could claim qualifies.
  for (const p of ['bin/docgov', 'Dockerfile', 'Makefile', 'scripts/x.sh', 'assets/logo.svg',
    'openapi/api.yaml', 'src/a.ts', 'config.toml']) {
    assert.ok(isMappable(p), `${p} must be mappable`);
  }
  for (const p of ['README.md', 'docs/a.mdx', '.docgov/graph.json']) {
    assert.ok(!isMappable(p), `${p} must not be mappable`);
  }
  // Code: a heuristic, so a false negative is acceptable and a false positive is not.
  for (const p of ['src/a.ts', 'scripts/x.sh', 'bin/docgov', 'Dockerfile', 'infra/main.tf']) {
    assert.ok(isCode(p), `${p} should read as code`);
  }
  for (const p of ['assets/logo.svg', 'data/rows.csv', 'package.json', 'LICENSE']) {
    assert.ok(!isCode(p), `${p} should not read as code`);
  }
});

test('drift: no finding when the document moves with the code', () => {
  const dir = tmpRepo();
  wf(dir, 'src/a/x.ts', 'export const A = 1;\n');
  wf(dir, '.docgov/config.yaml', 'version: 1\nproject:\n  mode: team\n');
  wf(dir, 'docs/architecture/a.md', '---\ndocgov:\n  id: a\n  type: architecture.domain\n  documents: ["src/a/**"]\n---\n# A\n');
  commit(dir);
  fs.writeFileSync(path.join(dir, 'src/a/x.ts'), 'export const A = 2;\n');
  fs.appendFileSync(path.join(dir, 'docs/architecture/a.md'), '\nA is now 2.\n');
  const res = driftmod.analyze({ ...snapshot(dir), base: 'HEAD' });
  assert.equal(res.findings.filter((f) => f.kind === 'forward').length, 0);
});

test('drift: reverse drift fires when a spec changes with no implementation change', () => {
  const dir = tmpRepo();
  wf(dir, 'src/limits/x.ts', 'export const MAX_ORGS = 5;\n');
  wf(dir, '.docgov/config.yaml', 'version: 1\nproject:\n  mode: team\n');
  wf(dir, 'docs/product/limits.md', '---\ndocgov:\n  id: limits\n  type: product.prd\n  documents: ["src/limits/**"]\n---\n# Limits\n\nMaximum organizations: 5.\n');
  commit(dir);
  fs.writeFileSync(path.join(dir, 'docs/product/limits.md'),
    '---\ndocgov:\n  id: limits\n  type: product.prd\n  documents: ["src/limits/**"]\n---\n# Limits\n\nMaximum organizations: unlimited.\n');
  const res = driftmod.analyze({ ...snapshot(dir), base: 'HEAD' });
  const f = res.findings.find((x) => x.kind === 'reverse');
  assert.ok(f, 'a specification ahead of its implementation must be reported');
});

test('drift: finding ids are stable across runs so suppressions keep working', () => {
  const dir = tmpRepo();
  wf(dir, 'src/a/x.ts', 'const A = 1;\n');
  wf(dir, '.docgov/config.yaml', 'version: 1\nproject:\n  mode: team\n');
  wf(dir, 'docs/architecture/a.md', '---\ndocgov:\n  id: a\n  type: architecture.domain\n  documents: ["src/a/**"]\n---\n# A\n');
  commit(dir);
  fs.writeFileSync(path.join(dir, 'src/a/x.ts'), 'const A = 2;\n');
  const one = driftmod.analyze({ ...snapshot(dir), base: 'HEAD' }).findings.map((f) => f.id);
  const two = driftmod.analyze({ ...snapshot(dir), base: 'HEAD' }).findings.map((f) => f.id);
  assert.deepEqual(one, two);
  assert.ok(one.every((id) => /^DRIFT-\d{5}$/.test(id)));
});

// ───────────────────────────── impact ─────────────────────────────

test('impact: maps a code change to the documents that claim it, and flags security', () => {
  const dir = tmpRepo();
  wf(dir, 'src/auth/session.ts', 'export const x = 1;\n');
  wf(dir, '.docgov/config.yaml', 'version: 1\nproject:\n  mode: team\ndomains:\n  auth:\n    paths: ["src/auth/**"]\n');
  wf(dir, 'docs/security/auth.md', '---\ndocgov:\n  id: auth-sec\n  type: security.architecture\n  domain: auth\n  documents: ["src/auth/**"]\n---\n# Auth\n');
  commit(dir);
  fs.writeFileSync(path.join(dir, 'src/auth/session.ts'), 'export const x = 2;\n');
  const r = impactmod.analyze({ ...snapshot(dir), base: 'HEAD' });
  assert.ok(r.signals.securityChanged);
  assert.equal(r.level, 'HIGH', 'security-path changes are always high impact');
  const a = r.affected.find((x) => x.id === 'auth-sec');
  assert.ok(a?.required && !a.updated);
  const m = impactmod.checklist(r);
  assert.deepEqual(m.docs.outstanding, ['auth-sec']);
});

// ───────────────────────────── CLI contract ─────────────────────────────

test('cli: init → create → check is a clean cycle', () => {
  const dir = tmpRepo();
  wf(dir, 'package.json', '{"name":"t"}');
  commit(dir);
  assert.equal(cli(dir, ['setup', '--mode', 'solo']).code, 0);
  assert.ok(fs.existsSync(path.join(dir, '.docgov/config.yaml')));
  assert.ok(fs.existsSync(path.join(dir, '.claude/rules/documentation.md')), 'agent rules must be installed');
  assert.equal(cli(dir, ['create', 'architecture.adr', 'Pick a database']).code, 0);
  const adr = path.join(dir, 'docs/adr/pick-a-database.md');
  assert.ok(fs.existsSync(adr));
  const d = new Document(dir, 'docs/adr/pick-a-database.md');
  assert.equal(d.type, 'architecture.adr');
  assert.equal(d.authority, 'decision');
  assert.deepEqual(d.missingSections(), [], 'the template must satisfy its own required sections');
});

test('cli: adopting DocGov on an existing repository does not fail CI on day one', () => {
  const dir = tmpRepo();
  wf(dir, 'CODEOWNERS', '* @team\n');                       // forces team mode
  wf(dir, 'README.md', '# T\n\nno frontmatter, predates DocGov\n');
  wf(dir, 'ARCHITECTURE.md', '# A\n\ncomponents and boundaries\n');
  commit(dir);
  const init = cli(dir, ['setup']);
  assert.equal(init.code, 0);
  assert.match(init.out, /warn_only is on/, 'the ramp must be visible, not silent');
  assert.equal(cli(dir, ['check']).code, EXIT.OK,
    'documentation that predates governance must not fail the first build');

  // ...and turning the ramp off restores enforcement.
  const cfgPath = path.join(dir, '.docgov/config.yaml');
  fs.writeFileSync(cfgPath, fs.readFileSync(cfgPath, 'utf8').replace(/\s*warn_only: true\n/, '\n'));
  assert.equal(cli(dir, ['check']).code, EXIT.VIOLATION,
    'team mode blocks missing frontmatter once the ramp is removed');
});

test('cli: a fresh repository with no pre-existing documents enforces immediately', () => {
  const dir = tmpRepo();
  wf(dir, 'CODEOWNERS', '* @team\n');
  commit(dir);
  const init = cli(dir, ['setup']);
  assert.doesNotMatch(init.out, /warn_only/, 'there is nothing to ramp up from');
});

test('cli: check exits 1 on a blocking violation and 0 once it is fixed', () => {
  const dir = tmpRepo();
  wf(dir, 'package.json', '{"name":"t"}');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  wf(dir, 'docs/a.md', '---\ndocgov:\n  id: same\n  type: user.guide\n---\n# A\n\n## Goal\n\n## Steps\n\n## Verification\n\n## Related\n');
  wf(dir, 'docs/b.md', '---\ndocgov:\n  id: same\n  type: user.guide\n---\n# B\n\n## Goal\n\n## Steps\n\n## Verification\n\n## Related\n');
  assert.equal(cli(dir, ['check']).code, EXIT.VIOLATION, 'duplicate id must block even in solo mode');
  fs.writeFileSync(path.join(dir, 'docs/b.md'),
    '---\ndocgov:\n  id: other\n  type: user.guide\n---\n# B\n\n## Goal\n\n## Steps\n\n## Verification\n\n## Related\n');
  assert.equal(cli(dir, ['check']).code, EXIT.OK);
});

test('cli: two documents with one canonical destination are told apart, not collided', () => {
  // `<canonical dir>/<basename>` discards the source directory, so same-named documents
  // fought for one path: 29 on one repository, which made its whole plan unrunnable.
  // The leading source segment is kept, because in a monorepo it names the module.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'alpha/docs/runbook.md', '# R\n\nOn a SEV-1, escalate to the on-call rota.\n');
  wf(dir, 'beta/docs/runbook.md', '# R2\n\nOn a SEV-2, escalate to the on-call rota.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  const r = cli(dir, ['review']);
  assert.equal(r.code, 0);

  const plan = JSON.parse(fs.readFileSync(path.join(dir, '.docgov', 'fix-plan.json'), 'utf8'));
  assert.deepEqual(plan.collisions, [], 'nothing may be left colliding');
  const moves = plan.actions.filter((a) => a.kind === 'MOVE');
  const dests = moves.map((m) => m.to);
  assert.equal(new Set(dests).size, dests.length, 'every destination is distinct');
  assert.ok(dests.some((d) => d.includes('alpha/')) && dests.some((d) => d.includes('beta/')),
    'the distinguishing segment is kept');
  assert.equal(cli(dir, ['fix', '--dry-run']).code, 0, 'the plan must now be runnable');
});

test('cli: a single-document class keeps one holder and leaves the rest in place', () => {
  // A fixed path cannot be disambiguated — only one document can be THE changelog — so
  // the others must stay where they are rather than being moved onto each other.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'CHANGELOG.md', '# Changelog\n\n## [1.0.0]\n');
  wf(dir, 'sub/CHANGELOG.md', '# Changelog\n\n## [0.9.0]\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  cli(dir, ['review']);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, '.docgov', 'fix-plan.json'), 'utf8'));
  assert.deepEqual(plan.collisions, [], 'nothing may be left colliding');
  const onto = plan.actions.filter((a) => a.kind === 'MOVE' && a.to === 'CHANGELOG.md'
    && a.path !== 'CHANGELOG.md');
  assert.equal(onto.length, 0, 'nothing may be moved onto the existing changelog');
  assert.equal(cli(dir, ['fix', '--dry-run']).code, 0, 'the plan must be runnable');
});

test('cli: one unreadable document does not stop the others being migrated', () => {
  // `patchDocgov` re-parses the file it is annotating and threw, which aborted the entire
  // run. Two files out of 299 stopped a whole repository's migration. `Document` already
  // degrades this way — it records the error and carries on — and `fix` now matches it.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  // a double-quoted scalar spanning two lines: legal YAML, outside this parser's subset
  wf(dir, 'docs/broken.md', '---\ntitle: "Spans\ntwo lines"\n---\n\n# B\n\nOn a SEV-1, escalate to the rota.\n');
  wf(dir, 'docs/fine.md', '# Fine\n\nOn a SEV-2, escalate to the on-call rota.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  cli(dir, ['review']);
  const r = cli(dir, ['fix', '--dry-run']);
  assert.equal(r.code, 0, 'the run must complete despite the unreadable document');
  assert.match(r.out, /could not read their frontmatter/, 'and must say which it left alone');
  assert.match(r.out, /docs\/broken\.md/, 'naming the document');
  assert.doesNotMatch(r.out, /docs\/fine\.md\n\s+invalid/, 'the readable one is unaffected');
});

test('cli: a generated documentation site is classified but never relocated', () => {
  // A page's path inside a content tree is its URL, and the navigation, the section
  // indexes and every inbound link are built from it. One repository had 363 such pages
  // matching no signal at all; classifying them then proposed moving 287 of them out of
  // the tree, which publishes a different site.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'site/config.toml', 'baseURL = "/"\n');
  wf(dir, 'site/content/ai-assistant/use-billy.md', '# Billy\n\nHow to use it.\n');
  wf(dir, 'site/content/errors/CHW-1001.md', '# CHW-1001\n\nWhat it means.\n');
  wf(dir, 'notes/stray.md', '# Stray\n\nUnrelated.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  cli(dir, ['review']);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, '.docgov', 'fix-plan.json'), 'utf8'));

  const sitePages = plan.classifications.filter((c) => c.path.startsWith('site/content/'));
  assert.equal(sitePages.length, 2);
  assert.ok(sitePages.every((c) => c.proposed !== 'unknown'),
    'the site config says these are published documentation');

  const moved = plan.actions.filter((a) => a.kind === 'MOVE' && a.path.startsWith('site/content/'));
  assert.deepEqual(moved, [], 'a page inside a content tree must never be relocated');
  assert.equal(cli(dir, ['fix', '--dry-run']).code, 0);
});

test('plugin: every declared userConfig option actually changes behaviour', async () => {
  // plugin.json advertised three options and the engine referenced none of them. An option
  // that silently does nothing is a broken contract — and for `semantic_gate`, which claimed
  // to switch off the only thing that leaves the machine, a false security control.
  const manifest = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  const declared = Object.keys(manifest.userConfig || {});
  assert.deepEqual(declared.sort(), ['enforcement', 'session_briefing'],
    'only options the plugin can honour may be declared');

  const cfgm = await import('../core/config.js');
  const cfg = { governance: { warn_only: false, enforce: ['duplicate-id'] } };
  // enforcement: repo → the repository decides
  assert.equal(cfgm.blocks(cfg, 'duplicate-id', {}), true);
  assert.equal(cfgm.blocks(cfg, 'broken-link', {}), false);
  // enforcement: warn → nothing blocks
  const warn = { CLAUDE_PLUGIN_OPTION_enforcement: 'warn' };
  assert.equal(cfgm.blocks(cfg, 'duplicate-id', warn), false, 'warn must never block');
  // enforcement: strict → everything deterministic blocks
  const strict = { CLAUDE_PLUGIN_OPTION_enforcement: 'strict' };
  assert.equal(cfgm.blocks(cfg, 'broken-link', strict), true, 'strict must block every check');
});

test('plugin: session_briefing=false suppresses the session briefing', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  const payload = JSON.stringify({ cwd: dir });

  const on = execFileSync(process.execPath, [BIN, "hook", "session-start"],
    { input: payload, encoding: 'utf8', cwd: dir });
  assert.match(on, /DocGov is active/, 'the briefing is on by default');

  const off = execFileSync(process.execPath, [BIN, "hook", "session-start"],
    { input: payload, encoding: 'utf8', cwd: dir,
      env: { ...process.env, CLAUDE_PLUGIN_OPTION_session_briefing: 'false' } });
  assert.doesNotMatch(off, /DocGov is active/, 'and off when the option says so');
});

test('cli: TOML or JSON frontmatter is never overwritten with a YAML block', () => {
  // Hugo accepts TOML (+++) and JSON frontmatter. DocGov's fence only matches YAML, so such
  // a document looked like one with no frontmatter and got a YAML block prepended *above*
  // the real one — Hugo then reads the injected block and renders the original as body
  // text, losing the page's title, weight and draft status.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'site/config.toml', 'baseURL = "/"\n');
  const original = '+++\ntitle = "CHW-1001"\nweight = 1001\ndraft = false\n+++\n\n# Body\n';
  wf(dir, 'site/content/errors/CHW-1001.md', original);
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  cli(dir, ['review']);
  commit(dir);
  const r = cli(dir, ['fix', '--no-branch']);
  assert.equal(r.code, 0, 'the run completes');
  assert.equal(fs.readFileSync(path.join(dir, 'site/content/errors/CHW-1001.md'), 'utf8'), original,
    'the page must be byte-identical');
  assert.match(r.out, /TOML frontmatter/, 'and must say why it was left alone');
});

test('cli: a scan that could not see everything says so', () => {
  // "no findings" has to mean the intended scope was inspected. A directory too deep, one
  // that cannot be read, and a symlink that is not followed all used to vanish silently,
  // and silence is indistinguishable from compliance.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  const deep = path.join(dir, 'docs', ...Array(13).fill('x'));
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'buried.md'), '# Buried\n');
  fs.mkdirSync(path.join(dir, 'other'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'other', 'real.md'), '# Real\n');
  fs.symlinkSync(path.join(dir, 'other', 'real.md'), path.join(dir, 'docs', 'linked.md'));
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);

  const r = cli(dir, ['check']);
  assert.match(r.out, /Scan incomplete/, 'the report must admit it');
  assert.match(r.out, /scan limit|symlink/, 'and name a reason');

  const j = JSON.parse(cli(dir, ['check', '--json']).out);
  assert.ok(Array.isArray(j.scanSkipped) && j.scanSkipped.length >= 1,
    'and CI must be able to see it too');
});

test('derivation: a published document whose source moved is reported, loudly', () => {
  // "Check these still agree" is advice. "This was written from a document that has since
  // changed" says the derivative is describing something that moved underneath it — and for
  // a public document derived from an internal one, that is the case scanning published
  // files for leaks can never catch.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'docs/auth.md', '---\ndocgov:\n  id: auth-internal\n  type: architecture.domain\n'
    + '  visibility: internal\n---\n# Auth\n\nVerified against issuer A.\n');
  wf(dir, 'public/auth-public.md', '---\ndocgov:\n  id: auth-public\n  type: user.guide\n'
    + '  visibility: public\n  relationships:\n    public_version_of: [auth-internal]\n'
    + '---\n# Authentication\n\nHow tokens work.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  commit(dir);

  fs.appendFileSync(path.join(dir, 'docs/auth.md'), '\nNow verified against issuer B.\n');
  commit(dir);

  const r = cli(dir, ['stale', '--base', 'HEAD~1']);
  assert.match(r.out, /derivation/, 'the finding names the kind');
  assert.match(r.out, /public\/auth-public\.md/, 'and the derivative');
  assert.match(r.out, /public version of auth-internal, which changed after it/,
    'and says which relationship, in words');
  assert.match(r.out, /HIGH/, 'a published derivative is not a low-severity note');
});

test('relationships: a new edge type is valid without editing two lists', async () => {
  // check.js repeated the relationship list instead of reading the taxonomy, so adding an
  // edge type made every use of it report as an invalid relationship.
  const tax = await import('../core/taxonomy.js');
  for (const rel of tax.DERIVATION_RELS) {
    assert.ok(rel in tax.RELATIONSHIPS, `${rel} must be a declared relationship`);
    assert.ok(tax.RELATIONSHIPS[rel].inverse, `${rel} must have an inverse`);
  }
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'docs/a.md', '---\ndocgov:\n  id: a\n  type: architecture.domain\n---\n# A\n\nbody\n');
  wf(dir, 'docs/b.md', '---\ndocgov:\n  id: b\n  type: user.guide\n  relationships:\n'
    + '    summarizes: [a]\n---\n# B\n\nbody\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  const out = cli(dir, ['check', '--all']).out;
  assert.doesNotMatch(out, /invalid-relationship/, 'summarizes must be accepted');
});

test('lifecycle: a superseded document is withheld from a context pack, and said so', () => {
  // A superseded document is usually still true about the past, which is what makes it
  // dangerous: nothing in its prose says it was replaced, so an agent reads it as current.
  // Withholding it silently would be worse — a thin pack has to be explainable.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'docs/auth-v2.md', '---\ndocgov:\n  id: auth-v2\n  type: architecture.domain\n  status: active\n'
    + '  relationships:\n    supersedes: [auth-v1]\n---\n# Auth\n\nVerified against the new issuer.\n');
  wf(dir, 'docs/auth-v1.md', '---\ndocgov:\n  id: auth-v1\n  type: architecture.domain\n  status: superseded\n'
    + '---\n# Auth (old)\n\nVerified against the legacy issuer.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);

  const out = cli(dir, ['brief', 'auth']).out;
  assert.match(out, /auth-v2\.md/, 'the current document is included');
  assert.match(out, /Superseded — deliberately not included/, 'and the withholding is stated');
  assert.match(out, /auth-v1\.md/, 'naming what was withheld');
  const body = out.split('Superseded — deliberately not included')[0];
  assert.doesNotMatch(body, /legacy issuer/, 'the superseded prose must not reach the agent');
});

test('lifecycle: a historical document is not reported as drifting', async () => {
  // A superseded document is not trying to describe today's code. Asking somebody to
  // re-sync a document whose whole point is that it is finished buries the real findings.
  const tax = await import('../core/taxonomy.js');
  assert.equal(tax.isCurrent({ status: 'active' }), true);
  assert.equal(tax.isCurrent({ status: 'draft' }), true, 'a draft is still meant to become true');
  for (const status of ['superseded', 'deprecated', 'archived']) {
    assert.equal(tax.isCurrent({ status }), false, `${status} is not current`);
  }
  assert.equal(tax.isCurrent({}), true, 'no status means active, not historical');
});

test('schema: everything DocGov persists declares a version', () => {
  // The moment another repository holds one of these files, DocGov owns a format it cannot
  // change freely. Four already carried `version: 1` and nothing ever read it back, so a
  // future DocGov writing version 2 would have been silently misread rather than refused.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'docs/a.md', '# D\n\nbody\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  cli(dir, ['review']);
  cli(dir, ['checklist']);
  cli(dir, ['tools']);
  cli(dir, ['ignore', 'DUPLICATEID-0001', '--reason', 'schema coverage test']);

  for (const f of ['config.yaml', 'registry.yaml', 'graph.json', 'suppressions.yaml',
    'fix-plan.json', 'checklist.yaml', 'tools.json']) {
    const raw = fs.readFileSync(path.join(dir, '.docgov', f), 'utf8');
    assert.match(raw, /"?version"?\s*[:=]\s*"?\d+/, `${f} must declare a version`);
  }
});

test('schema: a file from a newer DocGov is refused, an unversioned one is not', async () => {
  const schema = await import('../core/schema.js');

  // newer than this build → refuse rather than reinterpret
  assert.throws(() => schema.check('config', { version: 99 }, '.docgov/config.yaml'),
    /newer DocGov/, 'a future version must be refused');

  // written before versions were enforced → treat as 1, never reject an existing adopter
  assert.doesNotThrow(() => schema.check('config', { project: {} }, '.docgov/config.yaml'));
  assert.doesNotThrow(() => schema.check('registry', { documents: {} }, '.docgov/registry.yaml'));

  // nonsense version → say so plainly
  assert.throws(() => schema.check('config', { version: 'two' }, 'f'), /positive integer/);

  // stamp uses the declared current version, and every artifact has one
  for (const artifact of Object.keys(schema.SCHEMA)) {
    assert.equal(schema.stamp(artifact, {}).version, schema.SCHEMA[artifact]);
  }
});

test('schema: every machine-readable output declares a version too', () => {
  // A `--json` output is not written to disk, but a skill, a hook or a CI job parses it,
  // which makes its shape a contract exactly as much as a file's is. These four carried no
  // version at all: a reader had no way to tell which DocGov produced the shape it got.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'docs/a.md', '# D\n\nbody\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);

  for (const args of [['check'], ['stale'], ['brief', 'auth'], ['health'], ['rules'],
    ['rules', '--for', 'src/a.js'], ['checklist'], ['registry'], ['graph']]) {
    const r = cli(dir, [...args, '--json']);
    const parsed = JSON.parse(r.out);
    assert.equal(typeof parsed.version, 'number',
      `docgov ${args.join(' ')} --json must declare a version, got ${r.out.slice(0, 120)}`);
  }
});

test('schema: the fix plan is checked before anything acts on it', () => {
  // The plan is the one artifact DocGov both writes and reads, and the one whose misreading
  // actually moves files. It declared `version` long before anything looked at it.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'docs/a.md', '# D\n\nbody\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  cli(dir, ['review']);
  const planPath = path.join(dir, '.docgov', 'fix-plan.json');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

  // from a newer DocGov → refuse, in both readers, rather than execute a guess
  fs.writeFileSync(planPath, JSON.stringify({ ...plan, version: 9 }));
  for (const args of [['fix', '--dry-run'], ['inspect', 'contradictions']]) {
    const r = cli(dir, args);
    assert.match(r.out, /newer DocGov/, `docgov ${args.join(' ')} must refuse a newer plan`);
  }

  // written before the field was enforced → still runs, or every early adopter breaks
  delete plan.version;
  fs.writeFileSync(planPath, JSON.stringify(plan));
  assert.equal(cli(dir, ['fix', '--dry-run']).code, EXIT.OK, 'an unversioned plan must still run');

  // unparseable → say which file and what to do about it, not a raw JSON trace
  fs.writeFileSync(planPath, 'not json');
  assert.match(cli(dir, ['fix', '--dry-run']).out, /fix-plan\.json is not valid JSON.*docgov review/s);
});

test('schema: the refusal reaches the user through a hook, which still fails open', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  const reg = path.join(dir, '.docgov', 'registry.yaml');
  fs.writeFileSync(reg, fs.readFileSync(reg, 'utf8').replace(/^version: 1/m, 'version: 7'));

  const r = spawnSync(process.execPath, [BIN, 'hook', 'session-start'],
    { input: JSON.stringify({ cwd: dir }), encoding: 'utf8' });
  assert.equal(r.status, 0, 'a hook must never break the session');
  assert.match(r.stderr, /newer DocGov/, 'but it must say what it refused');
  assert.equal(r.stdout.trim(), '', 'and inject nothing it could not verify');
});

test('cli: a plan may not move a document outside the repository', () => {
  // The plan is an editable file — a human resolves collisions in it — so anything that can
  // write it can choose where a document lands. The boundary used to be held only by
  // `git mv` refusing an outside path, which is incidental, and absent entirely on the
  // --no-git path where fs.renameSync wrote wherever it was told.
  const tag = `docgov-escape-${process.pid}-${Date.now()}.md`;
  for (const target of [`../${tag}`, `/tmp/${tag}`, `docs/../../${tag}`]) {
    const dir = tmpRepo();
    wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
    wf(dir, 'docs/a.md', '# D\n\nbody\n');
    commit(dir);
    cli(dir, ['setup', '--mode', 'solo']);
    cli(dir, ['review']);
    const planPath = path.join(dir, '.docgov', 'fix-plan.json');
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    plan.actions = [{ kind: 'MOVE', path: 'docs/a.md', to: target, reason: 'poisoned', risk: 'low', type: 'note.internal' }];
    fs.writeFileSync(planPath, JSON.stringify(plan));
    commit(dir);

    const r = cli(dir, ['fix', '--no-branch', '--no-git']);
    assert.notEqual(r.code, 0, `${target} must be refused`);
    assert.match(r.out + r.err, /outside the repository/, 'and must say why');
    assert.ok(!fs.existsSync(path.join(dir, '..', tag)), 'nothing may land beside the repository');
    assert.ok(!fs.existsSync(path.join('/tmp', tag)), 'nor at an absolute path');
    assert.ok(fs.existsSync(path.join(dir, 'docs', 'a.md')), 'and the source stays put');
  }
});

test('cli: test fixtures are not documentation', () => {
  // A README inside a fixture describes the fixture. Moving it out breaks the test that
  // resolves paths into that tree — ShellPilot's k8s tests do exactly that.
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  wf(dir, 'tests/fixtures/k8s/README.md', '# fixture\n');
  wf(dir, 'internal/testdata/golden/README.md', '# golden\n');
  wf(dir, 'docs/real.md', '# real\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  cli(dir, ['review']);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, '.docgov', 'fix-plan.json'), 'utf8'));
  const governed = plan.classifications.map((c) => c.path);
  assert.ok(!governed.some((p2) => p2.includes('fixtures/')), 'fixtures are not governed');
  assert.ok(!governed.some((p2) => p2.includes('testdata/')), 'testdata is not governed');
  assert.ok(governed.includes('docs/real.md'), 'ordinary documentation still is');
});

test('cli: fix refuses to run on a dirty tree', () => {
  const dir = tmpRepo();
  wf(dir, 'package.json', '{"name":"t"}');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  wf(dir, 'STRAY.md', '# Stray\n');
  cli(dir, ['review']);
  const r = cli(dir, ['fix']);
  assert.equal(r.code, EXIT.CONFIG);
  assert.match(r.out, /uncommitted changes/);
});

test('cli: fix moves documents, repairs links and verifies the result', () => {
  const dir = tmpRepo();
  wf(dir, 'architecture.md', '# Architecture\n\nComponents and boundaries. See [the runbook](failover-runbook.md).\n');
  wf(dir, 'failover-runbook.md', '# Failover\n\n## Trigger\n\n## Procedure\n\nBack to [architecture](architecture.md).\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  commit(dir, 'init docgov');
  assert.equal(cli(dir, ['review']).code, 0, 'review must not need a committed plan');

  const r = cli(dir, ['fix', '--branch=test-migration']);
  assert.equal(r.code, EXIT.OK, r.out);
  assert.ok(!fs.existsSync(path.join(dir, 'architecture.md')), 'a classified root document must be relocated');
  assert.ok(!fs.existsSync(path.join(dir, 'failover-runbook.md')));

  const tracked = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).split('\n');
  assert.ok(tracked.includes('docs/architecture.md'), `expected docs/architecture.md, got ${tracked.join(', ')}`);
  assert.ok(tracked.some((f) => /^docs\/operations\/runbooks\//.test(f)), `expected a relocated runbook, got ${tracked.join(', ')}`);

  const s = snapshot(dir);
  assert.deepEqual(brokenLinks(s.docs, dir, new Set(s.inv.all)), [], 'no link may be left broken by a move');
  assert.ok(s.docs.every((d) => d.registered), 'every moved document must come out annotated');
});

test('cli: fix leaves an unclassifiable document where it is rather than guessing', () => {
  const dir = tmpRepo();
  wf(dir, 'thoughts.md', '# Thoughts\n\nUnstructured prose with no classification signal at all.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  commit(dir, 'init docgov');
  cli(dir, ['review']);
  const r = cli(dir, ['fix']);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /CLASSIFY/, 'it must be deferred, visibly');
});

test('cli: every command accepts --json and emits parseable JSON', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  for (const args of [['check'], ['health'], ['graph'], ['registry'], ['types'], ['rules'],
    ['affected'], ['stale'], ['find', 'install'], ['whatis', '--path', 'README.md'], ['tools'], ['publish']]) {
    const r = cli(dir, [...args, '--json']);
    assert.doesNotThrow(() => JSON.parse(r.out), `${args.join(' ')} --json must emit JSON, got: ${r.out.slice(0, 160)}`);
  }
});

test('cli: JSON larger than the pipe buffer is not truncated on exit', () => {
  // process.exit() discards unflushed async writes when stdout is a pipe, which silently
  // truncated any output past the 8 KB buffer on Node 20. `types --json` is well past it.
  const dir = tmpRepo();
  commit(dir);
  const r = cli(dir, ['types', '--json']);
  assert.ok(r.out.length > 8192, `output must exceed the pipe buffer to be a real test, got ${r.out.length} bytes`);
  const parsed = JSON.parse(r.out);
  assert.ok(Array.isArray(parsed) && parsed.length > 50, 'every document class must survive the pipe');
});

test('cli: hook pre-tool denies a generated-tree edit and injects invariants for code', () => {
  const dir = tmpRepo();
  wf(dir, 'src/licensing/v.ts', 'const A = 1;\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'team']);
  wf(dir, 'docs/90-generated/api.md', '# generated\n');
  wf(dir, 'docs/architecture/lic.md',
    '---\ndocgov:\n  id: lic\n  type: architecture.domain\n  visibility: internal\n  documents: ["src/licensing/**"]\n---\n# L\n\n- INV-LIC-001 One org.\n');
  cli(dir, ['registry', '--rebuild']);

  const hook = (input) => {
    const out = execFileSync(process.execPath, [BIN, 'hook', 'pre-tool'], { cwd: dir, input: JSON.stringify(input), encoding: 'utf8' });
    return out.trim() ? JSON.parse(out) : null;
  };
  const denied = hook({ cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'docs/90-generated/api.md'), content: '# edited' } });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /generated/);

  const injected = hook({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/licensing/v.ts') } });
  assert.match(injected.hookSpecificOutput.additionalContext, /INV-LIC-001/);

  const clean = hook({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/unrelated/z.ts') } });
  assert.equal(clean, null, 'an ungoverned path must produce no output at all');
});

test('cli: a malformed hook payload fails open without output', () => {
  const dir = tmpRepo();
  wf(dir, 'package.json', '{"name":"t"}');
  commit(dir);
  cli(dir, ['setup']);
  const out = execFileSync(process.execPath, [BIN, 'hook', 'pre-tool'],
    { cwd: dir, input: '{not json', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(out.trim(), '', 'no stdout means no hook decision, which is the safe default');
});

test('cli: conventional --version and --help flags work, and exit 0', () => {
  const dir = tmpRepo();
  commit(dir);
  for (const flag of ['--version', '-v', 'version']) {
    const r = cli(dir, [flag]);
    assert.equal(r.code, 0, `${flag} must exit 0, got ${r.code}`);
    assert.match(r.out.trim(), /^\d+\.\d+\.\d+$/, `${flag} must print a bare version, got: ${r.out.trim()}`);
  }
  for (const flag of ['--help', '-h', 'help']) {
    const r = cli(dir, [flag]);
    assert.equal(r.code, 0, `${flag} must exit 0`);
    assert.match(r.out, /Exit codes:/, `${flag} must print usage`);
  }
  assert.equal(cli(dir, ['--nonsense']).code, EXIT.CONFIG, 'an unknown flag is still a config error');
});

test('cli: an uninitialized repository is told what to do, not crashed at', () => {
  const dir = tmpRepo();
  wf(dir, 'package.json', '{"name":"t"}');
  commit(dir);
  const r = cli(dir, ['check']);
  assert.equal(r.code, EXIT.CONFIG);
  assert.match(r.out, /docgov setup/);
});

// ───────────────────────────── templates ─────────────────────────────

test('templates: every document class produces a document that satisfies its own gate', async () => {
  const tpl = await import('../core/templates.js');
  const { TYPES } = await import('../core/taxonomy.js');
  const cfg = cfgmod.defaults();
  cfg.profile = cfgmod.MODE_PROFILES.solo;
  const failures = [];
  for (const type of Object.keys(TYPES)) {
    if (TYPES[type].machine || type === 'unknown' || type === 'archive.document') continue;
    const content = tpl.create({ type, title: 'Test', cfg });
    const d = new Document('/tmp', 'x.md', content);
    if (d.error) { failures.push(`${type}: frontmatter error ${d.error}`); continue; }
    if (d.meta.type !== type) failures.push(`${type}: declared type came back as ${d.meta.type}`);
    const missing = d.missingSections();
    if (missing.length) failures.push(`${type}: template is missing its own required sections: ${missing.join(', ')}`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

// --- search before create (responsibility ownership) --------------------------------

test('whoOwns refuses a second document of a single-document class', () => {
  const docs = [{ id: 'readme', path: 'README.md', title: 'Readme', type: 'user.readme', status: 'active' }];
  const r = whoOwns({ docs, type: 'user.readme', name: 'Read me first' });
  assert.equal(r.decision, 'update-existing');
  assert.equal(r.owner.path, 'README.md');
});

test('whoOwns treats a name the existing document already covers as the same responsibility', () => {
  const docs = [{ id: 'a', path: 'docs/user/deploying.md', title: 'Deploying', type: 'user.guide', status: 'active' }];
  // The class label is not part of the topic, and plurals are not a different subject.
  for (const name of ['Deploying', 'Deploying guide', 'Deployings']) {
    assert.equal(whoOwns({ docs, type: 'user.guide', name }).decision, 'update-existing', name);
  }
});

test('whoOwns reports a narrower document rather than refusing it', () => {
  const docs = [{ id: 'a', path: 'docs/user/deploying.md', title: 'Deploying', type: 'user.guide', status: 'active' }];
  const r = whoOwns({ docs, type: 'user.guide', name: 'Deploying to Render' });
  assert.equal(r.decision, 'review-first');
  assert.deepEqual(r.candidates.map((d) => d.path), ['docs/user/deploying.md']);
});

test('whoOwns lets an unrelated document through, and ignores superseded owners', () => {
  const docs = [
    { id: 'a', path: 'docs/user/deploying.md', title: 'Deploying', type: 'user.guide', status: 'active' },
    { id: 'b', path: 'docs/user/backups-old.md', title: 'Backups', type: 'user.guide', status: 'superseded' },
  ];
  assert.equal(whoOwns({ docs, type: 'user.guide', name: 'Quantum tunnelling' }).decision, 'create-new');
  // A superseded guide must not block the replacement that supersedes it.
  assert.equal(whoOwns({ docs, type: 'user.guide', name: 'Backups' }).decision, 'create-new');
});

test('create refuses a competing document and --check answers without writing', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# Thing\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  assert.equal(cli(dir, ['create', 'user.guide', 'Deploying to Fly']).code, 0);

  const refused = cli(dir, ['create', 'user.guide', 'Deploying']);
  assert.equal(refused.code, EXIT.CONFIG);
  assert.match(refused.out, /deploying-to-fly\.md is already/);
  assert.equal(fs.existsSync(path.join(dir, 'docs/user/deploying.md')), false);

  // --force is the documented way past it, and it is the only way past it.
  assert.equal(cli(dir, ['create', 'user.guide', 'Deploying', '--force']).code, 0);
  assert.equal(fs.existsSync(path.join(dir, 'docs/user/deploying.md')), true);

  // --check writes nothing and carries its answer in the exit code as well as the output.
  const check = cli(dir, ['create', 'user.guide', 'Deploying to Fly io', '--check', '--json']);
  assert.equal(check.code, EXIT.REVIEW);
  const spec = JSON.parse(check.out);
  assert.equal(spec.decision, 'update-existing');
  assert.equal(spec.owner.path, 'docs/user/deploying-to-fly.md');
  assert.equal(fs.existsSync(path.join(dir, 'docs/user/deploying-to-fly-io.md')), false);

  const fresh = cli(dir, ['create', 'user.guide', 'Rotating API keys', '--check', '--json']);
  assert.equal(fresh.code, EXIT.OK);
  assert.equal(JSON.parse(fresh.out).decision, 'create-new');
});

test('create --check answers for an occupied path instead of failing', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# Thing\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  cli(dir, ['create', 'user.guide', 'Backups']);
  const r = cli(dir, ['create', 'user.guide', 'Backups', '--check', '--json']);
  assert.equal(r.code, EXIT.REVIEW);
  assert.equal(JSON.parse(r.out).owner.path, 'docs/user/backups.md');
});

// --- brief as a deterministic context compiler --------------------------------------

function packFixture() {
  const docs = [
    new Document('/tmp', 'docs/licensing.md', '---\ndocgov:\n  id: lic\n  type: architecture.domain\n  domain: licensing\n  documents:\n    - src/licensing/**\n---\n# Licensing\n\n- INV-LIC-001 One org per license.\n'),
    new Document('/tmp', 'README.md', '---\ndocgov:\n  id: readme\n  type: user.readme\n  domain: licensing\n  relationships:\n    summarizes:\n      - lic\n---\n# Readme\n\nLicensing in brief.\n'),
    new Document('/tmp', 'docs/old.md', '---\ndocgov:\n  id: old\n  type: architecture.domain\n  domain: licensing\n  status: superseded\n---\n# Old licensing\n\nLicensing, as it was.\n'),
  ];
  const cfg = cfgmod.defaults();
  return { docs, cfg, graph: graphmod.build(docs, reg.build(docs).registry, cfg) };
}

test('brief: the map names what governs, what is claimed, and what derives from what', () => {
  const { docs, cfg, graph } = packFixture();
  const c = compile({ cfg, docs, graph, topic: 'licensing' });
  assert.deepEqual(c.map.authoritative, ['docs/licensing.md']);
  assert.deepEqual(c.map.invariants, ['INV-LIC-001']);
  assert.deepEqual(c.map.implementation, ['src/licensing/**']);
  assert.deepEqual(c.map.derived, [{ path: 'README.md', rel: 'summarizes', source: 'docs/licensing.md' }]);
  // No git history was handed in, so staleness is unknown — which is not the same as none,
  // and the pack must not print the second when it means the first.
  assert.equal(c.map.stale, null);
  assert.match(render(c), /KNOWN STALE\s+unknown/);
});

test('brief: staleness is reported when drift findings are handed in', () => {
  const { docs, cfg, graph } = packFixture();
  const drift = { usable: true, findings: [
    { document: 'docs/licensing.md', kind: 'forward', severity: 'high', why: 'code moved' },
    { document: 'docs/not-in-pack.md', kind: 'forward', severity: 'high', why: 'irrelevant' },
  ] };
  const c = compile({ cfg, docs, graph, topic: 'licensing', drift });
  assert.deepEqual(c.map.stale.map((x) => x.path), ['docs/licensing.md']);
});

test('brief: only authoritative classes sharing a domain count as a conflict', () => {
  const { cfg } = packFixture();
  const two = (id, type) => new Document('/tmp', `docs/${id}.md`,
    `---\ndocgov:\n  id: ${id}\n  type: ${type}\n  domain: licensing\n---\n# ${id}\n\nLicensing.\n`);
  // Two canonical domain specs for one domain: nothing ranks one over the other.
  let docs = [two('a', 'architecture.domain'), two('b', 'architecture.domain')];
  let c = compile({ cfg, docs, graph: graphmod.build(docs, reg.build(docs).registry, cfg), topic: 'licensing' });
  assert.equal(c.map.conflicts.length, 1);
  assert.deepEqual(c.map.conflicts[0].paths, ['docs/a.md', 'docs/b.md']);

  // Two ADRs for one domain: plural by design, and reporting them would be noise.
  docs = [two('a', 'architecture.adr'), two('b', 'architecture.adr')];
  c = compile({ cfg, docs, graph: graphmod.build(docs, reg.build(docs).registry, cfg), topic: 'licensing' });
  assert.deepEqual(c.map.conflicts, []);
});

test('brief: every document considered is recorded with what happened to it', () => {
  const { docs, cfg, graph } = packFixture();
  const c = compile({ cfg, docs, graph, topic: 'licensing' });
  const by = new Map(c.decisions.map((d) => [d.path, d]));
  assert.equal(by.get('docs/licensing.md').state, 'selected');
  assert.equal(by.get('docs/old.md').state, 'rejected');
  assert.match(by.get('docs/old.md').why, /superseded/);
  // A pack that came back thin has to be explainable: every document is accounted for.
  assert.equal(c.decisions.length, docs.length);
});

test('brief: a document dropped for budget is recorded as such, not as absent', () => {
  const { docs, cfg, graph } = packFixture();
  const c = compile({ cfg, docs, graph, topic: 'licensing', budget: 400 });
  render(c);
  assert.ok(c.decisions.some((d) => d.state === 'headings-only' && /budget of 400/.test(d.why)));
});

// --- model judgements are a different kind of object --------------------------------

test('judgements: confidence, evidence and an agent are required', () => {
  assert.deepEqual(judgemod.problems({ check: 'c', path: 'a.md', message: 'm', confidence: 'high', evidence: ['a.md:1'], agent: 'q' }), []);
  const missing = judgemod.problems({ check: 'c', path: 'a.md', message: 'm' });
  assert.equal(missing.length, 3);
  // Evidence must exist, not merely be declared: an empty list is a verdict with no reading
  // behind it, which is the thing the format exists to make impossible.
  assert.ok(judgemod.problems({ check: 'c', path: 'a.md', message: 'm', confidence: 'high', evidence: [], agent: 'q' }).length);
  // A number is accepted and bucketed; agents produce both forms.
  assert.equal(judgemod.normalize({ check: 'c', path: 'a.md', message: 'm', confidence: 0.82, evidence: ['x'], agent: 'q' }).confidence, 'high');
  assert.equal(judgemod.normalize({ check: 'c', path: 'a.md', message: 'm', confidence: 0.6, evidence: ['x'], agent: 'q' }).confidence, 'medium');
});

test('judgements: a model cannot mark its own verdict as a rule', () => {
  const j = judgemod.normalize({ check: 'c', path: 'a.md', message: 'm', confidence: 'high',
    evidence: ['a.md:1'], agent: 'q', blocking: true, deterministic: true, source: 'deterministic' });
  assert.equal(j.blocking, false);
  assert.equal(j.deterministic, false);
  assert.equal(j.source, 'model');
});

test('check reports judgements in their own section and never lets them change the exit code', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '---\ndocgov:\n  id: readme\n  type: user.readme\n---\n# Thing\n\nA thing.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);

  // Written by hand with the flags an agent would need to smuggle to be taken for a rule.
  wf(dir, '.docgov/judgements.json', JSON.stringify({ version: 1, judgements: [{
    check: 'contradiction', path: 'README.md', severity: 'critical', message: 'says 7 days, spec says 30',
    confidence: 'high', evidence: ['README.md:3'], agent: 'quality-reviewer', recorded: '2026-01-01',
    blocking: true, deterministic: true, source: 'deterministic',
  }] }));

  const human = cli(dir, ['check']);
  assert.equal(human.code, EXIT.OK, 'a judgement must never fail a build');
  assert.match(human.out, /JUDGEMENT \(1\)/);
  assert.match(human.out, /high confidence · quality-reviewer/);

  const j = JSON.parse(cli(dir, ['check', '--json']).out);
  assert.equal(j.exitCode, EXIT.OK);
  assert.equal(j.judgements.length, 1);
  assert.equal(j.judgements[0].deterministic, false);
  assert.equal(j.judgements[0].blocking, false);
  // The thing that matters most: it is not in `findings`, so nothing downstream that reads
  // findings can act on it as a rule.
  assert.ok(!j.findings.some((f) => f.check === 'contradiction'));
});

test('judge records a verdict, replaces its own previous one, and refuses an unfalsifiable one', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '---\ndocgov:\n  id: readme\n  type: user.readme\n---\n# Thing\n\nA thing.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);

  const verdict = (message) => JSON.stringify([{ check: 'contradiction', path: 'README.md',
    message, confidence: 'high', evidence: ['README.md:3'], agent: 'quality-reviewer' }]);
  wf(dir, 'v1.json', verdict('first reading'));
  assert.equal(cli(dir, ['judge', '--file', 'v1.json']).code, EXIT.OK);

  // A re-run of the same lens on the same document corrects itself rather than accumulating.
  wf(dir, 'v2.json', verdict('second reading'));
  cli(dir, ['judge', '--file', 'v2.json']);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, '.docgov/judgements.json'), 'utf8'));
  assert.equal(stored.judgements.length, 1);
  assert.equal(stored.judgements[0].message, 'second reading');
  assert.equal(stored.version, 1);

  wf(dir, 'bad.json', JSON.stringify([{ check: 'contradiction', path: 'README.md', message: 'no evidence' }]));
  const bad = cli(dir, ['judge', '--file', 'bad.json']);
  assert.equal(bad.code, EXIT.CONFIG);
  assert.match(bad.out, /evidence` is required/);

  assert.equal(cli(dir, ['judge', '--clear']).code, EXIT.OK);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.docgov/judgements.json'), 'utf8')).judgements.length, 0);
});

test('a judgement cannot reach the write gate a hook enforces', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '---\ndocgov:\n  id: readme\n  type: user.readme\n---\n# Thing\n\nA thing.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  wf(dir, '.docgov/judgements.json', JSON.stringify({ version: 1, judgements: [{
    check: 'generated-edit', path: 'README.md', severity: 'critical', message: 'model says do not edit',
    confidence: 'high', evidence: ['README.md:1'], agent: 'quality-reviewer', blocking: true,
  }] }));
  const input = JSON.stringify({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'README.md') } });
  const r = spawnSync(process.execPath, [BIN, 'hook', 'pre-tool'], { input, encoding: 'utf8', cwd: dir });
  assert.equal(r.status, EXIT.OK);
  assert.ok(!/deny/i.test(r.stdout), 'a model verdict must not become a write denial');
});

// --- the plan is grouped by how much of it you have to read -------------------------

test('plan: the tier says what has to be decided, not what kind of action it is', () => {
  const t = (a) => onboardmod.tierOf(a);
  assert.equal(t({ kind: 'ANNOTATE', requiresJudgement: false }), 'safe');
  assert.equal(t({ kind: 'CREATE', requiresJudgement: false }), 'safe');
  assert.equal(t({ kind: 'MOVE', requiresJudgement: false }), 'confident');
  assert.equal(t({ kind: 'ARCHIVE', requiresJudgement: false }), 'confident');
  // A move whose classification was not clear is the same operation and a different question.
  assert.equal(t({ kind: 'MOVE', requiresJudgement: true }), 'review');
  // Prose rewrites are never mechanical, whatever their flags say.
  assert.equal(t({ kind: 'SPLIT', requiresJudgement: false }), 'review');
  assert.equal(t({ kind: 'MERGE', requiresJudgement: false }), 'review');
  assert.equal(t({ kind: 'EXTRACT', requiresJudgement: false }), 'review');
});

test('plan: every action lands in exactly one tier, and the counts add up', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# Thing\n\nA thing.\n');
  wf(dir, 'notes/install.md', '# Installing\n\n## Steps\n\n1. Run it.\n');
  wf(dir, 'notes/api.md', '# API reference\n\n## GET /things\n\nReturns things.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  cli(dir, ['review']);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, '.docgov/fix-plan.json'), 'utf8'));

  for (const a of plan.actions) assert.ok(['safe', 'confident', 'review'].includes(a.tier), `${a.kind} has tier ${a.tier}`);
  assert.equal(plan.summary.safe + plan.summary.confident + plan.summary.review, plan.actions.length);

  // The rendered plan leads with the shape, before the list a reader would otherwise have to
  // walk line by line to size up.
  const md = fs.readFileSync(path.join(dir, '.docgov/fix-plan.md'), 'utf8');
  assert.match(md, /SAFE\s+\d+/);
  assert.match(md, /HIGH CONFIDENCE\s+\d+/);
  assert.match(md, /NEEDS REVIEW\s+\d+/);
});

test('plan: the review tier does not claim fix will skip a move it actually runs', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# Thing\n\nA thing.\n');
  wf(dir, 'notes/thing.md', '# Thing notes\n\nSome prose with no strong signal either way.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  cli(dir, ['review']);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, '.docgov/fix-plan.json'), 'utf8'));
  const reviewMoves = plan.actions.filter((a) => a.tier === 'review' && a.kind === 'MOVE');
  if (!reviewMoves.length) return;   // nothing to assert about on this fixture

  // `migrate` runs every MOVE regardless of the classification behind it, so a plan that
  // said otherwise would be telling the reader something false about their own repository.
  const md = fs.readFileSync(path.join(dir, '.docgov/fix-plan.md'), 'utf8');
  assert.match(md, /`fix` will still move these/);
  const dry = migratemod.migrate({ root: dir, cfg: cfgmod.load(dir).cfg, docs: snapshot(dir).docs, planData: plan, dryRun: true });
  const ops = JSON.stringify(dry);
  for (const a of reviewMoves) assert.ok(ops.includes(a.to), `${a.path} is executed by fix and the plan must say so`);
});

// --- doctor: does this install actually work -----------------------------------------

/** A minimal plugin tree, so a check can be pointed at a broken one without breaking ours. */
function fakePlugin(version = '1.0.0', { event = 'pre-tool', skillName = 'brief', option = 'enforcement' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-plugin-'));
  wf(dir, 'package.json', JSON.stringify({ version }));
  wf(dir, '.claude-plugin/plugin.json', JSON.stringify({ version, userConfig: { [option]: { type: 'string' } } }));
  wf(dir, 'hooks/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{ hooks: [
    { type: 'command', args: ['node', '${CLAUDE_PLUGIN_ROOT}/bin/docgov', 'hook', event] }] }] } }));
  wf(dir, 'bin/docgov', `// reads CLAUDE_PLUGIN_OPTION_${option}\n`);
  wf(dir, `skills/brief/SKILL.md`, `---\nname: ${skillName}\n---\n`);
  return dir;
}

test('doctor: a hook naming an event the CLI does not implement is a failure, not silence', () => {
  const repo = tmpRepo();
  const good = doctormod.run({ root: repo, pluginRoot: fakePlugin(), env: {} });
  assert.equal(good.checks.find((c) => c.id === 'hook-events').status, 'ok');

  // This is the failure the rename sweep could have caused: hooks.json still says `drift`,
  // the CLI now says `stale`, the hook fires into nothing and nobody is told.
  const bad = doctormod.run({ root: repo, pluginRoot: fakePlugin('1.0.0', { event: 'drift' }), env: {} });
  const c = bad.checks.find((x) => x.id === 'hook-events');
  assert.equal(c.status, 'fail');
  assert.match(c.message, /drift/);
});

test('doctor: a skill whose name does not match its directory is caught', () => {
  const repo = tmpRepo();
  const r = doctormod.run({ root: repo, pluginRoot: fakePlugin('1.0.0', { skillName: 'context' }), env: {} });
  const c = r.checks.find((x) => x.id === 'skills');
  assert.equal(c.status, 'fail');
  assert.match(c.message, /brief declares name: context/);
});

test('doctor: an advertised option nothing reads is a failure', () => {
  const repo = tmpRepo();
  // The real case: three settings advertised in plugin.json and honoured nowhere for two
  // releases, one of them claiming to switch off the only thing leaving the machine.
  const r = doctormod.run({ root: repo, pluginRoot: fakePlugin('1.0.0', { option: 'semantic_gate' }), env: {} });
  const c = r.checks.find((x) => x.id === 'plugin-options');
  assert.equal(c.status, 'ok', 'the fixture writes a reader for whatever option it declares');

  const broken = fakePlugin();
  wf(broken, '.claude-plugin/plugin.json', JSON.stringify({ version: '1.0.0', userConfig: { nobody_reads_this: { type: 'string' } } }));
  const c2 = doctormod.run({ root: repo, pluginRoot: broken, env: {} }).checks.find((x) => x.id === 'plugin-options');
  assert.equal(c2.status, 'fail');
  assert.match(c2.message, /nobody_reads_this/);
});

test('doctor: the two manifests must agree on the version', () => {
  const repo = tmpRepo();
  const dir = fakePlugin('1.0.0');
  wf(dir, '.claude-plugin/plugin.json', JSON.stringify({ version: '0.9.0', userConfig: {} }));
  const c = doctormod.run({ root: repo, pluginRoot: dir, env: {} }).checks.find((x) => x.id === 'version-skew');
  assert.equal(c.status, 'fail');
});

test('doctor: the committed agent rules are checked against the config that generated them', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# Thing\n\nA thing.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
  assert.equal(doctormod.run({ root: dir, pluginRoot, env: {} }).checks.find((c) => c.id === 'agent-rules').status, 'ok');

  // Exactly how it went stale in this repository: the mode changed and nothing regenerated
  // the file, because it is generated but committed.
  const cfgFile = path.join(dir, '.docgov/config.yaml');
  fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace('mode: solo', 'mode: open-source'));
  const stale = doctormod.run({ root: dir, pluginRoot, env: {} }).checks.find((c) => c.id === 'agent-rules');
  assert.equal(stale.status, 'warn');
  assert.match(stale.fix, /setup --rules/);

  // And the repair must be the narrow one: `--force` rewrites config.yaml and takes every
  // registration and domain with it, which is more destructive than the fault.
  const before = fs.readFileSync(cfgFile, 'utf8');
  assert.equal(cli(dir, ['setup', '--rules']).code, EXIT.OK);
  assert.equal(fs.readFileSync(cfgFile, 'utf8'), before, 'setup --rules must not touch the config');
  assert.equal(doctormod.run({ root: dir, pluginRoot, env: {} }).checks.find((c) => c.id === 'agent-rules').status, 'ok');
});

test('doctor exits 0 clean, 2 on something to look at, and reports on an ungoverned repo', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# Thing\n\nA thing.\n');
  commit(dir);

  // Before setup it must still run and say what is missing, rather than refusing: a
  // diagnostic that needs the thing it diagnoses is not a diagnostic.
  const before = cli(dir, ['doctor']);
  assert.equal(before.code, EXIT.REVIEW);
  assert.match(before.out, /not governed yet/);

  cli(dir, ['setup', '--mode', 'solo']);
  const after = cli(dir, ['doctor']);
  assert.equal(after.code, EXIT.OK, after.out);
  assert.match(after.out, /DocGov is working here/);

  const j = JSON.parse(cli(dir, ['doctor', '--json']).out);
  assert.equal(j.version, 1);
  assert.equal(j.counts.fail, 0);
  assert.ok(j.checks.every((c) => ['ok', 'warn', 'fail'].includes(c.status)));
});

test('doctor: a source directory missing from package.json files is caught', () => {
  const repo = tmpRepo();
  const dir = fakePlugin();
  // Exactly what splitting the CLI nearly shipped: a binary importing a directory the
  // published tarball does not contain. Only an install would have shown it.
  wf(dir, 'package.json', JSON.stringify({ version: '1.0.0', files: ['bin', 'core'] }));
  wf(dir, 'cli/parse.js', '// something the binary imports\n');
  const c = doctormod.run({ root: repo, pluginRoot: dir, env: {} }).checks.find((x) => x.id === 'package-files');
  assert.equal(c.status, 'fail');
  assert.match(c.message, /cli/);
});

// --- a project may extend the taxonomy, but not redefine it -------------------------

test('taxonomy: a project class is registered, and re-registering replaces rather than accumulates', () => {
  const spec = { 'qa.evidence': { label: 'QA Evidence', authority: 'implementation',
    paths: ['qa/evidence/**'], sections: ['Scope', 'Method', 'Result'], soft: 300 } };
  const before = tax.typeIds().length;
  assert.deepEqual(tax.registerTypes(spec), ['qa.evidence']);
  assert.equal(tax.typeIds().length, before + 1);
  assert.equal(tax.typeDef('qa.evidence').hard, 540);          // derived from soft
  assert.equal(tax.typeDef('qa.evidence').full, 'qa/evidence/'); // derived from the glob
  assert.deepEqual(tax.customPathSignals(), [['qa/evidence/**', 'qa.evidence', 60, null]]);

  // Config is loaded many times per process; the result must not depend on how often.
  tax.registerTypes(spec);
  assert.equal(tax.typeIds().length, before + 1);
  tax.registerTypes(null);
  assert.equal(tax.typeIds().length, before, 'a later load without the class must not leave it behind');
});

test('taxonomy: a project class cannot shadow one DocGov ships, or arrive underspecified', () => {
  const bad = [
    [{ 'product.prd': { paths: ['x/**'] } }, /DocGov ships/],
    [{ Bad_Id: { paths: ['x/**'] } }, /family\.name/],
    [{ 'qa.evidence': {} }, /paths` is required/],
    [{ 'qa.evidence': { paths: ['x/**'], authority: 'supreme' } }, /authority must be one of/],
    [{ 'qa.evidence': { paths: ['x/**'], soft: 500, hard: 100 } }, /hard >= soft/],
    [{ 'qa.evidence': { paths: ['x/**'], visibility: 'semi' } }, /visibility must be/],
  ];
  for (const [spec, re] of bad) assert.throws(() => tax.registerTypes(spec), re, JSON.stringify(spec));
  tax.registerTypes(null);
});

test('a project class classifies from its own paths, and everything else still abstains', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# Thing\n\nA thing.\n');
  wf(dir, 'qa/evidence/login-sweep.md', '# Login sweep\n\n## Scope\n\nLogin.\n');
  wf(dir, 'musings.md', '# Musing\n\nProse with no signal in it at all.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  const cfgFile = path.join(dir, '.docgov/config.yaml');
  fs.appendFileSync(cfgFile, [
    'taxonomy:', '  types:', '    qa.evidence:', '      label: QA Evidence',
    '      authority: implementation', '      paths:', '        - "qa/evidence/**"',
    '      sections: [Scope, Method, Result]', '      soft: 300', ''].join('\n'));

  const seen = JSON.parse(cli(dir, ['whatis', '--path', 'qa/evidence/login-sweep.md', '--json']).out);
  assert.equal(seen.type, 'qa.evidence');
  assert.match(seen.signals.join(' '), /qa\/evidence/);

  // The point of the whole classifier rebuild: a document with no evidence abstains. A custom
  // class must be evidence, never a catch-all that absorbs whatever is left.
  assert.equal(JSON.parse(cli(dir, ['whatis', '--path', 'musings.md', '--json']).out).type, 'unknown');

  // `types` is the command whose job is to list classes, and it does not call ctx() — so it
  // has to load the config itself or it is the one command that cannot see them.
  const types = JSON.parse(cli(dir, ['types', '--json']).out);
  const mine = types.find((t) => t.type === 'qa.evidence');
  assert.ok(mine, 'docgov types must show a class the project defined');
  assert.equal(mine.source, 'project');

  // And the class is governed like any other: template, required sections, the checks.
  assert.equal(cli(dir, ['create', 'qa.evidence', 'Checkout sweep']).code, EXIT.OK);
  assert.ok(fs.existsSync(path.join(dir, 'qa/evidence/checkout-sweep.md')));
  wf(dir, 'qa/evidence/empty.md', '---\ndocgov:\n  id: empty\n  type: qa.evidence\n---\n# Empty\n\nNothing.\n');
  const out = cli(dir, ['check', '--all']).out;
  assert.match(out, /missing-sections\s+qa\/evidence\/empty\.md/);
});

test('a policy pack can define classes for every repository that adopts it', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# Thing\n\nA thing.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  wf(dir, 'policy/org/policy.yaml', [
    'taxonomy:', '  types:', '    sales.collateral:', '      label: Sales Collateral',
    '      authority: audience', '      paths:', '        - "sales/**"', ''].join('\n'));
  fs.appendFileSync(path.join(dir, '.docgov/config.yaml'), '\npolicy_packs:\n  - policy/org\n');
  const types = JSON.parse(cli(dir, ['types', '--json']).out);
  assert.ok(types.some((t) => t.type === 'sales.collateral' && t.source === 'project'));
});

// --- two reviews, two standards, configured separately -------------------------------

test('lenses: the class chooses the standard, and every lens has a document behind it', () => {
  const cfg = { review: { audience: true, leak: true } };
  assert.equal(lensmod.lensFor(cfg, 'user.readme').lens, 'readme');
  assert.equal(lensmod.lensFor(cfg, 'operations.runbook').lens, 'operations');
  assert.equal(lensmod.lensFor(cfg, 'architecture.adr').lens, 'architecture');
  // A lens the model is told to apply must be a standard a human can read and disagree with.
  for (const l of Object.keys(lensmod.LENSES)) assert.ok(lensmod.lensText(l), `lenses/${l}.md is missing`);
});

test('lenses: audience and leak are configured separately, and audience can be per lens', () => {
  assert.equal(lensmod.isEnabled({}, 'leak'), true, 'both default on');
  assert.equal(lensmod.enabledLenses({}).length, Object.keys(lensmod.LENSES).length);

  // The two are different questions with opposite false-positive tolerances, so turning one
  // off must never turn the other off.
  const noLeak = { review: { leak: false } };
  assert.equal(lensmod.isEnabled(noLeak, 'leak'), false);
  assert.equal(lensmod.enabledLenses(noLeak).length, Object.keys(lensmod.LENSES).length);

  const some = { review: { audience: ['operations', 'security'] } };
  assert.deepEqual(lensmod.enabledLenses(some), ['operations', 'security']);
  assert.equal(lensmod.isEnabled(some, 'leak'), true);
  assert.equal(lensmod.lensFor(some, 'user.readme').enabled, false);
  assert.equal(lensmod.lensFor(some, 'operations.runbook').enabled, true);
});

test('the write hook hands over the standard the document will be judged against', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# Thing\n\nA thing.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);

  const hook = (file, content, tool = 'Write') => {
    const input = JSON.stringify({ cwd: dir, tool_name: tool,
      tool_input: { file_path: path.join(dir, file), content } });
    const r = spawnSync(process.execPath, [BIN, 'hook', 'pre-tool'], { input, encoding: 'utf8', cwd: dir });
    assert.equal(r.status, EXIT.OK);
    if (!r.stdout.trim()) return '';
    return JSON.parse(r.stdout).hookSpecificOutput?.additionalContext || '';
  };

  const runbook = hook('docs/runbooks/failover.md', '# Failover runbook\n\n## Steps\n\nDo it.\n');
  assert.match(runbook, /The standard for a Runbook/);
  assert.match(runbook, /3am/, 'the operations lens itself must be handed over, not just its name');
  assert.ok(!/five minutes/.test(runbook), 'a runbook must not be judged by the README standard');

  // Leak detection is the other question, and it runs on an edit too: a credential is just as
  // published when it is pasted into a document that already existed.
  const leaked = hook('README.md', '# T\n\nRun with AKIAIOSFODNN7EXAMPLE against db01.internal.corp\n', 'Edit');
  assert.match(leaked, /DocGov \(leak\)/);
  assert.match(leaked, /AWS access key id/);
  assert.match(leaked, /a clean scan is not proof/, 'a clean scan must never be reported as proof of safety');

  // Switched off separately: no leak reporting, and only the lenses that were named.
  fs.appendFileSync(path.join(dir, '.docgov/config.yaml'), '\nreview:\n  leak: false\n  audience: [operations]\n');
  assert.equal(hook('README.md', '# T\n\nAKIAIOSFODNN7EXAMPLE\n', 'Edit'), '');
  assert.match(hook('docs/runbooks/other.md', '# Other runbook\n\n## Steps\n\nDo it.\n'), /The standard for a Runbook/);
  assert.ok(!/The standard for/.test(hook('docs/guides/new-guide.md', '# A guide\n\nHow to do a thing you want to do.\n')));
});

test('the two model reviews are two prompts, each stating its own tolerance', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
  const prompts = (hooks.hooks.PreToolUse || []).flatMap((e) => (e.hooks || []).filter((h) => h.type === 'prompt'));
  assert.equal(prompts.length, 2, 'audience fit and leak detection are different questions');

  const [audience, leak] = prompts.map((p) => p.prompt);
  // Audience review is a quality judgement: a false positive costs an argument about prose.
  assert.match(audience, /Be conservative/);
  assert.match(audience, /name the lens you judged against/);
  for (const l of Object.keys(lensmod.LENSES)) assert.match(audience, new RegExp(`\\b${l}\\b`), `lens ${l} is missing from the audience prompt`);

  // Leak detection is a security question: a false negative publishes a secret.
  assert.match(leak, /false positive is cheap and a false negative is not/);
  assert.match(leak, /never means the document contains no secrets/);

  // Neither may ever block a write.
  for (const p of prompts) assert.equal(p.continueOnBlock, true);
});

// --- competing for one responsibility, which is not the same as similar text --------

function guides(dir) {
  const setup = 'Clone the repository, run npm install, copy .env.example to .env, then npm run dev '
    + 'to start the development server on port 3000.';
  const guide = (id, title, body) => `---\ndocgov:\n  id: ${id}\n  type: user.guide\n---\n# ${title}\n\n`
    + `## Goal\n\n${body}\n\n## Steps\n\n1. Clone\n2. Install\n\n## Verification\n\nIt runs.\n\n## Related\n\nNone.\n`;
  wf(dir, 'README.md', '# Thing\n\nA thing.\n');
  wf(dir, 'docs/guides/local-setup.md', guide('setup-a', 'Local setup', setup));
  wf(dir, 'docs/guides/dev-setup.md', guide('setup-b', 'Developer setup guide', `${setup} Also install docker.`));
  wf(dir, 'docs/guides/billing.md', guide('billing', 'Billing', 'Invoices, proration, tax rates and subscription changes.'));
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  return dir;
}

test('competing: two guides owning one subject are found; an unrelated one is not', () => {
  const dir = guides(tmpRepo());
  const groups = competingmod.competing({ docs: snapshot(dir).docs });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].paths, ['docs/guides/dev-setup.md', 'docs/guides/local-setup.md']);
  assert.equal(groups[0].topic, 'setup');
  assert.equal(groups[0].lens, 'user');
});

test('competing: a stated relationship is the opposite of an undeclared competition', () => {
  const dir = guides(tmpRepo());
  const file = path.join(dir, 'docs/guides/dev-setup.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace('  type: user.guide', '  type: user.guide\n  relationships:\n    derived_from:\n      - setup-a'));
  assert.deepEqual(competingmod.competing({ docs: snapshot(dir).docs }), []);
});

test('competing: a name needs a body behind it, and a body needs a name', () => {
  const dir = guides(tmpRepo());
  const docs = snapshot(dir).docs;

  // Name alone is not enough. Two documents both called "setup" that are about different
  // things are two documents about different things.
  wf(dir, 'docs/guides/dns-setup.md', '---\ndocgov:\n  id: dns\n  type: user.guide\n---\n# DNS setup\n\n'
    + '## Goal\n\nDelegate the zone, add the CAA record, wait for propagation.\n\n## Steps\n\n1. Delegate\n\n'
    + '## Verification\n\ndig returns the record.\n\n## Related\n\nNone.\n');
  commit(dir);
  const withDns = competingmod.competing({ docs: snapshot(dir).docs });
  assert.ok(!withDns.some((g) => g.paths.includes('docs/guides/dns-setup.md')),
    'sharing the word "setup" is not sharing a responsibility');

  // Body alone is not enough either, and this is the measured reason: in a repository about
  // one subject, documents that compete for nothing still score 0.23-0.43 against each other.
  assert.ok(docs.length >= 3);
});

test('competing: an unclassified document is never reported, and neither is an organised one', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# Thing\n\nA thing.\n');
  // Two documents with no classification: nothing has established what audience either has,
  // and on a repository that has not adopted DocGov that is nearly every file. Treating them
  // as one audience produced a single cluster holding most of the tree.
  wf(dir, 'notes/a.md', '# Notes one\n\nSetup notes about installing and running the thing locally.\n');
  wf(dir, 'notes/b.md', '# Notes two\n\nSetup notes about installing and running the thing locally.\n');
  commit(dir);
  cli(dir, ['setup', '--mode', 'solo']);
  assert.deepEqual(competingmod.competing({ docs: snapshot(dir).docs }), []);
});

test('check reports a competing cluster once, not once per pair', () => {
  const dir = guides(tmpRepo());
  const j = JSON.parse(cli(dir, ['check', '--all', '--json']).out);
  const found = j.findings.filter((f) => f.check === 'competing-responsibility');
  assert.equal(found.length, 1, 'three guides are one problem, not three pairs');
  assert.deepEqual(found[0].others, ['docs/guides/local-setup.md']);
  assert.equal(found[0].blocking, false, 'whether two documents should be one is a judgement call');
});
