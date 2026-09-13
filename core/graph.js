import path from 'node:path';
import { RELATIONSHIPS, AUTHORITY } from './taxonomy.js';
import { write, read, exists, matchAny } from './util.js';

export const GRAPH_PATH = '.docgov/graph.json';

/**
 * The documentation graph (PRD §8). Nodes are documents, contracts and code
 * path-globs; edges are typed relationships plus their inverses, so impact
 * analysis can walk in either direction.
 */
export class Graph {
  constructor() {
    /** @type {Map<string, {id:string,path:string,type:string,authority:string,visibility:string,domain:string|null,kind:string}>} */
    this.nodes = new Map();
    /** @type {{from:string,to:string,rel:string,inferred?:boolean}[]} */
    this.edges = [];
    this._out = new Map();
    this._in = new Map();
  }

  addNode(n) { this.nodes.set(n.id, n); return n; }

  addEdge(from, to, rel, inferred = false) {
    this.edges.push({ from, to, rel, inferred });
    (this._out.get(from) ?? this._out.set(from, []).get(from)).push({ to, rel, inferred });
    (this._in.get(to) ?? this._in.set(to, []).get(to)).push({ from, rel, inferred });
  }

  out(id, rel) { return (this._out.get(id) || []).filter((e) => !rel || e.rel === rel); }
  in(id, rel) { return (this._in.get(id) || []).filter((e) => !rel || e.rel === rel); }

  /** Breadth-first closure over chosen edge directions. */
  reach(startIds, { rels = null, direction = 'out', maxDepth = 4 } = {}) {
    const seen = new Map();
    let frontier = [...startIds];
    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
      const next = [];
      for (const id of frontier) {
        const edges = direction === 'out' ? this.out(id) : this.in(id);
        for (const e of edges) {
          if (rels && !rels.includes(e.rel)) continue;
          const target = direction === 'out' ? e.to : e.from;
          if (seen.has(target) || startIds.includes(target)) continue;
          seen.set(target, { depth, via: e.rel, from: id });
          next.push(target);
        }
      }
      frontier = next;
    }
    return seen;
  }

  /**
   * Documents nothing can reach and which reach nothing (PRD §31).
   *
   * Inferred link edges count: a document that links to others is visible to impact
   * analysis, which is what this rule actually cares about. Only a document with no
   * edge of any kind is invisible, and invisible means nothing will ever tell anyone
   * it went stale.
   */
  orphans() {
    return [...this.nodes.values()]
      .filter((n) => n.kind === 'document' && this.out(n.id).length === 0 && this.in(n.id).length === 0);
  }

  /** Edges that point at a node the graph does not contain. */
  dangling() {
    return this.edges.filter((e) => !this.nodes.has(e.to)).map((e) => ({ ...e, fromPath: this.nodes.get(e.from)?.path }));
  }

  /**
   * A lower-authority document claiming authority over a higher one is a
   * structural error, not a matter of taste (PRD §5).
   */
  authorityViolations() {
    const out = [];
    for (const e of this.edges) {
      if (e.rel !== 'defines' && e.rel !== 'supersedes') continue;
      const from = this.nodes.get(e.from), to = this.nodes.get(e.to);
      if (!from || !to) continue;
      const fr = AUTHORITY[from.authority]?.rank ?? 9;
      const tr = AUTHORITY[to.authority]?.rank ?? 9;
      if (fr > tr) out.push({ from: from.path, to: to.path, rel: e.rel, fromAuthority: from.authority, toAuthority: to.authority });
    }
    return out;
  }

  toJSON() {
    return {
      version: 1,
      generated: new Date().toISOString().slice(0, 10),
      nodes: [...this.nodes.values()],
      edges: this.edges,
    };
  }
}

/**
 * Build the graph from documents + registry + config domains.
 * @param {import('./document.js').Document[]} docs
 * @param {object} registry
 * @param {object} cfg
 * @param {{path:string,kind:string}[]} [contracts]
 */
export function build(docs, registry, cfg, contracts = []) {
  const g = new Graph();
  const byPath = new Map();

  for (const d of docs) {
    const n = g.addNode({ id: d.id, path: d.path, type: d.type, authority: d.authority,
      visibility: d.visibility, domain: d.domain, status: d.status, kind: 'document',
      lines: d.lines, hash: d.hash, generated: d.isGenerated });
    byPath.set(d.path, n);
  }
  for (const c of contracts) {
    const id = c.path.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    if (!g.nodes.has(id)) g.addNode({ id, path: c.path, type: `contract.${c.kind}`, authority: 'machine-contract',
      visibility: 'internal', domain: null, kind: 'contract' });
  }

  // Declared relationships, plus their inverses so traversal works both ways.
  for (const d of docs) {
    for (const [rel, targets] of Object.entries(d.relationships)) {
      for (const t of targets) {
        g.addEdge(d.id, t, rel);
        const inv = RELATIONSHIPS[rel]?.inverse;
        if (inv && g.nodes.has(t)) g.addEdge(t, d.id, inv, true);
      }
    }
  }

  // Inferred `references` edges from internal markdown links: free, and the main
  // reason a greenfield repo's graph is not empty on day one.
  for (const d of docs) {
    for (const target of d.links().internal) {
      const resolved = resolveLink(d.path, target);
      const node = byPath.get(resolved);
      if (node && node.id !== d.id) g.addEdge(d.id, node.id, 'references', true);
    }
  }

  // Domain -> code path edges from config, so impact analysis can map a code diff
  // to the documents that claim to describe it.
  for (const [domain, spec] of Object.entries(cfg.domains || {})) {
    const nodeId = `code:${domain}`;
    g.addNode({ id: nodeId, path: (spec.paths || []).join(', '), type: 'code.domain', authority: 'implementation',
      visibility: 'internal', domain, kind: 'code', paths: spec.paths || [] });
    for (const docId of spec.docs || []) if (g.nodes.has(docId)) g.addEdge(docId, nodeId, 'documents');
  }
  // `documents:` in frontmatter is the per-document version of the same mapping.
  for (const d of docs) {
    const globs = d.meta.documents;
    if (!globs) continue;
    const list = Array.isArray(globs) ? globs : [globs];
    const nodeId = `code:${d.id}`;
    g.addNode({ id: nodeId, path: list.join(', '), type: 'code.paths', authority: 'implementation',
      visibility: 'internal', domain: d.domain, kind: 'code', paths: list });
    g.addEdge(d.id, nodeId, 'documents');
  }

  return g;
}

export function resolveLink(fromPath, target) {
  const dir = path.posix.dirname(fromPath);
  let p = path.posix.normalize(path.posix.join(dir, target));
  if (p.startsWith('./')) p = p.slice(2);
  return p;
}

export function save(root, g) { return write(path.join(root, GRAPH_PATH), JSON.stringify(g.toJSON(), null, 2) + '\n'); }

export function loadSaved(root) {
  const f = path.join(root, GRAPH_PATH);
  return exists(f) ? JSON.parse(read(f)) : null;
}

/** Which code-node globs does a changed file belong to? */
export function codeNodesFor(g, changedPath) {
  return [...g.nodes.values()].filter((n) => n.kind === 'code' && matchAny(changedPath, n.paths || []));
}
