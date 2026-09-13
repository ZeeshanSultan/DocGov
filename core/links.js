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
  // `allFiles` is the inventory's set of tracked *files*. It is a fast path, not the
  // truth: it holds no directories, and it skips dotfiles and source files the
  // inventory does not track. A miss therefore has to be confirmed against the
  // filesystem before it is called broken — a link to `core/`, to `.golangci.yml` or
  // to `core/coverage/gate.go` is perfectly valid. The stat only runs on misses.
  const present = (rel) => !!rel && ((allFiles && allFiles.has(rel)) || exists(path.join(root, rel)));

  // A link is broken only when no convention a human would have meant resolves it.
  // Measured on a 1,045-document repository, checking only the document-relative path
  // reported 1,304 broken links of which 277 were real: the rest were directories,
  // dotfiles, `file.go:43` line references, static-site permalinks and repo-root
  // relative paths. Each fallback below only ever runs after the previous one misses,
  // and each still requires the target to actually exist, so none of them can hide a
  // genuinely missing file.
  const resolves = (docPath, target) => {
    const rel = resolveLink(docPath, target);
    if (present(rel)) return true;

    // `notes/file.go:43` — a line reference, not a path.
    const noLine = rel.replace(/:\d+(?:-\d+)?$/, '');
    if (noLine !== rel && present(noLine)) return true;

    // Static-site permalink: `./CHW-1001/` rendered from a sibling `CHW-1001.md`,
    // or from `CHW-1001/_index.md`. Hugo, Docusaurus and Jekyll all do this.
    const slug = rel.replace(/\/$/, '');
    if (slug !== rel && (present(`${slug}.md`) || present(`${slug}/_index.md`)
      || present(`${slug}/index.md`) || present(`${slug}/README.md`))) return true;

    // Repo-root relative: `core/malware/index.go` written from `docs/…`. Only tried
    // for targets that did not explicitly anchor themselves with `./`, `../` or `/`.
    if (!/^[./]/.test(target)) {
      const fromRoot = toPosix(target).replace(/:\d+(?:-\d+)?$/, '').replace(/\/$/, '');
      if (present(fromRoot) || present(`${fromRoot}.md`) || present(`${fromRoot}/_index.md`)) return true;
    }
    return false;
  };

  for (const d of docs) {
    for (const target of d.links().internal) {
      if (target === '' || target.startsWith('mailto:')) continue;
      if (resolves(d.path, target)) continue;
      out.push({ path: d.path, target, resolved: resolveLink(d.path, target) });
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
