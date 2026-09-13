import { matchAny } from './util.js';

/**
 * Invariants as first-class objects (PRD §24).
 *
 * This is the highest-value, cheapest feature in the product: a deterministic
 * path lookup that tells an agent "the code you are about to edit is bound by
 * these three rules" before it writes a line. No model call; the whole hook,
 * node startup included, measures around 95 ms on a small repository.
 */

const ID = /^([A-Z][A-Z0-9]*-[A-Z][A-Z0-9]*-\d{3,4})\b[:.\s-]*(.*)$/;

/**
 * Parse invariants out of any document. Two accepted forms:
 *   - a list item or heading starting with an ID: `INV-LIC-001 License belongs to one org.`
 *   - an explicit frontmatter `invariants:` block
 * @param {import('./document.js').Document} doc
 */
export function parseFrom(doc) {
  const out = [];
  const declared = doc.meta.invariants;
  if (Array.isArray(declared)) {
    for (const entry of declared) {
      if (typeof entry === 'string') {
        const m = ID.exec(entry.trim());
        if (m) out.push({ id: m[1], statement: m[2].trim(), source: doc.path, paths: [], docId: doc.id });
      } else if (entry && entry.id) {
        out.push({ id: String(entry.id), statement: String(entry.statement || entry.text || '').trim(),
          source: doc.path, paths: toList(entry.paths), docId: doc.id, severity: entry.severity || 'high' });
      }
    }
  }

  const lines = doc.body.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    // unwrap emphasis around a leading ID: "- **INV-LIC-002**: ..." -> "INV-LIC-002: ..."
    const stripped = l
      .replace(/^\s*(?:[-*+]\s+|#{1,6}\s+|\d+\.\s+)?/, '')
      .replace(/^(\*\*|__|\*|_|`)(.+?)\1/, '$2')
      .trim();
    const m = ID.exec(stripped);
    if (!m) continue;
    if (out.some((o) => o.id === m[1])) continue;
    let statement = m[2].trim();
    // A bare ID on its own line takes the next non-empty line as its statement.
    if (!statement) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const n = lines[j].trim();
        if (n) { statement = n.replace(/^[-*+]\s+/, ''); break; }
      }
    }
    out.push({ id: m[1], statement, source: doc.path, paths: [], docId: doc.id, severity: 'high', line: i + 1 });
  }
  return out;
}

/**
 * Build the global invariant set, attaching the code paths each one governs.
 * Paths come from the owning document's `documents:` globs or from the matching
 * config domain, so an invariant is reachable from a changed file.
 */
export function collect(docs, cfg) {
  const all = [];
  for (const d of docs) {
    const docPaths = toList(d.meta.documents);
    const domainPaths = d.domain ? toList(cfg.domains?.[d.domain]?.paths) : [];
    for (const inv of parseFrom(d)) {
      inv.paths = inv.paths.length ? inv.paths : [...docPaths, ...domainPaths];
      inv.domain = d.domain || domainFromId(inv.id);
      all.push(inv);
    }
  }
  const byId = new Map();
  const duplicates = [];
  for (const inv of all) {
    if (byId.has(inv.id)) duplicates.push({ id: inv.id, sources: [byId.get(inv.id).source, inv.source] });
    else byId.set(inv.id, inv);
  }
  return { invariants: [...byId.values()], duplicates };
}

function domainFromId(id) {
  const parts = id.split('-');
  return parts.length >= 3 ? parts[1].toLowerCase() : null;
}

function toList(v) { return v == null ? [] : (Array.isArray(v) ? v.map(String) : [String(v)]); }

/**
 * Invariants that apply to a set of changed files. This is what the PreToolUse
 * hook injects as additionalContext.
 * @param {{invariants:object[]}} set
 * @param {string[]} changedPaths
 * @param {object} cfg
 */
export function applicable(set, changedPaths, cfg) {
  const out = [];
  for (const inv of set.invariants) {
    const globs = inv.paths.length ? inv.paths : domainGlobs(cfg, inv.domain);
    if (!globs.length) continue;
    const hit = changedPaths.find((p) => matchAny(p, globs));
    if (hit) out.push({ ...inv, matched: hit });
  }
  return out;
}

function domainGlobs(cfg, domain) {
  if (!domain) return [];
  return toList(cfg.domains?.[domain]?.paths);
}

export function render(list) {
  if (!list.length) return '';
  const lines = ['Invariants that constrain the code you are editing:'];
  for (const inv of list) {
    lines.push(`  ${inv.id}  ${inv.statement}`);
    lines.push(`      source: ${inv.source}${inv.line ? `:${inv.line}` : ''}  (matched ${inv.matched})`);
  }
  lines.push('Breaking one of these requires changing its source document in the same change.');
  return lines.join('\n');
}
