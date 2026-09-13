/**
 * The Claude Code hook protocol: JSON in on stdin, JSON out on stdout, and an exit code.
 *
 * Every handler here fails open. A governance hook that throws is a governance hook that
 * stops the user working, and a tool which does that is a tool which gets uninstalled — so
 * `cmdHook` catches everything, writes the reason to stderr, and exits 0 regardless.
 */
import path from 'node:path';
import fs from 'node:fs';
import * as cfgmod from '../core/config.js';
import * as reg from '../core/registry.js';
import * as graphmod from '../core/graph.js';
import * as checkmod from '../core/check.js';
import * as impactmod from '../core/impact.js';
import * as inv from '../core/inventory.js';
import * as invariantsmod from '../core/invariants.js';
import * as git from '../core/git.js';
import { classify, destinationFor } from '../core/classify.js';
import { typeDef } from '../core/taxonomy.js';
import { EXIT, write, exists, toPosix } from '../core/util.js';
import { say } from './output.js';

/**
 * `docgov hook <event>` reads the Claude Code hook JSON on stdin and writes hook
 * JSON on stdout. This is ring 1 from FEASIBILITY §3.1: pure CLI, no model call,
 * budgeted at well under 100 ms so it can run on every single write.
 */
export function cmdHook(flags) {
  const event = flags._[0] || 'pre-write';
  const input = readStdinJSON();
  const handlers = {
    'pre-tool': hookPreTool,
    'pre-write': hookPreWrite,
    'post-write': hookPostWrite,
    'session-start': hookSessionStart,
    'pre-code-edit': hookPreCodeEdit,
    'stop': hookStop,
  };
  const h = handlers[event];
  if (!h) { process.stderr.write(`docgov hook: unknown event "${event}"\n`); return EXIT.OK; }
  try { return h(input); }
  catch (e) {
    // A governance hook must never break the user's session. Fail open, say why.
    process.stderr.write(`docgov hook ${event}: ${e.message}\n`);
    return EXIT.OK;
  }
}

/**
 * Single PreToolUse entry point. Routes on the target path so one node process
 * serves both the documentation gate and the invariant injection — two hooks on
 * the same matcher would double the per-edit latency for no benefit.
 */
export function hookPreTool(input) {
  const abs = targetPathOf(input);
  if (!abs) return EXIT.OK;
  return /\.mdx?$/.test(abs) ? hookPreWrite(input) : hookPreCodeEdit(input);
}

export function readStdinJSON() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return {}; }
  try { return JSON.parse(raw || '{}'); }
  catch (e) {
    // Fail open — a governance hook must never break a session — but never silently:
    // a malformed payload that produces no output is indistinguishable from "all clear".
    process.stderr.write(`docgov hook: could not parse hook input (${e.message}); doing nothing\n`);
    return {};
  }
}

export function hookOut(event, fields) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...fields } }));
}

export function targetPathOf(input) {
  const ti = input.tool_input || {};
  return ti.file_path || ti.path || ti.notebook_path || null;
}

export function hookPreWrite(input) {
  const abs = targetPathOf(input);
  if (!abs) return EXIT.OK;
  const { root, cfg, initialized } = cfgmod.load(input.cwd || process.cwd());
  if (!initialized) return EXIT.OK;
  const rel = toPosix(path.relative(root, abs));
  if (rel.startsWith('..')) return EXIT.OK;
  if (!/\.mdx?$/.test(rel) && !/\.docgov\//.test(rel)) return EXIT.OK;

  const registry = reg.load(root);
  const isNew = !exists(abs);
  const content = (input.tool_input || {}).content ?? null;
  const reasons = checkmod.preWrite({ cfg, relPath: rel, registry, isNew, content });

  const blocking = reasons.filter((r) => r.blocking);
  if (blocking.length) {
    hookOut('PreToolUse', {
      permissionDecision: 'deny',
      permissionDecisionReason: [
        `DocGov blocked this write to ${rel}:`,
        ...blocking.map((r) => `  ${r.check}: ${r.message}${r.fix ? `\n    → ${r.fix}` : ''}`),
        '',
        'This is a deterministic rule, not a judgement call. Fix the cause or run',
        '`docgov ignore <id> --reason "..."` if the rule is wrong here.',
      ].join('\n'),
    });
    return EXIT.OK;
  }

  const advisory = reasons.filter((r) => !r.blocking);
  const guidance = [];
  if (isNew && /\.mdx?$/.test(rel)) {
    const doc = { path: rel, body: content || '', frontmatter: {} };
    const c = classify(doc);
    if (c.type !== 'unknown') {
      const def = typeDef(c.type);
      const dest = destinationFor(cfg, c.type, rel);
      guidance.push(`DocGov: this looks like a ${def.label} (${c.confidence}% confidence).`);
      if (dest !== rel) guidance.push(`  Canonical location: ${dest}`);
      if (def.sections?.length) guidance.push(`  Required sections: ${def.sections.join(', ')}`);
      if (def.soft) guidance.push(`  Soft limit ${def.soft} lines, hard ${def.hard}.`);
      guidance.push(`  Add frontmatter: docgov: { id, type: ${c.type}, authority: ${def.authority}, visibility: ${def.visibility} }`);
      const existing = Object.entries(registry.documents).filter(([, e]) => e.type === c.type);
      if (existing.length && def.singleton) guidance.push(`  ⚠ a ${def.label} already exists at ${existing[0][1].path} — update it instead of creating a second one`);
    } else {
      guidance.push(`DocGov: could not classify ${rel}. Run \`docgov whatis --path ${rel}\` or declare docgov.type explicitly.`);
    }
  }
  for (const a of advisory) guidance.push(`DocGov (advisory) ${a.check}: ${a.message}${a.fix ? ` — ${a.fix}` : ''}`);

  if (guidance.length) hookOut('PreToolUse', { additionalContext: guidance.join('\n') });
  return EXIT.OK;
}

export function hookPostWrite(input) {
  const abs = targetPathOf(input);
  if (!abs) return EXIT.OK;
  const { root, cfg, initialized } = cfgmod.load(input.cwd || process.cwd());
  if (!initialized || !exists(abs)) return EXIT.OK;
  const rel = toPosix(path.relative(root, abs));
  if (rel.startsWith('..') || !/\.mdx?$/.test(rel)) return EXIT.OK;

  const i = inv.inventory(root, cfg);
  const { registry } = reg.build(i.documents, i.contracts);
  const graph = graphmod.build(i.documents, registry, cfg, i.contracts);
  reg.save(root, registry);
  graphmod.save(root, graph);

  const { findings } = checkmod.run({ root, cfg, docs: i.documents, registry, graph, inv: i, only: [rel] });
  const mine = findings.filter((f) => f.path === rel);
  if (!mine.length) return EXIT.OK;

  const node = [...graph.nodes.values()].find((n) => n.path === rel);
  const dependents = node ? graph.in(node.id, 'depended_on_by').concat(graph.in(node.id, 'depends_on')) : [];

  const lines = [`DocGov checked ${rel}:`];
  for (const f of mine.slice(0, 8)) lines.push(`  ${f.severity} ${f.check}: ${f.message}${f.fix ? ` (${f.fix})` : ''}`);
  if (dependents.length) {
    lines.push(`  ${dependents.length} document(s) declare a dependency on this one — check they still agree:`);
    for (const d of dependents.slice(0, 4)) lines.push(`    ${graph.nodes.get(d.from)?.path || d.from}`);
  }
  hookOut('PostToolUse', { additionalContext: lines.join('\n') });
  return EXIT.OK;
}

export function hookSessionStart(input) {
  // The plugin's `session_briefing` option. Claude Code passes userConfig to command hooks
  // as CLAUDE_PLUGIN_OPTION_<key>; there is no declarative way to gate a hook, so the gate
  // lives here. Without this the option was advertised in plugin.json and honoured nowhere.
  const briefing = process.env.CLAUDE_PLUGIN_OPTION_session_briefing
    ?? process.env.CLAUDE_PLUGIN_OPTION_SESSION_BRIEFING;
  if (briefing === 'false') return EXIT.OK;
  const { root, cfg, initialized } = cfgmod.load(input.cwd || process.cwd());
  if (!initialized) return EXIT.OK;
  const registry = reg.load(root);
  const ids = Object.entries(registry.documents);
  const canonical = ids.filter(([, e]) => e.authority === 'canonical' || e.authority === 'constitution');

  const L = [];
  L.push(`DocGov is active in this repository (mode: ${cfg.project.mode}, layout: ${cfg.project.layout}).`);
  L.push(`${ids.length} governed document(s). Before creating documentation, run \`docgov whatis --path <file>\`;`);
  L.push('before editing code in a governed domain, run `docgov brief <domain>`.');
  if (canonical.length) {
    L.push('');
    L.push('Authoritative documents (nothing may contradict these):');
    for (const [id, e] of canonical.slice(0, 12)) L.push(`  ${id.padEnd(28)} ${e.path}`);
  }
  const domains = Object.keys(cfg.domains || {});
  if (domains.length) L.push(`\nGoverned domains: ${domains.join(', ')}`);
  L.push('');
  L.push('Rules: .claude/rules/documentation.md');
  hookOut('SessionStart', { additionalContext: L.join('\n') });
  return EXIT.OK;
}

/**
 * The cheapest high-value hook in the product: before an agent edits governed
 * code, hand it the invariants that constrain that code (PRD §24).
 */
export function hookPreCodeEdit(input) {
  const abs = targetPathOf(input);
  if (!abs) return EXIT.OK;
  const { root, cfg, initialized } = cfgmod.load(input.cwd || process.cwd());
  if (!initialized) return EXIT.OK;
  const rel = toPosix(path.relative(root, abs));
  if (rel.startsWith('..') || /\.mdx?$/.test(rel)) return EXIT.OK;

  const i = inv.inventory(root, cfg);
  const set = invariantsmod.collect(i.documents, cfg);
  const applicable = invariantsmod.applicable(set, [rel], cfg);

  const { registry } = reg.build(i.documents, i.contracts);
  const graph = graphmod.build(i.documents, registry, cfg, i.contracts);
  const docsClaiming = graphmod.codeNodesFor(graph, rel)
    .flatMap((n) => graph.in(n.id, 'documents').map((e) => graph.nodes.get(e.from)))
    .filter(Boolean);

  if (!applicable.length && !docsClaiming.length) return EXIT.OK;
  const L = [];
  if (applicable.length) L.push(invariantsmod.render(applicable));
  if (docsClaiming.length) {
    L.push('');
    L.push('Documents that describe this code and may need updating in the same change:');
    for (const d of docsClaiming) L.push(`  ${d.path}  [${d.authority}]`);
  }
  hookOut('PreToolUse', { additionalContext: L.join('\n') });
  return EXIT.OK;
}

export function hookStop(input) {
  const { root, cfg, initialized } = cfgmod.load(input.cwd || process.cwd());
  if (!initialized || !git.isRepo(root)) return EXIT.OK;
  const i = inv.inventory(root, cfg);
  const { registry } = reg.build(i.documents, i.contracts);
  const graph = graphmod.build(i.documents, registry, cfg, i.contracts);
  const impact = impactmod.analyze({ root, cfg, docs: i.documents, graph, base: 'HEAD' });
  const m = impactmod.checklist(impact);
  if (!m.docs.outstanding.length) return EXIT.OK;
  hookOut('Stop', {
    additionalContext: [
      'DocGov: this change has outstanding documentation obligations.',
      ...m.docs.outstanding.map((id) => `  ${id} — ${registry.documents[id]?.path || '(unregistered)'}`),
      'Either update them, or say explicitly why they do not need updating.',
      'Full picture: docgov affected',
    ].join('\n'),
  });
  return EXIT.OK;
}
