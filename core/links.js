import path from 'node:path';
import { exists, toPosix } from './util.js';
import { resolveLink } from './graph.js';

/**
 * Internal link integrity and repair.
 *
 * External link rot is lychee's job when lychee is installed (PRD §42). Internal
 * links are DocGov's job because they *are* the graph.
 */

/**
 * @param {import('./document.js').Document[]} docs
 * @param {string} root
 * @param {Set<string>} [allFiles] repo-relative paths that exist
 */
export function brokenLinks(docs, root, allFiles) {
  const out = [];
  for (const d of docs) {
    for (const target of d.links().internal) {
      if (target === '' || target.startsWith('mailto:')) continue;
      const resolved = resolveLink(d.path, target);
      const ok = allFiles ? allFiles.has(resolved) : exists(path.join(root, resolved));
      if (!ok) out.push({ path: d.path, target, resolved });
    }
  }
  return out;
}

/** Anchors referenced within a document that have no matching heading. */
export function brokenAnchors(docs) {
  const out = [];
  for (const d of docs) {
    const slugs = new Set(headingSlugs(d.body));
    for (const a of d.links().anchors) {
      const s = a.slice(1).toLowerCase();
      if (s && !slugs.has(s)) out.push({ path: d.path, anchor: a });
    }
  }
  return out;
}

export function headingSlugs(body) {
  const out = [];
  for (const m of body.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)) {
    out.push(m[1].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'));
  }
  return out;
}

/**
 * Rewrite every internal link that pointed at a moved file.
 * @param {string} source document text
 * @param {string} fromDocPath the document's path BEFORE the move set applied
 * @param {string} toDocPath   the document's path AFTER
 * @param {Map<string,string>} moves old repo-relative path -> new repo-relative path
 */
export function rewriteLinks(source, fromDocPath, toDocPath, moves) {
  return source.replace(/(\[(?:[^\]\\]|\\.)*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (full, open, target, close) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#')) return full;
    const [file, hash] = target.split(/(?=#)/);
    const absOld = resolveLink(fromDocPath, file);
    const absNew = moves.get(absOld) || absOld;
    const rel = path.posix.relative(path.posix.dirname(toDocPath), absNew) || path.posix.basename(absNew);
    const out = rel.startsWith('.') ? rel : (absNew.includes('/') || toDocPath.includes('/') ? rel : rel);
    return `${open}${toPosix(out)}${hash || ''}${close}`;
  });
}

/** Count of inbound internal links per document, for discoverability scoring. */
export function inboundCounts(docs) {
  const counts = new Map(docs.map((d) => [d.path, 0]));
  for (const d of docs) {
    for (const t of d.links().internal) {
      const r = resolveLink(d.path, t);
      if (counts.has(r)) counts.set(r, counts.get(r) + 1);
    }
  }
  return counts;
}
