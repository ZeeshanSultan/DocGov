import path from 'node:path';
import * as yaml from './yaml.js';
import * as schema from './schema.js';
import { read, write, exists, DocGovError } from './util.js';

/** Human override (PRD §40). Recorded, reasoned, optionally expiring — never silent. */

export function load(root, cfg) {
  const file = path.join(root, cfg.suppressions_file || '.docgov/suppressions.yaml');
  if (!exists(file)) return { version: 1, suppressions: [] };
  try {
    const s = schema.check('suppressions', yaml.parse(read(file)) || {}, file);
    s.suppressions ||= [];
    return s;
  } catch (e) { throw new DocGovError(`suppressions file is not valid: ${e.message}`); }
}

export function save(root, cfg, data) {
  return write(path.join(root, cfg.suppressions_file || '.docgov/suppressions.yaml'), yaml.stringify(data));
}

export function add(root, cfg, { id, reason, expires = null, by = null }) {
  if (!id) throw new DocGovError('suppression needs a finding id');
  if (!reason || String(reason).trim().length < 8) throw new DocGovError('suppression needs a reason of at least 8 characters');
  const data = load(root, cfg);
  const existing = data.suppressions.find((s) => s.id === id);
  const entry = { id, reason: String(reason).trim(), created: new Date().toISOString().slice(0, 10) };
  if (expires) entry.expires = expires;
  if (by) entry.by = by;
  if (existing) Object.assign(existing, entry);
  else data.suppressions.push(entry);
  save(root, cfg, data);
  return entry;
}

export function remove(root, cfg, id) {
  const data = load(root, cfg);
  const before = data.suppressions.length;
  data.suppressions = data.suppressions.filter((s) => s.id !== id);
  save(root, cfg, data);
  return before !== data.suppressions.length;
}

/**
 * Split findings into active and suppressed. Expired suppressions do not
 * suppress — they surface as their own warning so they cannot rot quietly.
 */
export function apply(findings, data, today = new Date().toISOString().slice(0, 10)) {
  const byId = new Map((data.suppressions || []).map((s) => [s.id, s]));
  const active = [], suppressed = [], expired = [];
  for (const f of findings) {
    const s = byId.get(f.id);
    if (!s) { active.push(f); continue; }
    if (s.expires && s.expires < today) { expired.push({ ...f, suppression: s }); active.push(f); continue; }
    suppressed.push({ ...f, suppression: s });
  }
  const unused = [...byId.values()].filter((s) => !findings.some((f) => f.id === s.id));
  return { active, suppressed, expired, unused };
}
