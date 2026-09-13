import path from 'node:path';
import * as yaml from './yaml.js';
import { read, write, exists, DocGovError } from './util.js';

export const REGISTRY_PATH = '.docgov/registry.yaml';

/**
 * The registry is the authoritative id -> path map. It is the reason
 * "is this id a duplicate?" is answered by software and not by a model (PRD §47).
 */
export function load(root) {
  const file = path.join(root, REGISTRY_PATH);
  if (!exists(file)) return { version: 1, documents: {} };
  let r;
  try { r = yaml.parse(read(file)) || {}; }
  catch (e) { throw new DocGovError(`${REGISTRY_PATH} is not valid: ${e.message}`); }
  r.documents ||= {};
  return r;
}

export function save(root, registry) {
  const sorted = {};
  for (const k of Object.keys(registry.documents).sort()) sorted[k] = registry.documents[k];
  return write(path.join(root, REGISTRY_PATH), yaml.stringify({ version: registry.version || 1, documents: sorted }));
}

/**
 * Rebuild from documents on disk. Reports id collisions rather than silently
 * picking a winner.
 * @param {import('./document.js').Document[]} docs
 */
export function build(docs, contracts = []) {
  const documents = {};
  const collisions = [];
  for (const d of docs) {
    const id = d.id;
    if (documents[id]) collisions.push({ id, paths: [documents[id].path, d.path] });
    else documents[id] = d.toRegistryEntry();
  }
  for (const c of contracts) {
    const id = contractId(c.path);
    if (documents[id]) collisions.push({ id, paths: [documents[id].path, c.path] });
    else documents[id] = { path: c.path, type: `contract.${c.kind === 'openapi' ? 'openapi' : 'schema'}`,
      authority: 'machine-contract', visibility: 'internal', machine: true };
  }
  return { registry: { version: 1, documents }, collisions };
}

export function contractId(p) {
  return p.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

export function pathOf(registry, id) { return registry.documents[id]?.path || null; }

export function idAt(registry, relPath) {
  for (const [id, e] of Object.entries(registry.documents)) if (e.path === relPath) return id;
  return null;
}

/** Ids referenced by relationships that do not exist in the registry (PRD §21). */
export function danglingReferences(registry) {
  const out = [];
  for (const [id, e] of Object.entries(registry.documents)) {
    for (const [rel, targets] of Object.entries(e.relationships || {})) {
      for (const t of targets) {
        if (!registry.documents[t]) out.push({ id, relationship: rel, target: t, path: e.path });
      }
    }
  }
  return out;
}
