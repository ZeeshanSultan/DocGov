/**
 * What is wrong, what moved out from under what, and what that obliges you to update.
 * `check` runs on every write and in CI, so it is the one that decides whether a build
 * passes — and the one place where a model's verdict is kept visibly apart from a rule.
 */
import path from 'node:path';
import fs from 'node:fs';
import * as cfgmod from '../../core/config.js';
import * as checkmod from '../../core/check.js';
import * as driftmod from '../../core/drift.js';
import * as impactmod from '../../core/impact.js';
import * as onboardmod from '../../core/onboard.js';
import * as inv from '../../core/inventory.js';
import * as ctxpack from '../../core/context.js';
import * as healthmod from '../../core/health.js';
import { competing } from '../../core/competing.js';
import * as pubmod from '../../core/publish.js';
import * as supp from '../../core/suppressions.js';
import * as git from '../../core/git.js';
import * as yaml from '../../core/yaml.js';
import * as schemamod from '../../core/schema.js';
import * as judge from '../../core/judgements.js';
import * as doctormod from '../../core/doctor.js';
import { Document } from '../../core/document.js';
import { staleness } from '../../core/drift.js';
import { EXIT, DocGovError, table, write, read, plural } from '../../core/util.js';
import { emit, emitOrPrint, excerpt, json, printFinding, say, warn, yn } from '../output.js';
import { list } from '../parse.js';
import { ctx, findingId, packageVersion, reportIncompleteScan } from '../context.js';
import { usage } from '../usage.js';

export function cmdCheck(flags) {
  const c = ctx();
  const changedOnly = flags.changed === true;
  const base = flags.base ? String(flags.base) : 'HEAD';
  let only = null;
  if (changedOnly) {
    const changed = git.changedFiles(c.root, base).map((x) => x.path);
    only = changed.filter((p) => /\.mdx?$/.test(p));
  }
  if (flags.path) only = [String(flags.path)];

  const { findings } = checkmod.run({ ...c, only });
  const sup = supp.load(c.root, c.cfg);
  const withIds = findings.map((f) => ({ ...f, id: findingId(f) }));
  const split = supp.apply(withIds, sup);

  let drift = { findings: [] };
  if (c.cfg.drift.enabled && flags.no_drift !== true) {
    drift = driftmod.analyze({ root: c.root, cfg: c.cfg, docs: c.docs, graph: c.graph, base });
  }
  const driftSplit = supp.apply(drift.findings, sup);

  // Model judgements are loaded but never merged into `findings`, and never reach
  // `exitCode`. A verdict a model reached is advisory by construction: software decides what
  // blocks. Keeping them in a separate array is what makes that impossible to get wrong
  // downstream, rather than merely unlikely.
  const judgements = judge.load(c.root).judgements;

  const code = checkmod.exitCode({ findings: split.active, driftFindings: driftSplit.active, cfg: c.cfg });
  const stats = checkmod.summarize(split.active);

  if (json()) {
    emit(schemamod.stamp('findings', {
      exitCode: code, stats, findings: split.active, judgements, suppressed: split.suppressed.length,
      expiredSuppressions: split.expired, drift: driftSplit.active, unusedSuppressions: split.unused,
      scanSkipped: c.inv?.scanSkipped || [] }));
    return code;
  }

  if (!split.active.length && !driftSplit.active.length && !judgements.length) {
    say(`✓ ${plural(c.docs.length, 'document')} checked, no findings.`);
    reportIncompleteScan(c);
    if (split.suppressed.length) say(`  (${split.suppressed.length} suppressed)`);
    return code;
  }
  say(`DocGov check — ${plural(c.docs.length, 'document')}, mode ${c.cfg.project.mode}`);
  say('─'.repeat(54));
  const blocking = split.active.filter((f) => f.blocking);
  const advisory = split.active.filter((f) => !f.blocking);
  if (blocking.length) {
    say('');
    say(`BLOCKING (${blocking.length}) — these fail CI`);
    for (const f of blocking) printFinding(f);
  }
  if (advisory.length) {
    say('');
    say(`ADVISORY (${advisory.length}) — reported, not enforced in mode "${c.cfg.project.mode}"`);
    for (const f of advisory.slice(0, flags.all ? advisory.length : 25)) printFinding(f);
    if (!flags.all && advisory.length > 25) say(`  … ${advisory.length - 25} more (pass --all)`);
  }
  if (driftSplit.active.length) {
    say('');
    say(`DRIFT (${driftSplit.active.length})`);
    for (const f of driftSplit.active.slice(0, 12)) {
      say(`  ${f.severity.toUpperCase().padEnd(8)} ${f.id}  ${f.document}`);
      say(`           ${f.why}`);
      say(`           → ${f.action}`);
    }
  }
  if (judgements.length) {
    say('');
    say(`JUDGEMENT (${judgements.length}) — a model's reading, not a rule. Never blocks.`);
    for (const j of judgements.slice(0, flags.all ? judgements.length : 12)) {
      say(`  ${j.severity.padEnd(8)} ${j.check.padEnd(21)} ${j.path}`);
      say(`           ${j.message}`);
      say(`           ${j.confidence} confidence · ${j.agent} · ${j.recorded}`);
      for (const e of j.evidence.slice(0, 3)) say(`           read: ${e}`);
    }
    if (!flags.all && judgements.length > 12) say(`  … ${judgements.length - 12} more (pass --all)`);
  }
  if (split.expired.length) {
    say('');
    say(`EXPIRED SUPPRESSIONS (${split.expired.length}) — no longer suppressing:`);
    for (const f of split.expired) say(`  ${f.id}  expired ${f.suppression.expires}: ${f.suppression.reason}`);
  }
  reportIncompleteScan(c);
  say('');
  say(`exit ${code}  ${code === 0 ? '(pass)' : code === 1 ? '(deterministic violation)' : '(drift requires review)'}`);
  return code;
}

export function cmdStale(flags) {
  const c = ctx();
  const base = flags.base ? String(flags.base) : 'HEAD';
  const res = driftmod.analyze({ root: c.root, cfg: c.cfg, docs: c.docs, graph: c.graph, base });
  const sup = supp.load(c.root, c.cfg);
  const split = supp.apply(res.findings, sup);
  const stale = flags.no_staleness === true ? [] : staleness({ root: c.root, cfg: c.cfg, docs: c.docs, graph: c.graph });

  if (json()) {
    emit(schemamod.stamp('findings', { ...res, findings: split.active, suppressed: split.suppressed,
      staleness: stale,
      packets: driftmod.reviewPackets({ root: c.root, findings: split.active, base }) }));
    return split.active.some((f) => ['critical', 'high'].includes(f.severity)) ? EXIT.REVIEW : EXIT.OK;
  }

  if (!res.usable) { say(res.note); return EXIT.OK; }
  const by = (s) => split.active.filter((f) => f.severity === s).length;
  say('DOCUMENTATION DRIFT REPORT');
  say(`Base: ${base} · ${plural(res.changed.length, 'changed file')}`);
  say(`Critical: ${by('critical')}   High: ${by('high')}   Medium: ${by('medium')}   Low: ${by('low')}`);
  say('');
  for (const f of split.active) {
    say(`${f.severity.toUpperCase()}  ${f.id}  [${f.kind}]`);
    say(`  Document:       ${f.document} (${f.documentAuthority})`);
    if (f.implementation?.length) say(`  Implementation: ${f.implementation.slice(0, 4).join(', ')}${f.implementationCount > 4 ? ` +${f.implementationCount - 4} more` : ''}`);
    say(`  Why:            ${f.why}`);
    say(`  Action:         ${f.action}`);
    if (f.invariants?.length) say(`  Invariants:     ${f.invariants.join(', ')}`);
    say('');
  }
  if (!split.active.length) say('No drift detected.');
  const hot = stale.filter((s) => s.risk >= (c.cfg.drift.stale_threshold ?? 60));
  if (hot.length) {
    say(`STALENESS RISK (${hot.length} document(s) above ${c.cfg.drift.stale_threshold})`);
    for (const s of hot.slice(0, 10)) {
      say(`  ${String(s.risk).padStart(3)}/100  ${s.path}`);
      for (const sig of s.signals.slice(0, 2)) say(`           ${sig}`);
    }
    say('');
  }
  if (split.suppressed.length) say(`${split.suppressed.length} finding(s) suppressed.`);
  say('Semantic confirmation (does the prose actually contradict the code?) is the drift-reviewer');
  say('agent\'s job: run /docgov:stale in Claude Code. This report is the deterministic half.');
  return split.active.some((f) => ['critical', 'high'].includes(f.severity)) ? EXIT.REVIEW : EXIT.OK;
}

export function cmdAffected(flags) {
  const c = ctx();
  const base = flags.base ? String(flags.base) : 'HEAD';
  const paths = flags.paths ? list(flags.paths) : (flags._.length ? flags._ : null);
  const res = impactmod.analyze({ root: c.root, cfg: c.cfg, docs: c.docs, graph: c.graph, base, paths });
  if (json()) return emit({ ...res, checklist: impactmod.checklist(res) }) ?? EXIT.OK;
  say('CHANGE IMPACT');
  say(`Changed: ${res.changed.length} file(s)${res.domains.length ? ` · domains: ${res.domains.join(', ')}` : ''}`);
  say(`Impact level: ${res.level}`);
  say('');
  const sig = res.signals;
  say(`behaviour ${yn(sig.behaviorChanged)}  api ${yn(sig.apiChanged)}  security ${yn(sig.securityChanged)}  tests ${yn(sig.testsChanged)}  user-visible ${yn(sig.userVisible)}`);
  say('');
  const req = res.affected.filter((a) => a.required);
  const opt = res.affected.filter((a) => !a.required);
  say(`Required review (${req.length}):`);
  for (const a of req) say(`  ${a.updated ? '✓' : '✗'} ${a.path}  [${a.authority}]  ${a.reasons[0] || ''}`);
  if (!req.length) say('  (none)');
  if (opt.length) {
    say('');
    say(`Optional review (${opt.length}):`);
    for (const a of opt.slice(0, 10)) say(`  · ${a.path}  ${a.reasons[0] || ''}`);
  }
  return EXIT.OK;
}

export function cmdChecklist(flags) {
  const c = ctx();
  const base = flags.base ? String(flags.base) : 'HEAD';
  const res = impactmod.analyze({ root: c.root, cfg: c.cfg, docs: c.docs, graph: c.graph, base });
  const m = impactmod.checklist(res);
  const out = path.join(c.root, '.docgov', 'checklist.yaml');
  if (flags.no_write !== true) write(out, yaml.stringify(schemamod.stamp('checklist', m)));
  if (flags.pr === true) {
    const drift = driftmod.analyze({ root: c.root, cfg: c.cfg, docs: c.docs, graph: c.graph, base });
    const report = impactmod.prReport(res, drift, c.cfg);
    if (json()) return emit(schemamod.stamp('checklist', { checklist: m, pr: report })) ?? (report.blocked ? EXIT.REVIEW : EXIT.OK);
    say(report.text);
    return report.blocked ? EXIT.REVIEW : EXIT.OK;
  }
  if (json()) return emit(schemamod.stamp('checklist', m)) ?? EXIT.OK;
  say(yaml.stringify(m).trimEnd());
  say('');
  say(`Written to ${path.relative(c.root, out)} — delete it after merge.`);
  return m.docs.outstanding.length ? EXIT.REVIEW : EXIT.OK;
}

export function cmdHealth(flags) {
  const c = ctx();
  const { findings } = checkmod.run(c);
  const stale = staleness({ root: c.root, cfg: c.cfg, docs: c.docs, graph: c.graph });
  const h = healthmod.health({ cfg: c.cfg, docs: c.docs, inv: c.inv, graph: c.graph, registry: c.registry, findings, stale });
  if (json()) return emit(schemamod.stamp('health', h)) ?? EXIT.OK;
  say(`Documentation Health: ${h.overall}/100`);
  say('');
  for (const [k, v] of Object.entries(h.components)) say(`  ${k.padEnd(20)} ${String(v).padStart(3)}`);
  say('');
  say('Issues:');
  for (const [k, v] of Object.entries(h.issues)) if (v) say(`  ${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}`);
  if (h.gaps.length) {
    say('');
    say('Documentation the repository implies but does not have:');
    for (const g of h.gaps.slice(0, 8)) say(`  ${g.label.padEnd(26)} ${g.because === 'baseline' ? 'baseline' : `${g.because} detected`}`);
    say('');
    say(`  create with: docgov create ${h.gaps[0].type}`);
  }
  return EXIT.OK;
}

export function cmdPublish(flags) {
  const c = ctx();
  const res = pubmod.analyze({ cfg: c.cfg, docs: c.docs, target: flags.target ? String(flags.target) : undefined });
  if (json()) return emit({ ...res, briefs: res.rewrite.slice(0, 5).map((r) => ({ path: r.path, brief: pubmod.rewriteBrief(r) })) }) ?? EXIT.OK;
  say('PUBLISHING ANALYSIS');
  say('');
  say(`Publishable as-is (${res.publishable.length}):`);
  for (const p of res.publishable) say(`  ✓ ${p.path}${p.softFlags ? `   (${p.softFlags} soft flag(s) to review)` : ''}`);
  if (!res.publishable.length) say('  (none)');
  say('');
  say(`Blocked (${res.blocked.length}):`);
  for (const b of res.blocked) {
    say(`  ✗ ${b.path} — ${b.reason}`);
    for (const l of (b.leaks || []).slice(0, 3)) say(`      line ${l.line}: ${l.what} (${l.sample})`);
  }
  if (!res.blocked.length) say('  (none)');
  say('');
  say(`Needs an external-lens rewrite (${res.rewrite.length}) — a public document is a different artifact, not a copy:`);
  for (const r of res.rewrite.slice(0, 10)) say(`  · ${r.path} (${r.currentVisibility})${r.leaks.length ? `   ${r.leaks.length} pattern(s) to remove` : ''}`);
  say('');
  say(res.gate);
  return EXIT.OK;
}

export function cmdInspect(flags) {
  const c = ctx();
  const base = flags.base ? String(flags.base) : 'HEAD';
  const what = flags._[0] || 'stale';
  if (what === 'contradictions') {
    const pairs = (onboardmod.loadPlan(c.root) || onboardmod.plan(c)).contradictionCandidates;
    const packets = pairs.slice(0, parseInt(flags.limit || '10', 10)).map((p) => ({
      pair: [p.a, p.b], score: p.score, note: p.note,
      a: excerpt(c.docs.find((d) => d.path === p.a)), b: excerpt(c.docs.find((d) => d.path === p.b)),
    }));
    emitOrPrint({ kind: 'contradictions', packets });
    return EXIT.OK;
  }
  if (what === 'competing') {
    // The deterministic half narrows; the model decides whether these should be one document,
    // which depends on what they say and is not decidable here. Whatever it concludes goes
    // back through `docgov judge`, where a verdict stays visibly a verdict.
    const groups = competing({ docs: c.docs, limit: parseInt(flags.limit || '10', 10) });
    const packets = groups.map((g) => ({
      topic: g.topic, lens: g.lens, why: g.why,
      documents: g.documents.map((d) => ({ ...d, excerpt: excerpt(c.docs.find((x) => x.path === d.path), 1200) })),
      question: 'Are these one responsibility split across several documents, or several '
        + 'responsibilities that happen to share vocabulary? If one, say which should own it '
        + 'and what becomes of the others. Record the verdict with '
        + '`docgov judge --file - --agent inspect`, check "competing-responsibility", '
        + 'with what you read as the evidence.',
    }));
    emitOrPrint({ kind: 'competing', packets });
    return EXIT.OK;
  }
  if (what === 'quality') {
    const { findings } = checkmod.run(c);
    const targets = flags.path ? c.docs.filter((d) => d.path === flags.path) : c.docs;
    const packets = targets.map((d) => ({
      ...healthmod.qualityFloor({ cfg: c.cfg, doc: d, findings }),
      lens: d.lens, agentReadiness: ctxpack.agentReadiness(d), excerpt: excerpt(d),
    }));
    emitOrPrint({ kind: 'quality', packets });
    return EXIT.OK;
  }
  const drift = driftmod.analyze({ root: c.root, cfg: c.cfg, docs: c.docs, graph: c.graph, base });
  const packets = driftmod.reviewPackets({ root: c.root, findings: drift.findings, base,
    limit: parseInt(flags.limit || '12', 10) });
  for (const p of packets) {
    const doc = c.docs.find((d) => d.path === p.document);
    p.documentExcerpt = excerpt(doc);
  }
  emitOrPrint({ kind: 'stale', packets });
  return EXIT.OK;
}

export function cmdIgnore(flags) {
  const c = ctx();
  if (flags.list === true || flags._[0] === 'list') {
    const data = supp.load(c.root, c.cfg);
    if (json()) return emit(data) ?? EXIT.OK;
    if (!data.suppressions.length) { say('No suppressions.'); return EXIT.OK; }
    say(table(data.suppressions.map((s) => ({ Id: s.id, Created: s.created, Expires: s.expires || 'never', Reason: s.reason })),
      ['Id', 'Created', 'Expires', 'Reason']));
    return EXIT.OK;
  }
  if (flags.remove) {
    const ok = supp.remove(c.root, c.cfg, String(flags.remove));
    say(ok ? `Removed suppression ${flags.remove}.` : `No suppression with id ${flags.remove}.`);
    return ok ? EXIT.OK : EXIT.CONFIG;
  }
  const id = flags._[0] || flags.id;
  if (!id) throw new DocGovError('usage: docgov ignore <FINDING-ID> --reason "why" [--expires YYYY-MM-DD]');
  const entry = supp.add(c.root, c.cfg, { id: String(id), reason: flags.reason, expires: flags.expires ? String(flags.expires) : null, by: flags.by ? String(flags.by) : null });
  if (json()) return emit(entry) ?? EXIT.OK;
  say(`Suppressed ${entry.id}${entry.expires ? ` until ${entry.expires}` : ''}: ${entry.reason}`);
  say('It stays visible in `docgov ignore --list` and in every report. Nothing is silently ignored.');
  return EXIT.OK;
}

export function cmdJudge(flags) {
  const c = ctx();
  const agent = flags.agent ? String(flags.agent) : null;

  if (flags.clear) {
    const gone = judge.clear(c.root, { agent });
    if (json()) return emit({ cleared: gone, agent }) ?? EXIT.OK;
    say(`Cleared ${plural(gone, 'judgement')}${agent ? ` from ${agent}` : ''}.`);
    return EXIT.OK;
  }

  // `--file -` reads stdin, which is how an agent pipes a verdict straight out of a lens.
  const src = flags.file ? String(flags.file) : null;
  if (!src) {
    throw new DocGovError('usage: docgov judge --file <verdicts.json|-> [--agent NAME]\n'
      + '       docgov judge --clear [--agent NAME]\n\n'
      + 'Each verdict needs: check, path, message, confidence (low|medium|high or 0-1),\n'
      + 'evidence (a non-empty list of what was read), agent.');
  }
  const raw = src === '-' ? fs.readFileSync(0, 'utf8') : read(path.resolve(c.root, src));
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new DocGovError(`${src} is not valid JSON: ${e.message}`); }
  const list = Array.isArray(parsed) ? parsed : (parsed.judgements || parsed.findings || [parsed]);

  const res = judge.record(c.root, list, { agent });
  if (json()) return emit({ ...res, file: '.docgov/judgements.json' }) ?? EXIT.OK;
  say(`Recorded ${plural(res.recorded, 'judgement')}${res.replaced ? `, replacing ${res.replaced}` : ''}.`);
  say('They are advisory by construction: `docgov check` shows them in their own section and');
  say('they never change its exit code.');
  return EXIT.OK;
}

/**
 * Record what a model concluded. This is the only way a semantic finding enters DocGov, and
 * it is deliberately a different door from the one deterministic findings come through.
 */
/**
 * Is DocGov actually working here? Hooks are invisible when they work and mystifying when
 * they do not, and the same is true of a skill under the wrong name or an option nothing
 * reads. Every check answers "does this file still agree with that one".
 */
export function cmdDoctor(flags) {
  const root = cfgmod.load(process.cwd()).root;
  const pluginRoot = doctormod.pluginRootOf();
  const r = doctormod.run({ root, pluginRoot });
  const code = r.counts.fail ? EXIT.VIOLATION : r.counts.warn ? EXIT.REVIEW : EXIT.OK;

  if (json()) { emit(schemamod.stamp('doctor', { ...r, exitCode: code })); return code; }

  const mark = { ok: '\u2713', warn: '!', fail: '\u2717' };
  say(`docgov doctor — ${packageVersion()}`);
  say('\u2500'.repeat(54));
  for (const c of r.checks) {
    say(`  ${mark[c.status]} ${c.id.padEnd(16)} ${c.message}`);
    if (c.fix) say(`    ${' '.repeat(16)} ${c.fix}`);
  }
  say('');
  say(`${r.counts.ok} ok · ${r.counts.warn} to look at · ${r.counts.fail} broken`);
  if (!r.counts.fail && !r.counts.warn) say('DocGov is working here.');
  return code;
}
