import { changedFiles, lastCommitDate, commitsSince, isRepo, diffFor } from './git.js';
import { codeNodesFor } from './graph.js';
import { matchAny } from './util.js';
import { AUTHORITY } from './taxonomy.js';
import { parseFrom as parseInvariants } from './invariants.js';

/**
 * Drift engine (PRD §22, §23, §30).
 *
 * Everything here is deterministic: it answers "which documents are now
 * unverified?" from the diff and the graph. It never claims to know that a
 * document's *prose* contradicts the code — that judgement is handed to the
 * drift-reviewer agent, on the narrowed list this module produces
 * (FEASIBILITY §3.4). Keeping that line sharp is the product's credibility.
 */

export const SEVERITY = ['critical', 'high', 'medium', 'low'];

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|cs|php|ex|exs|scala|c|cc|cpp|h|hpp|sql)$/;
const CONTRACT_RE = /\.(proto|graphql|gql)$|openapi.*\.(ya?ml|json)$|schema\.prisma$|(^|\/)schemas?\/.*\.json$/;
const MD_RE = /\.mdx?$/;

/**
 * @param {{root:string, cfg:object, docs:import('./document.js').Document[], graph:import('./graph.js').Graph, base?:string}} ctx
 */
export function analyze({ root, cfg, docs, graph, base = 'HEAD' }) {
  const findings = [];
  if (!isRepo(root)) {
    return { findings, changed: [], usable: false,
      note: 'not a git repository — drift analysis needs git history' };
  }

  const changed = changedFiles(root, base);
  const changedPaths = changed.map((c) => c.path);
  const changedDocs = new Set(changed.filter((c) => MD_RE.test(c.path)).map((c) => c.path));
  const byPath = new Map(docs.map((d) => [d.path, d]));

  // ---- Forward drift: implementation moved, its documentation did not.
  const codeChanges = changed.filter((c) => CODE_RE.test(c.path) && c.status !== 'D');
  const impactedByDoc = new Map();
  for (const c of codeChanges) {
    for (const node of codeNodesFor(graph, c.path)) {
      for (const e of graph.in(node.id, 'documents')) {
        const docNode = graph.nodes.get(e.from);
        if (!docNode) continue;
        if (!impactedByDoc.has(docNode.path)) impactedByDoc.set(docNode.path, { docNode, files: [] });
        impactedByDoc.get(docNode.path).files.push(c.path);
      }
    }
  }
  for (const [docPath, { docNode, files }] of impactedByDoc) {
    if (changedDocs.has(docPath)) continue;                     // moved together: no drift
    const doc = byPath.get(docPath);
    findings.push({
      id: null, kind: 'forward', severity: severityFor(docNode.authority, files.length),
      document: docPath, documentId: docNode.id, documentAuthority: docNode.authority,
      implementation: files.slice(0, 6), implementationCount: files.length,
      // The invariants this document states are the part of it that can be objectively
      // falsified by a code change, so the reviewer agent gets them up front.
      invariants: doc ? parseInvariants(doc).map((i) => `${i.id} ${i.statement}`).slice(0, 5) : [],
      why: `${files.length} file(s) this document claims to describe changed; the document did not`,
      action: `Review ${docPath} against the implementation change, then record the review`,
      reviewable: true,
    });
  }

  // ---- Reverse drift: specification moved, implementation did not.
  for (const c of changed) {
    if (!MD_RE.test(c.path)) continue;
    const doc = byPath.get(c.path);
    if (!doc) continue;
    const rank = AUTHORITY[doc.authority]?.rank ?? 9;
    if (rank > 2) continue;                                      // only intent documents can be ahead of code
    const globs = [].concat(doc.meta.documents || [], cfg.domains?.[doc.domain]?.paths || []).map(String);
    if (!globs.length) continue;
    const codeTouched = changedPaths.some((p) => CODE_RE.test(p) && matchAny(p, globs));
    const testsTouched = changedPaths.some((p) => /(^|\/)(test|tests|spec|__tests__)\//.test(p) || /\.(test|spec)\./.test(p));
    if (codeTouched) continue;
    findings.push({
      id: null, kind: 'reverse', severity: doc.authority === 'constitution' ? 'high' : 'medium',
      document: c.path, documentId: doc.id, documentAuthority: doc.authority,
      implementation: globs, implementationCount: 0,
      why: `specification changed but no implementation change was detected in ${globs.join(', ')}`,
      action: testsTouched
        ? 'Tests changed but implementation did not — confirm the change is complete'
        : 'Implement the specification change, or mark it as planned-only',
      reviewable: true,
    });
  }

  // ---- Contract drift: machine contract moved, derived documentation did not.
  for (const c of changed) {
    if (!CONTRACT_RE.test(c.path) || c.status === 'D') continue;
    const contractNode = [...graph.nodes.values()].find((n) => n.path === c.path);
    const derived = contractNode
      ? graph.in(contractNode.id, 'generated_from').concat(graph.in(contractNode.id, 'derived_from'))
      : [];
    const stale = derived.map((e) => graph.nodes.get(e.from)).filter((n) => n && !changedDocs.has(n.path));
    findings.push({
      id: null, kind: 'contract', severity: stale.length ? 'high' : 'medium',
      document: stale.length ? stale.map((n) => n.path).join(', ') : '(no derived documentation registered)',
      documentId: stale[0]?.id ?? null, documentAuthority: 'generated',
      implementation: [c.path], implementationCount: 1,
      why: stale.length
        ? 'machine contract changed; documentation derived from it did not'
        : 'machine contract changed and nothing is registered as derived from it',
      action: stale.length ? 'Regenerate derived documentation' : `Register a document with generated_from: [${contractIdOf(c.path)}]`,
      reviewable: true,
    });
  }

  // ---- Dependency drift: a document's declared dependency moved ahead of it.
  for (const d of docs) {
    for (const dep of d.relationships.depends_on || []) {
      const depNode = graph.nodes.get(dep);
      if (!depNode || !changedDocs.has(depNode.path) || changedDocs.has(d.path)) continue;
      findings.push({
        id: null, kind: 'dependency', severity: 'low',
        document: d.path, documentId: d.id, documentAuthority: d.authority,
        implementation: [depNode.path], implementationCount: 1,
        why: `depends_on ${dep}, which changed in this diff`,
        action: `Check ${d.path} still agrees with ${depNode.path}`,
        reviewable: true,
      });
    }
  }

  assignIds(findings);
  findings.sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity) || a.document.localeCompare(b.document));
  return { findings, changed, usable: true };
}

function contractIdOf(p) { return p.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase(); }

function severityFor(authority, fileCount) {
  const rank = AUTHORITY[authority]?.rank ?? 9;
  if (rank <= 1) return fileCount >= 3 ? 'critical' : 'high';
  if (rank <= 2) return fileCount >= 5 ? 'high' : 'medium';
  if (rank === 5) return 'high';            // generated docs falling behind is mechanical and always fixable
  return fileCount >= 5 ? 'medium' : 'low';
}

/** Stable ids so suppressions survive re-runs. */
function assignIds(findings) {
  for (const f of findings) {
    const basis = `${f.kind}:${f.document}:${(f.implementation || []).join(',')}`;
    let h = 0;
    for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) >>> 0;
    f.id = `DRIFT-${String(h % 100000).padStart(5, '0')}`;
  }
}

/**
 * Semantic staleness (PRD §30). Not "last edited > 90 days" — a correct document
 * can sit untouched for years. Risk accrues from things that changed *around* it.
 */
export function staleness({ root, cfg, docs, graph, since = '180 days ago' }) {
  const out = [];
  if (!isRepo(root)) return out;
  for (const d of docs) {
    const signals = [];
    let risk = 0;
    const docCommits = commitsSince(root, d.path, since).length;
    const docLast = lastCommitDate(root, d.path);

    const globs = [].concat(d.meta.documents || [], cfg.domains?.[d.domain]?.paths || []).map(String);
    let codeCommits = 0;
    for (const g of globs) {
      codeCommits += commitsSince(root, globToPathspec(g), since).length;
    }
    if (codeCommits > 0 && docCommits === 0) {
      risk += Math.min(55, 10 + codeCommits * 5);
      signals.push(`${codeCommits} implementation commits since last documentation change`);
    }

    for (const dep of d.relationships.depends_on || []) {
      const n = graph.nodes.get(dep);
      if (!n) continue;
      const depLast = lastCommitDate(root, n.path);
      if (depLast && docLast && depLast > docLast) { risk += 12; signals.push(`dependency ${dep} is newer`); }
    }
    for (const src of d.relationships.generated_from || []) {
      const n = graph.nodes.get(src);
      if (!n) continue;
      const srcLast = lastCommitDate(root, n.path);
      if (srcLast && docLast && srcLast > docLast) { risk += 25; signals.push(`source contract ${src} is newer`); }
    }
    if (d.status === 'draft') { risk += 10; signals.push('still marked draft'); }
    const cadence = d.meta.review?.cadence;
    if (cadence && docLast) {
      const days = parseCadence(cadence);
      if (days && daysSince(docLast) > days) {
        risk += 20;
        signals.push(`review cadence ${cadence} elapsed (${daysSince(docLast)} days since last change)`);
      }
    }
    if (risk > 0) out.push({ path: d.path, id: d.id, risk: Math.min(100, risk), signals, lastChanged: docLast });
  }
  return out.sort((a, b) => b.risk - a.risk);
}

function globToPathspec(g) { return g.replace(/\*\*\/?$/, '').replace(/\/$/, '') || '.'; }
function parseCadence(c) {
  const m = /^(\d+)\s*([dwmy])/i.exec(String(c));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return { d: n, w: n * 7, m: n * 30, y: n * 365 }[m[2].toLowerCase()];
}
function daysSince(isoDate) {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

/**
 * Narrow the review surface for the drift-reviewer agent and hand it the exact
 * diff hunks it needs — so the model reads kilobytes, not the repository.
 */
export function reviewPackets({ root, findings, base = 'HEAD', limit = 12 }) {
  return findings.filter((f) => f.reviewable).slice(0, limit).map((f) => ({
    id: f.id, kind: f.kind, severity: f.severity, document: f.document,
    why: f.why,
    diffs: (f.implementation || []).slice(0, 3).map((p) => ({ path: p, diff: truncate(diffFor(root, p, base), 3000) })),
  }));
}

function truncate(s, n) { return s.length <= n ? s : `${s.slice(0, n)}\n... (${s.length - n} more characters)`; }
