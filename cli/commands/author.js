/**
 * Writing and finding documents: what a document is, where a new one belongs, what already
 * covers a topic, and what an agent must read before it touches an area.
 */
import path from 'node:path';
import * as cfgmod from '../../core/config.js';
import * as reg from '../../core/registry.js';
import * as graphmod from '../../core/graph.js';
import * as driftmod from '../../core/drift.js';
import * as tpl from '../../core/templates.js';
import * as ctxpack from '../../core/context.js';
import * as findmod from '../../core/find.js';
import * as git from '../../core/git.js';
import * as schemamod from '../../core/schema.js';
import * as respmod from '../../core/responsibility.js';
import { Document } from '../../core/document.js';
import { classify, destinationFor } from '../../core/classify.js';
import { AUTHORITY, TYPES, typeDef } from '../../core/taxonomy.js';
import { EXIT, DocGovError, table, write, read, exists } from '../../core/util.js';
import { emit, json, say, warn } from '../output.js';
import { list } from '../parse.js';
import { ctx } from '../context.js';
import { usage } from '../usage.js';

export function cmdWhatis(flags) {
  const c = ctx({ requireInit: false });
  const targets = flags.path ? [String(flags.path)] : (flags._.length ? flags._ : c.docs.map((d) => d.path));
  const rows = [];
  for (const p of targets) {
    const doc = c.docs.find((d) => d.path === p) ||
      (exists(path.join(c.root, p)) ? new Document(c.root, p) : { path: p, body: '', frontmatter: {} });
    const res = classify(doc);
    rows.push({
      path: p, type: res.type, confidence: res.confidence, declared: res.declared,
      needsReview: res.needsReview, signals: res.signals, candidates: res.candidates,
      destination: res.type === 'unknown' ? null : destinationFor(c.cfg, res.type, p),
      authority: res.type === 'unknown' ? null : typeDef(res.type).authority,
      requiredSections: res.type === 'unknown' ? [] : typeDef(res.type).sections,
    });
  }
  if (json()) return emit(rows.length === 1 ? rows[0] : rows) ?? EXIT.OK;
  for (const r of rows) {
    say(`${r.path}`);
    say(`  type        ${r.type}  ${r.declared ? '(declared)' : `(${r.confidence}% confidence${r.needsReview ? ', needs review' : ''})`}`);
    if (r.authority) say(`  authority   ${r.authority}`);
    if (r.destination && r.destination !== r.path) say(`  belongs at  ${r.destination}`);
    if (r.signals.length) say(`  because     ${r.signals.join('; ')}`);
    if (r.needsReview && r.candidates.length > 1) say(`  also        ${r.candidates.slice(1).map((x) => `${x.type} (${x.score})`).join(', ')}`);
    say('');
  }
  return EXIT.OK;
}

export function cmdCreate(flags) {
  const c = ctx();
  const type = flags._[0] || flags.type;
  if (!type) throw new DocGovError('usage: docgov create <type> [name] [--domain d] [--path p]\nRun `docgov types` to list document classes.');
  if (!TYPES[type]) {
    const near = Object.keys(TYPES).filter((t) => t.includes(String(type).split('.').pop())).slice(0, 5);
    throw new DocGovError(`unknown type "${type}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ''} Run \`docgov types\`.`);
  }
  const name = flags._[1] || flags.name || typeDef(type).label;
  const domain = flags.domain ? String(flags.domain) : null;
  const def = typeDef(type);

  let target = flags.path ? String(flags.path) : null;
  if (!target) {
    const loc = cfgmod.locationFor(c.cfg, type);
    target = loc.endsWith('/')
      ? loc + `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.md`
      : loc;
  }
  // Before writing anything, ask who already owns this responsibility. The path being free
  // says nothing: a fourth setup guide beside docs/getting-started.md is well-formed,
  // correctly typed, in the right directory, and a second source of truth.
  //
  // An occupied destination short-circuits the search — there is no better answer to "who
  // owns this" than the document already sitting where this one would go. It is answered
  // here rather than thrown below so that `--check` reports it like any other owner instead
  // of failing, which is the difference between an agent reading the answer and an agent
  // seeing an error it will work around.
  const occupied = exists(path.join(c.root, target));
  const owned = occupied
    ? (() => {
      const at = c.docs.find((d) => d.path === target) || { id: target, path: target, title: target };
      return { decision: 'update-existing', owner: at, candidates: [at],
        why: `${target} already exists` };
    })()
    : respmod.whoOwns({ docs: c.docs, type, name, domain });
  const owners = owned.candidates.map((d) => ({ id: d.id, path: d.path, title: d.title, type: d.type }));

  // `--check` answers the question without writing, so an agent can ask before it decides.
  if (flags.check) {
    // Exit code carries the answer too, so a shell or a hook can branch on it without
    // parsing anything: 0 means go ahead, 2 means read the candidates first.
    const code = owned.decision === 'create-new' ? EXIT.OK : EXIT.REVIEW;
    if (json()) {
      emit({ decision: owned.decision, why: owned.why, type, path: target,
        owner: owned.owner ? { id: owned.owner.id, path: owned.owner.path } : null,
        candidates: owners, requiredSections: def.sections || [], softLimit: def.soft });
      return code;
    }
    say(`${owned.decision}  ${owned.why}`);
    if (owned.decision === 'create-new') say(`  would create ${target}`);
    for (const d of owners) say(`  ${d.path}`);
    return code;
  }

  // Blocking only where software can decide it: a class that holds one document, or an
  // existing document of this class already named for what was asked. Everything softer is
  // reported, because refusing to create a document somebody asked for is worse than a
  // duplicate when the judgement is wrong.
  if (occupied && !flags.force)
    throw new DocGovError(`${target} already exists. Edit it, or pass --force.`);
  if (owned.decision === 'update-existing' && !flags.force) {
    throw new DocGovError([
      `${owned.why}.`,
      ...owners.filter((d) => d.path !== owned.owner?.path).map((d) => `  see also ${d.path}`),
      '',
      'Update it rather than adding a second source of truth. If this really is a different',
      'document, pass --force and say in it how it differs.',
    ].join('\n'));
  }
  if (owned.decision === 'review-first') {
    warn(`${owned.why} — check these before writing a second:`);
    for (const d of owners) warn(`  ${d.path}`);
  }

  // Wire the new document into the graph automatically: that is the difference
  // between a template and a governed document.
  const relationships = {};
  const related = findmod.find({ docs: c.docs, query: domain || name, limit: 6 });
  const deps = related.filter((r) => (AUTHORITY[r.authority]?.rank ?? 9) < (AUTHORITY[def.authority]?.rank ?? 9))
    .map((r) => r.id).slice(0, 3);
  if (deps.length) relationships.depends_on = deps;
  if (type === 'architecture.trd') {
    const prd = c.docs.find((d) => d.type === 'product.prd' && (!domain || d.domain === domain));
    if (prd) relationships.implements = [prd.id];
  }
  if (flags.implements) relationships.implements = list(flags.implements);
  if (flags.supersedes) relationships.supersedes = list(flags.supersedes);

  const content = tpl.create({ type, title: String(name), id: flags.id ? String(flags.id) : undefined,
    cfg: c.cfg, domain, relationships, owner: flags.owner ? String(flags.owner) : null,
    visibility: flags.visibility ? String(flags.visibility) : null });
  write(path.join(c.root, target), content);

  const after = ctx();
  reg.save(after.root, reg.build(after.docs, after.inv.contracts).registry);
  graphmod.save(after.root, after.graph);

  if (json()) return emit({ created: target, type, relationships, requiredSections: def.sections,
    softLimit: def.soft, quality: def.quality, related: related.map((r) => ({ id: r.id, path: r.path, authority: r.authority })) }) ?? EXIT.OK;
  say(`Created ${target}`);
  say(`  type        ${type} (${def.authority})`);
  if (Object.keys(relationships).length) {
    for (const [k, v] of Object.entries(relationships)) say(`  ${k.padEnd(11)} ${v.join(', ')}`);
  }
  if (def.sections?.length) say(`  sections    ${def.sections.length} required: ${def.sections.join(', ')}`);
  if (def.soft) say(`  limits      ${def.soft} soft / ${def.hard} hard lines`);
  if (related.length) {
    say('');
    say('Authoritative context you should read before writing this:');
    for (const r of related.slice(0, 4)) say(`  [${r.label}] ${r.path}`);
    say(`  (or run: docgov brief ${domain || name})`);
  }
  return EXIT.OK;
}

export function cmdBrief(flags) {
  const c = ctx();
  const topic = flags._[0] || flags.topic;
  if (!topic) throw new DocGovError('usage: docgov brief <topic>');

  // Staleness of the pack's own contents is a git question, and the engine stays callable
  // without git — so it is answered here, where the repository is, and handed in. Without a
  // repository the pack reports that it does not know, rather than reporting "none".
  let drift = null;
  try {
    drift = driftmod.analyze({ root: c.root, cfg: c.cfg, docs: c.docs, graph: c.graph });
  } catch { drift = null; }

  const compiled = ctxpack.compile({ cfg: c.cfg, docs: c.docs, graph: c.graph, topic: String(topic),
    budget: flags.budget ? parseInt(flags.budget, 10) : undefined,
    include: flags.include ? list(flags.include) : null, drift });
  const text = ctxpack.render(compiled);

  if (json()) {
    return emit(schemamod.stamp('brief', { topic, pack: text, map: compiled.map,
      selected: compiled.selected.map((x) => ({ id: x.doc.id, path: x.doc.path, why: x.why })),
      decisions: compiled.decisions })) ?? EXIT.OK;
  }
  // The pack itself is the only thing on stdout by default: the skill injects stdout verbatim
  // (and merges stderr into it), so anything else printed here is tokens an agent pays for
  // and may read as part of the brief.
  console.log(text);
  if (flags.explain) {
    console.log('');
    console.log('## How this pack was chosen');
    console.log('');
    for (const d of compiled.decisions) console.log(`${d.state.padEnd(8)} ${d.path} — ${d.why}`);
  }
  return EXIT.OK;
}

export function cmdFind(flags) {
  const c = ctx();
  const q = flags._.join(' ') || flags.query;
  if (!q) throw new DocGovError('usage: docgov find "<query>"');
  const results = findmod.find({ docs: c.docs, query: q, limit: flags.limit ? parseInt(flags.limit, 10) : 10 });
  if (json()) return emit(results) ?? EXIT.OK;
  if (!results.length) { say(`No document matches "${q}".`); return EXIT.OK; }
  let i = 0;
  for (const r of results) {
    say(`${++i}. [${r.label}] ${r.title}`);
    say(`   ${r.path}${r.domain ? `  ·  domain: ${r.domain}` : ''}${r.status !== 'active' ? `  ·  ${r.status}` : ''}`);
    say(`   ${r.snippet}`);
    say('');
  }
  say('Ordered by authority first, then relevance: read the top entry before the ones below it.');
  return EXIT.OK;
}

export function cmdTypes(flags) {
  // Load config even though nothing here reads it: loading is what registers the classes a
  // project defined for itself. Without this, `docgov types` was the one command that could
  // not see a custom class — the command whose entire job is to list them.
  try { cfgmod.load(process.cwd()); } catch { /* an unreadable config still lists the shipped classes */ }
  const rows = tpl.listTypes();
  if (json()) return emit(rows) ?? EXIT.OK;
  const filter = flags._[0];
  const shown = filter ? rows.filter((r) => r.type.includes(filter) || r.authority.includes(filter)) : rows;
  say(table(shown.map((r) => ({
    Type: r.type, Label: r.label, Authority: r.authority, Lens: r.lens,
    Soft: r.soft, Hard: r.hard, Sections: r.sections, From: r.source === 'project' ? 'yours' : '',
  })), ['Type', 'Label', 'Authority', 'Lens', 'Soft', 'Hard', 'Sections', 'From']));
  say('');
  const mine = shown.filter((r) => r.source === 'project').length;
  say(`${shown.length} document class(es)${mine ? `, ${mine} defined by this project` : ''}. `
    + 'Create one with: docgov create <type> "<name>"');
  return EXIT.OK;
}
