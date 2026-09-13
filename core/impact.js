import { changedFiles, isRepo } from './git.js';
import { codeNodesFor } from './graph.js';
import { AUTHORITY } from './taxonomy.js';
import { matchAny } from './util.js';

/**
 * Change impact analysis (PRD §25) and the documentation change manifest (PRD §27).
 *
 * Impact is a graph reachability question, so it is fully deterministic. The
 * manifest turns the answer into a checklist an agent can work through and a
 * CI job can verify.
 */

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|cs|php|ex|exs|scala|c|cc|cpp|h|hpp|sql)$/;
const TEST_RE = /(^|\/)(test|tests|spec|__tests__)\/|\.(test|spec)\./;
const CONTRACT_RE = /\.(proto|graphql|gql)$|openapi.*\.(ya?ml|json)$|schema\.prisma$/;
const MD_RE = /\.mdx?$/;

/**
 * @param {{root:string,cfg:object,docs:any[],graph:any,base?:string,paths?:string[]}} ctx
 */
export function analyze({ root, cfg, docs, graph, base = 'HEAD', paths = null }) {
  const changed = paths
    ? paths.map((p) => ({ path: p, status: 'M' }))
    : (isRepo(root) ? changedFiles(root, base) : []);
  const changedPaths = changed.map((c) => c.path);
  const changedDocs = new Set(changedPaths.filter((p) => MD_RE.test(p)));

  const domains = new Set();
  for (const [domain, spec] of Object.entries(cfg.domains || {})) {
    if (changedPaths.some((p) => matchAny(p, spec.paths || []))) domains.add(domain);
  }

  // Seed: documents directly mapped to changed code, plus changed documents themselves.
  const seeds = new Set();
  const reasons = new Map();
  const note = (id, why) => { if (!reasons.has(id)) reasons.set(id, []); reasons.get(id).push(why); };

  for (const c of changed) {
    if (CODE_RE.test(c.path) || CONTRACT_RE.test(c.path)) {
      for (const node of codeNodesFor(graph, c.path)) {
        for (const e of graph.in(node.id, 'documents')) { seeds.add(e.from); note(e.from, `maps ${c.path}`); }
        if (node.domain) domains.add(node.domain);
      }
      const contractNode = [...graph.nodes.values()].find((n) => n.path === c.path);
      if (contractNode) {
        for (const e of graph.in(contractNode.id)) { seeds.add(e.from); note(e.from, `${e.rel} ${c.path}`); }
      }
    }
    if (MD_RE.test(c.path)) {
      const n = [...graph.nodes.values()].find((x) => x.path === c.path);
      if (n) { seeds.add(n.id); note(n.id, 'changed in this diff'); if (n.domain) domains.add(n.domain); }
    }
  }
  for (const d of docs) {
    if (d.domain && domains.has(d.domain) && !seeds.has(d.id)) { seeds.add(d.id); note(d.id, `domain ${d.domain} affected`); }
  }

  // Propagate along dependency edges: whatever depends on a seed is also impacted.
  const reached = graph.reach([...seeds], { direction: 'in', rels: ['depends_on', 'derived_from', 'implements', 'references'], maxDepth: 3 });
  for (const [id, info] of reached) note(id, `${info.via} a document that changed (depth ${info.depth})`);

  const affected = [];
  for (const id of new Set([...seeds, ...reached.keys()])) {
    const n = graph.nodes.get(id);
    if (!n || n.kind !== 'document') continue;
    const rank = AUTHORITY[n.authority]?.rank ?? 9;
    const direct = seeds.has(id);
    affected.push({
      id, path: n.path, type: n.type, authority: n.authority, domain: n.domain,
      updated: changedDocs.has(n.path),
      required: direct && rank <= 3,
      reasons: reasons.get(id) || [],
    });
  }
  affected.sort((a, b) => Number(b.required) - Number(a.required) || a.path.localeCompare(b.path));

  const behaviorChanged = changedPaths.some((p) => CODE_RE.test(p) && !TEST_RE.test(p));
  const apiChanged = changedPaths.some((p) => CONTRACT_RE.test(p)) ||
    changedPaths.some((p) => /(^|\/)(api|routes?|controllers?|handlers?|endpoints?)\//.test(p));
  const securityChanged = changedPaths.some((p) => /(^|\/)(auth|authz|authentication|authorization|security|crypto|session|permissions?)\//i.test(p));
  const testsChanged = changedPaths.some((p) => TEST_RE.test(p));
  const userVisible = apiChanged || changedPaths.some((p) => /(^|\/)(ui|components?|pages?|views?|cli)\//.test(p));

  return {
    changed, domains: [...domains].sort(), affected,
    signals: { behaviorChanged, apiChanged, securityChanged, testsChanged, userVisible },
    level: level(affected, { behaviorChanged, apiChanged, securityChanged }),
  };
}

function level(affected, s) {
  const req = affected.filter((a) => a.required).length;
  if (s.securityChanged || req >= 4) return 'HIGH';
  if (s.apiChanged || req >= 2) return 'MEDIUM';
  if (req >= 1 || s.behaviorChanged) return 'LOW';
  return 'NONE';
}

/** PRD §27 manifest: a deterministic checklist, written to .docgov/manifest.yaml. */
export function manifest(impact) {
  const required = impact.affected.filter((a) => a.required);
  return {
    change: {
      domain: impact.domains,
      behavior_changed: impact.signals.behaviorChanged,
      api_changed: impact.signals.apiChanged,
      security_changed: impact.signals.securityChanged,
      user_visible: impact.signals.userVisible,
      tests_changed: impact.signals.testsChanged,
      impact_level: impact.level,
    },
    docs: {
      required: required.map((a) => a.id),
      reviewed: required.filter((a) => a.updated).map((a) => a.id),
      outstanding: required.filter((a) => !a.updated).map((a) => a.id),
      optional: impact.affected.filter((a) => !a.required).map((a) => a.id),
    },
  };
}

/** The PR comment body (PRD §26). Deterministic; blocking is the caller's choice. */
export function prReport(impact, drift, cfg) {
  const m = manifest(impact);
  const L = [];
  L.push('DocGov Documentation Review');
  L.push('───────────────────────────');
  L.push(`Code impact: ${impact.level}`);
  L.push(`Documentation impact: ${m.docs.required.length ? (m.docs.outstanding.length ? 'OUTSTANDING' : 'COVERED') : 'NONE'}`);
  L.push('');
  const tick = (ok, text) => L.push(`${ok ? '✓' : '✗'} ${text}`);
  if (impact.signals.apiChanged) tick(impact.changed.some((c) => /openapi|\.proto$|\.graphql$/.test(c.path)), 'API contract updated');
  if (impact.signals.behaviorChanged) tick(impact.signals.testsChanged, 'tests updated');
  for (const a of impact.affected.filter((x) => x.required)) tick(a.updated, `${a.path} (${a.authority})`);
  if (impact.signals.securityChanged) L.push('⚠ security-sensitive paths changed — security documentation review recommended');
  for (const a of impact.affected.filter((x) => !x.required && !x.updated).slice(0, 5)) L.push(`· optional: ${a.path}`);
  if (drift?.findings?.length) {
    L.push('');
    L.push(`Drift: ${drift.findings.filter((f) => f.severity === 'critical').length} critical, ` +
      `${drift.findings.filter((f) => f.severity === 'high').length} high, ` +
      `${drift.findings.filter((f) => f.severity === 'medium').length} medium`);
    for (const f of drift.findings.slice(0, 5)) L.push(`  ${f.severity.toUpperCase().padEnd(8)} ${f.id} ${f.document} — ${f.why}`);
  }
  L.push('');
  const blocked = m.docs.outstanding.length > 0 && !cfg.governance.warn_only;
  L.push(`Documentation readiness: ${blocked ? 'REVIEW REQUIRED' : 'OK'}`);
  if (blocked) L.push(`Outstanding: ${m.docs.outstanding.join(', ')}`);
  return { text: L.join('\n'), manifest: m, blocked };
}
