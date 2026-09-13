import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
import { pack } from '../core/context.js';
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

test('links: broken internal links are detected, valid ones are not', () => {
  const d = new Document('/tmp', 'docs/a.md', '# A\n\n[ok](b.md) [bad](missing.md) [ext](https://x.test)\n');
  const broken = brokenLinks([d], '/tmp', new Set(['docs/a.md', 'docs/b.md']));
  assert.deepEqual(broken.map((b) => b.target), ['missing.md']);
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
  assert.equal(r[0].rule, 'generated-edit');
  assert.ok(r[0].blocking, 'generated-edit blocks in every mode');
});

test('preWrite: blocks a duplicate id and says which document owns it', () => {
  const { cfg } = cfgmod.load(ROOT);
  const registry = { documents: { taken: { path: 'docs/a.md' } } };
  const r = check.preWrite({ cfg, relPath: 'docs/b.md', registry, isNew: true, content: '---\ndocgov:\n  id: taken\n---\n# b\n' });
  const dup = r.find((x) => x.rule === 'duplicate-id');
  assert.ok(dup && dup.blocking);
  assert.match(dup.message, /docs\/a\.md/);
});

test('preWrite: blocks an internal document written into a public path', () => {
  const { cfg } = cfgmod.load(ROOT);
  cfg.governance.enforce = ['visibility-path'];
  const r = check.preWrite({ cfg, relPath: 'docs/11-external/leak.md', registry: { documents: {} }, isNew: true,
    content: '---\ndocgov:\n  id: leak\n  type: security.threat-model\n  visibility: internal\n---\n# t\n' });
  const v = r.find((x) => x.rule === 'visibility-path');
  assert.ok(v && v.blocking, 'an internal threat model in an external path must be blocked');
});

test('preWrite: surfaces unparseable frontmatter before the write lands', () => {
  const { cfg } = cfgmod.load(ROOT);
  const r = check.preWrite({ cfg, relPath: 'docs/a.md', registry: { documents: {} }, isNew: true,
    content: '---\ndocgov:\n  id: &anchor x\n---\n# a\n' });
  assert.ok(r.some((x) => x.rule === 'invalid-yaml'));
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
  const m = impactmod.manifest(r);
  assert.deepEqual(m.docs.outstanding, ['auth-sec']);
});

// ───────────────────────────── CLI contract ─────────────────────────────

test('cli: init → create → check is a clean cycle', () => {
  const dir = tmpRepo();
  wf(dir, 'package.json', '{"name":"t"}');
  commit(dir);
  assert.equal(cli(dir, ['init', '--mode', 'solo']).code, 0);
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
  const init = cli(dir, ['init']);
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
  const init = cli(dir, ['init']);
  assert.doesNotMatch(init.out, /warn_only/, 'there is nothing to ramp up from');
});

test('cli: check exits 1 on a blocking violation and 0 once it is fixed', () => {
  const dir = tmpRepo();
  wf(dir, 'package.json', '{"name":"t"}');
  commit(dir);
  cli(dir, ['init', '--mode', 'solo']);
  wf(dir, 'docs/a.md', '---\ndocgov:\n  id: same\n  type: user.guide\n---\n# A\n\n## Goal\n\n## Steps\n\n## Verification\n\n## Related\n');
  wf(dir, 'docs/b.md', '---\ndocgov:\n  id: same\n  type: user.guide\n---\n# B\n\n## Goal\n\n## Steps\n\n## Verification\n\n## Related\n');
  assert.equal(cli(dir, ['check']).code, EXIT.VIOLATION, 'duplicate id must block even in solo mode');
  fs.writeFileSync(path.join(dir, 'docs/b.md'),
    '---\ndocgov:\n  id: other\n  type: user.guide\n---\n# B\n\n## Goal\n\n## Steps\n\n## Verification\n\n## Related\n');
  assert.equal(cli(dir, ['check']).code, EXIT.OK);
});

test('cli: migrate refuses to run on a dirty tree', () => {
  const dir = tmpRepo();
  wf(dir, 'package.json', '{"name":"t"}');
  commit(dir);
  cli(dir, ['init', '--mode', 'solo']);
  wf(dir, 'STRAY.md', '# Stray\n');
  cli(dir, ['onboard']);
  const r = cli(dir, ['migrate']);
  assert.equal(r.code, EXIT.CONFIG);
  assert.match(r.out, /uncommitted changes/);
});

test('cli: migrate moves documents, repairs links and verifies the result', () => {
  const dir = tmpRepo();
  wf(dir, 'architecture.md', '# Architecture\n\nComponents and boundaries. See [the runbook](failover-runbook.md).\n');
  wf(dir, 'failover-runbook.md', '# Failover\n\n## Trigger\n\n## Procedure\n\nBack to [architecture](architecture.md).\n');
  commit(dir);
  cli(dir, ['init', '--mode', 'solo']);
  commit(dir, 'init docgov');
  assert.equal(cli(dir, ['onboard']).code, 0, 'onboard must not need a committed plan');

  const r = cli(dir, ['migrate', '--branch=test-migration']);
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

test('cli: migrate leaves an unclassifiable document where it is rather than guessing', () => {
  const dir = tmpRepo();
  wf(dir, 'thoughts.md', '# Thoughts\n\nUnstructured prose with no classification signal at all.\n');
  commit(dir);
  cli(dir, ['init', '--mode', 'solo']);
  commit(dir, 'init docgov');
  cli(dir, ['onboard']);
  const r = cli(dir, ['migrate']);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /CLASSIFY/, 'it must be deferred, visibly');
});

test('cli: every command accepts --json and emits parseable JSON', () => {
  const dir = tmpRepo();
  wf(dir, 'README.md', '# T\n\n## Install\n\n## Usage\n');
  commit(dir);
  cli(dir, ['init', '--mode', 'solo']);
  for (const args of [['check'], ['health'], ['graph'], ['registry'], ['types'], ['invariants'],
    ['impact'], ['drift'], ['find', 'install'], ['classify', '--path', 'README.md'], ['capabilities'], ['publish']]) {
    const r = cli(dir, [...args, '--json']);
    assert.doesNotThrow(() => JSON.parse(r.out), `${args.join(' ')} --json must emit JSON, got: ${r.out.slice(0, 160)}`);
  }
});

test('cli: hook pre-tool denies a generated-tree edit and injects invariants for code', () => {
  const dir = tmpRepo();
  wf(dir, 'src/licensing/v.ts', 'const A = 1;\n');
  commit(dir);
  cli(dir, ['init', '--mode', 'team']);
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
  cli(dir, ['init']);
  const out = execFileSync(process.execPath, [BIN, 'hook', 'pre-tool'],
    { cwd: dir, input: '{not json', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(out.trim(), '', 'no stdout means no hook decision, which is the safe default');
});

test('cli: an uninitialized repository is told what to do, not crashed at', () => {
  const dir = tmpRepo();
  wf(dir, 'package.json', '{"name":"t"}');
  commit(dir);
  const r = cli(dir, ['check']);
  assert.equal(r.code, EXIT.CONFIG);
  assert.match(r.out, /docgov init/);
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
