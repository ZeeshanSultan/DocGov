import path from 'node:path';
import { blocks, limitFor, locationFor } from './config.js';
import { TYPES, AUTHORITY, VISIBILITY, STATUS, typeDef } from './taxonomy.js';
import { matchAny, matchGlob, EXIT } from './util.js';
import { classify, destinationFor } from './classify.js';
import { brokenLinks, brokenAnchors } from './links.js';
import { assess, readmeOverreach, missingIndexes } from './size.js';
import { danglingReferences } from './registry.js';
import { similarPairs } from './similarity.js';
import { parse as fmParse } from './frontmatter.js';

/**
 * The deterministic rule engine (PRD §21).
 *
 * Every rule here is decidable by software. Nothing in this file asks a model a
 * question, which is exactly why it is allowed to fail CI. Subjective findings
 * live in the agent layer and are advisory by construction.
 */

/** rule id -> {severity, deterministic, blurb} */
export const RULES = {
  'invalid-yaml':        { severity: 'critical', blurb: 'frontmatter is not parseable' },
  'missing-frontmatter': { severity: 'high',     blurb: 'no docgov frontmatter block' },
  'missing-id':          { severity: 'high',     blurb: 'docgov.id is absent' },
  'invalid-id':          { severity: 'high',     blurb: 'docgov.id does not match the pattern for its type' },
  'duplicate-id':        { severity: 'critical', blurb: 'two documents claim the same docgov.id' },
  'unknown-type':        { severity: 'high',     blurb: 'docgov.type is not a known document class' },
  'unknown-reference':   { severity: 'high',     blurb: 'a relationship points at an id that does not exist' },
  'invalid-relationship':{ severity: 'medium',   blurb: 'relationship name is not in the taxonomy' },
  'broken-link':         { severity: 'high',     blurb: 'internal link target does not exist' },
  'broken-anchor':       { severity: 'low',      blurb: 'in-page anchor has no matching heading' },
  'wrong-location':      { severity: 'medium',   blurb: 'document is not in the canonical location for its type' },
  'visibility-path':     { severity: 'critical', blurb: 'document visibility is forbidden in this path' },
  'missing-visibility':  { severity: 'medium',   blurb: 'visibility is not declared' },
  'invalid-visibility':  { severity: 'high',     blurb: 'visibility is not a known value' },
  'invalid-status':      { severity: 'medium',   blurb: 'status is not a known value' },
  'missing-sections':    { severity: 'medium',   blurb: 'required template sections are absent' },
  'soft-limit':          { severity: 'low',      blurb: 'document exceeds its soft line limit' },
  'hard-limit':          { severity: 'medium',   blurb: 'document exceeds its hard line limit' },
  'generated-edit':      { severity: 'critical', blurb: 'a generated document was edited by hand' },
  'frozen-edit':         { severity: 'high',     blurb: 'an archived document was edited' },
  'missing-owner':       { severity: 'medium',   blurb: 'owner is required in this project mode' },
  'authority-violation': { severity: 'critical', blurb: 'a lower-authority document claims authority over a higher one' },
  'orphan':              { severity: 'low',      blurb: 'no inbound or outbound relationships' },
  'unclassified':        { severity: 'medium',   blurb: 'document type could not be determined' },
  'readme-overreach':    { severity: 'low',      blurb: 'a README section has grown into its own document' },
  'missing-index':       { severity: 'low',      blurb: 'directory has several documents and no index' },
  'duplicate-candidate': { severity: 'low',      blurb: 'two documents are textually very similar' },
  'new-root-document':   { severity: 'medium',   blurb: 'a new top-level Markdown file was added outside the taxonomy' },
  'expired-suppression': { severity: 'medium',   blurb: 'a suppression has expired and is no longer in effect' },
};

for (const r of Object.values(RULES)) r.deterministic = true;

/**
 * @param {{root:string, cfg:object, docs:any[], registry:object, graph:any,
 *          inv:object, only?:string[]}} ctx
 * @returns {{findings:object[], stats:object}}
 */
export function run({ root, cfg, docs, registry, graph, inv, only = null }) {
  const findings = [];
  const allFiles = new Set(inv.all);
  const scope = only ? docs.filter((d) => only.includes(d.path)) : docs;
  const add = (rule, doc, message, extra = {}) => {
    const meta = RULES[rule] || { severity: 'medium', blurb: rule };
    findings.push({
      rule, severity: extra.severity || meta.severity, path: doc?.path ?? extra.path ?? '(repository)',
      id: doc?.id ?? extra.id ?? null, message, deterministic: true,
      blocking: blocks(cfg, rule), fix: extra.fix || null, ...extra,
    });
  };

  // ---- per-document rules
  for (const d of scope) {
    if (d.error) { add('invalid-yaml', d, d.error); continue; }

    const inArchive = matchAny(d.path, ['docs/99-archive/**', 'docs/archive/**']);
    const generated = d.isGenerated || matchAny(d.path, cfg.generated_paths || []);

    if ((!d.hasFrontmatter || !d.frontmatter.docgov) && !d.externallyRegistered) {
      add('missing-frontmatter', d, 'no `docgov:` frontmatter block',
        { fix: `docgov organize --apply --path ${d.path}`
          + ` — or, for a file GitHub renders, register it under documentation.registrations` });
    } else {
      if (!d.meta.id) add('missing-id', d, 'docgov.id is required');
      if (d.meta.type && !TYPES[d.meta.type]) add('unknown-type', d, `unknown type "${d.meta.type}"`);
      if (d.meta.visibility && !VISIBILITY.includes(d.meta.visibility))
        add('invalid-visibility', d, `visibility "${d.meta.visibility}" is not one of ${VISIBILITY.join(', ')}`);
      if (!d.meta.visibility) add('missing-visibility', d, `visibility not declared (defaulting to ${d.visibility})`);
      if (d.meta.status && !STATUS.includes(d.meta.status))
        add('invalid-status', d, `status "${d.meta.status}" is not one of ${STATUS.join(', ')}`);
      const idPattern = typeDef(d.type).idPattern;
      if (idPattern && d.meta.id && !new RegExp(idPattern).test(d.meta.id))
        add('invalid-id', d, `id "${d.meta.id}" must match ${idPattern}`);
      for (const rel of Object.keys(d.relationships)) {
        if (!['depends_on', 'defines', 'implements', 'derived_from', 'supersedes', 'references',
          'validated_by', 'generated_from', 'exposes', 'documents'].includes(rel))
          add('invalid-relationship', d, `"${rel}" is not a relationship in the taxonomy`);
      }
      if (cfg.profile?.require_owner && !d.owner && !inArchive)
        add('missing-owner', d, `project mode "${cfg.project.mode}" requires docgov.owner`);
    }

    if (d.type === 'unknown') {
      const c = classify(d);
      add('unclassified', d, c.type === 'unknown'
        ? 'no classification signal matched'
        : `type not declared; best guess is ${c.type} (${c.confidence}% confidence)`,
        { suggestion: c.type === 'unknown' ? null : c.type, candidates: c.candidates });
    }

    // Location
    const allowedAtRoot = !d.path.includes('/') && (cfg.governance.allowed_root_docs || []).includes(d.path);
    if (d.type !== 'unknown' && !inArchive && !typeDef(d.type).anywhere && !allowedAtRoot) {
      const want = locationFor(cfg, d.type);
      const ok = want.endsWith('/') ? d.path.startsWith(want) : d.path === want;
      if (!ok) add('wrong-location', d, `a ${typeDef(d.type).label} belongs in ${want}`,
        { fix: `docgov organize --apply`, destination: destinationFor(cfg, d.type, d.path) });
    }

    // Visibility paths (PRD §10)
    for (const vp of cfg.visibility_paths || []) {
      if (!matchGlob(d.path, vp.glob)) continue;
      if (!vp.require.includes(d.visibility))
        add('visibility-path', d, `${vp.glob} may only hold ${vp.require.join(' or ')} documents; this one is ${d.visibility}`);
    }

    // Required sections
    if (!generated && !inArchive) {
      const missing = d.missingSections();
      if (missing.length) add('missing-sections', d, `missing: ${missing.join(', ')}`,
        { missing, required: typeDef(d.type).sections });
    }

    // Size
    const size = assess(cfg, d);
    if (size.level === 'hard') add('hard-limit', d, `${d.lines} lines exceeds the hard limit of ${size.hard}`, { size });
    else if (size.level === 'soft') add('soft-limit', d, `${d.lines} lines exceeds the soft limit of ${size.soft}`, { size });

    for (const r of readmeOverreach(cfg, d)) {
      add('readme-overreach', d, `section "${r.section}" is ${r.lines} lines`,
        { fix: r.moveTo ? `docgov create ${r.moveTo}` : null, detail: r });
    }

    if (inArchive && !only) { /* archived documents are frozen; edits are caught at write time */ }
  }

  // ---- repository-wide rules
  const seenIds = new Map();
  for (const d of docs) {
    if (!d.meta.id) continue;
    if (seenIds.has(d.meta.id)) {
      add('duplicate-id', d, `id "${d.meta.id}" is also used by ${seenIds.get(d.meta.id)}`,
        { other: seenIds.get(d.meta.id) });
    } else seenIds.set(d.meta.id, d.path);
  }

  for (const r of danglingReferences(registry)) {
    add('unknown-reference', null, `${r.relationship}: "${r.target}" is not a registered document`,
      { path: r.path, id: r.id, fix: `docgov registry --rebuild` });
  }

  for (const b of brokenLinks(docs, root, allFiles)) {
    add('broken-link', null, `link to "${b.target}" resolves to ${b.resolved}, which does not exist`, { path: b.path });
  }
  for (const a of brokenAnchors(docs)) {
    add('broken-anchor', null, `anchor ${a.anchor} has no matching heading`, { path: a.path });
  }

  for (const v of graph.authorityViolations()) {
    add('authority-violation', null,
      `${v.fromAuthority} document ${v.rel} a ${v.toAuthority} document`, { path: v.from, other: v.to });
  }

  for (const o of graph.orphans()) {
    if (matchAny(o.path, ['docs/99-archive/**', 'docs/archive/**', 'docs/10-internal/**', 'docs/internal/**'])) continue;
    add('orphan', null, 'no relationships declared and nothing links to it', { path: o.path, id: o.id });
  }

  for (const m of missingIndexes(docs)) {
    add('missing-index', null, `${m.documents} documents and no index`,
      { path: m.dir, fix: `docgov create ${m.type} "Overview" --path ${m.suggest}` });
  }

  for (const p of similarPairs(docs, { threshold: 0.55, limit: 15 })) {
    add('duplicate-candidate', null, `${Math.round(p.score * 100)}% textual overlap with ${p.b}${p.reasons.length ? ` (${p.reasons.join(', ')})` : ''}`,
      { path: p.a, other: p.b, score: p.score });
  }

  // New top-level Markdown beyond the allowed singletons
  const allowedRoot = new Set(Object.values(TYPES).filter((t) => t.singleton).map((t) => t.compact || t.full)
    .concat(cfg.governance.allowed_root_docs || []));
  const rootDocs = docs.filter((d) => !d.path.includes('/') && !allowedRoot.has(d.path));
  if (rootDocs.length > (cfg.governance.max_new_root_docs ?? 0)) {
    for (const d of rootDocs) {
      add('new-root-document', d, 'top-level Markdown outside the taxonomy',
        { fix: `docgov organize --apply --path ${d.path}` });
    }
  }

  const stats = summarize(findings);
  return { findings: sortFindings(findings), stats };
}

export function sortFindings(findings) {
  const S = ['critical', 'high', 'medium', 'low'];
  return findings.slice().sort((a, b) =>
    Number(b.blocking) - Number(a.blocking) ||
    S.indexOf(a.severity) - S.indexOf(b.severity) ||
    String(a.path).localeCompare(String(b.path)) ||
    a.rule.localeCompare(b.rule));
}

export function summarize(findings) {
  const s = { total: findings.length, blocking: 0, critical: 0, high: 0, medium: 0, low: 0, byRule: {} };
  for (const f of findings) {
    s[f.severity] = (s[f.severity] || 0) + 1;
    if (f.blocking) s.blocking++;
    s.byRule[f.rule] = (s.byRule[f.rule] || 0) + 1;
  }
  return s;
}

/**
 * Exit code contract (PRD §39), with the resolution FEASIBILITY §3.6 demands:
 * only deterministic violations produce 1. Drift and advisory findings produce 2,
 * which CI may choose to treat as soft.
 */
export function exitCode({ findings, driftFindings = [], cfg }) {
  if (findings.some((f) => f.blocking)) return EXIT.VIOLATION;
  const sev = (cfg.drift?.fail_on || ['critical', 'high']);
  if (driftFindings.some((f) => sev.includes(f.severity))) return EXIT.REVIEW;
  return EXIT.OK;
}

/** Pre-write decision for the PreToolUse hook: ring 1 (FEASIBILITY §3.1). */
export function preWrite({ cfg, relPath, registry, isNew, content }) {
  const reasons = [];
  const deny = (rule, msg, fix) => reasons.push({ rule, message: msg, fix, blocking: blocks(cfg, rule) });

  if (matchAny(relPath, cfg.generated_paths || []) && !cfg.generated.allow_manual_edit) {
    deny('generated-edit', `${relPath} sits in a generated tree; edit the source and regenerate instead`,
      'change the generator input, then run the generator');
  }
  if (matchAny(relPath, ['docs/99-archive/**', 'docs/archive/**'])) {
    deny('frozen-edit', `${relPath} is archived, and the archive is a historical record`,
      'create a new document rather than editing the archive');
  }

  const entry = Object.entries(registry.documents || {}).find(([, e]) => e.path === relPath);
  if (entry && entry[1].generated && !cfg.generated.allow_manual_edit) {
    deny('generated-edit', `${relPath} is registered with generation.mode: generated`,
      'regenerate it rather than editing it');
  }

  if (content != null && /\.mdx?$/.test(relPath)) {
    let meta = null;
    try {
      meta = fmParse(content).data.docgov || null;
    } catch (e) {
      deny('invalid-yaml', `frontmatter in ${relPath} would not parse: ${e.message}`,
        'fix the YAML, or omit the frontmatter block entirely');
    }
    if (meta?.id) {
      const clash = Object.entries(registry.documents || {})
        .find(([id, e]) => id === meta.id && e.path !== relPath);
      if (clash) deny('duplicate-id', `docgov.id "${meta.id}" already belongs to ${clash[1].path}`,
        `update ${clash[1].path} instead, or choose a different id`);
    }
    if (meta?.type && !TYPES[meta.type]) {
      deny('unknown-type', `docgov.type "${meta.type}" is not a known document class`,
        'run `docgov types` to list the document classes');
    }
    if (meta?.visibility && !VISIBILITY.includes(meta.visibility)) {
      deny('invalid-visibility', `visibility "${meta.visibility}" is not one of ${VISIBILITY.join(', ')}`, null);
    }
    if (meta?.type) {
      for (const vp of cfg.visibility_paths || []) {
        if (!matchGlob(relPath, vp.glob)) continue;
        const vis = meta.visibility || typeDef(meta.type).visibility || 'internal';
        if (!vp.require.includes(vis)) {
          deny('visibility-path', `${vp.glob} may only hold ${vp.require.join(' or ')} documents; this one is ${vis}`,
            'move the document, or change its visibility');
        }
      }
    }
  }

  if (isNew) {
    const topLevel = !relPath.includes('/') && /\.mdx?$/.test(relPath);
    const allowed = new Set(cfg.governance.allowed_root_docs || []);
    if (topLevel && !allowed.has(relPath)) {
      deny('new-root-document', `${relPath} would be a new top-level Markdown file`,
        'run `docgov classify --path ' + relPath + '` to find where it belongs in the documentation tree');
    }
  }
  return reasons;
}
