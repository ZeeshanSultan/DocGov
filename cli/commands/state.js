/**
 * The derived state — the id table, the graph, the rules documents declare, and the tools
 * DocGov found rather than reimplemented. All of it is rebuildable from the repository,
 * which is why none of it is ever hand-edited.
 */
import path from 'node:path';
import * as cfgmod from '../../core/config.js';
import * as reg from '../../core/registry.js';
import * as graphmod from '../../core/graph.js';
import * as inv from '../../core/inventory.js';
import * as invariantsmod from '../../core/invariants.js';
import * as schemamod from '../../core/schema.js';
import { AUTHORITY } from '../../core/taxonomy.js';
import { EXIT, table, write } from '../../core/util.js';
import { emit, json, say } from '../output.js';
import { list } from '../parse.js';
import { ctx } from '../context.js';

export function cmdRegistry(flags) {
  const c = ctx();
  if (flags.rebuild === true) {
    reg.save(c.root, c.registry);
    graphmod.save(c.root, c.graph);
    if (json()) return emit({ rebuilt: true, documents: Object.keys(c.registry.documents).length, collisions: c.collisions }) ?? EXIT.OK;
    say(`Registry rebuilt: ${Object.keys(c.registry.documents).length} document(s).`);
    if (c.collisions.length) {
      say('');
      say('Id collisions (these must be fixed — an id is how agents address a document):');
      for (const col of c.collisions) say(`  ${col.id}: ${col.paths.join(' and ')}`);
      return EXIT.VIOLATION;
    }
    return EXIT.OK;
  }
  if (json()) return emit(c.registry) ?? EXIT.OK;
  say(table(Object.entries(c.registry.documents).map(([id, e]) => ({
    Id: id, Authority: e.authority, Visibility: e.visibility, Path: e.path,
  })), ['Id', 'Authority', 'Visibility', 'Path']));
  return EXIT.OK;
}

export function cmdGraph(flags) {
  const c = ctx();
  if (flags.save === true) graphmod.save(c.root, c.graph);
  const j = c.graph.toJSON();
  if (json()) return emit(j) ?? EXIT.OK;
  if (flags.dot === true) {
    say('digraph docgov {');
    say('  rankdir=TB; node [shape=box, fontname="Helvetica"];');
    for (const n of j.nodes) say(`  "${n.id}" [label="${n.id}\\n${n.authority}"];`);
    for (const e of j.edges) if (!e.inferred) say(`  "${e.from}" -> "${e.to}" [label="${e.rel}"];`);
    say('}');
    return EXIT.OK;
  }
  say(`${j.nodes.length} node(s), ${j.edges.length} edge(s) (${j.edges.filter((e) => e.inferred).length} inferred)`);
  say('');
  const tiers = new Map();
  for (const n of j.nodes) {
    const t = AUTHORITY[n.authority]?.tier ?? 9;
    if (!tiers.has(t)) tiers.set(t, []);
    tiers.get(t).push(n);
  }
  for (const t of [...tiers.keys()].sort()) {
    say(`Tier ${t} — ${AUTHORITY[tiers.get(t)[0].authority]?.label || ''}`);
    for (const n of tiers.get(t)) {
      const outs = c.graph.out(n.id).filter((e) => !e.inferred);
      say(`  ${n.id}  ${outs.length ? `→ ${outs.map((e) => `${e.rel}:${e.to}`).join(', ')}` : ''}`);
    }
    say('');
  }
  const orphans = c.graph.orphans();
  if (orphans.length) say(`${orphans.length} orphan(s): ${orphans.slice(0, 6).map((o) => o.id).join(', ')}`);
  return EXIT.OK;
}

export function cmdRules(flags) {
  const c = ctx();
  const set = invariantsmod.collect(c.docs, c.cfg);
  if (flags.for) {
    const applicable = invariantsmod.applicable(set, list(flags.for), c.cfg);
    if (json()) return emit(schemamod.stamp('rules', applicable)) ?? EXIT.OK;
    const rendered = invariantsmod.render(applicable);
    if (rendered) say(rendered); else say('No rules apply to those paths.');
    return EXIT.OK;
  }
  if (json()) return emit(schemamod.stamp('rules', set)) ?? EXIT.OK;
  if (!set.invariants.length) {
    say('No rules declared.');
    say('');
    say('Declare them in any canonical document as list items beginning with an id:');
    say('  - INV-LIC-001 A license belongs to exactly one organization.');
    say('Then map the code they govern with `documents:` in that document\'s frontmatter,');
    say('and every agent editing that code gets them injected automatically.');
    return EXIT.OK;
  }
  say(table(set.invariants.map((i) => ({
    Id: i.id, Domain: i.domain || '', Statement: i.statement.slice(0, 58), Source: i.source,
  })), ['Id', 'Domain', 'Statement', 'Source']));
  if (set.duplicates.length) {
    say('');
    say('Duplicate rule ids:');
    for (const d of set.duplicates) say(`  ${d.id}: ${d.sources.join(' and ')}`);
    return EXIT.VIOLATION;
  }
  return EXIT.OK;
}

export function cmdTools(flags) {
  const { root } = cfgmod.load(process.cwd());
  const plugins = list(flags.plugins);
  const caps = inv.capabilities(root, plugins);
  const outPath = path.join(root, '.docgov', 'tools.json');
  write(outPath, JSON.stringify(schemamod.stamp('tools', { generated: new Date().toISOString(), capabilities: caps }), null, 2) + '\n');
  if (json()) return emit({ capabilities: caps, written: '.docgov/tools.json' }) ?? EXIT.OK;
  say('Capability registry');
  say('');
  for (const [cap, providers] of Object.entries(caps).sort()) say(`  ${cap.padEnd(24)} ${providers.join(', ')}`);
  say('');
  say('DocGov delegates to these instead of reimplementing them. Absent capability = DocGov does it itself.');
  return EXIT.OK;
}
