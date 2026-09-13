import path from 'node:path';
import { exists, matchGlob, toPosix } from './util.js';

/**
 * Authority scopes: which part of a monorepo a document governs.
 *
 * Authority was repository-wide. In a monorepo that is wrong in both directions at once. A
 * package's architecture document is canonical *for that package* and says nothing about any
 * other, so treating it as repository-wide invents contradictions between packages that have
 * nothing to do with each other. And every package has a README, which a repository-wide
 * "there is one README" rule demotes to a directory index.
 *
 * The visible cost was in the migration plan. On a 1,011-document monorepo, `review` proposed
 * 345 moves and left 316 documents classified with low confidence — much of it a package's own
 * documentation being dragged toward one central tree that no package owns, which is not a
 * tidy-up, it is a reorganisation nobody asked for.
 *
 * A scope is a directory that is a unit of software: it has a package manifest, so somebody
 * already declared it one. Nothing here invents a boundary — it reads the boundaries the
 * repository's own build tooling already draws, and config can name more.
 *
 * What a scope changes:
 *
 *   destinations   a package's document lands in that package's documentation tree, not the
 *                  repository's.
 *   singletons     one README *per scope*. Each package legitimately has one.
 *   comparisons    authority conflicts and competing responsibilities are judged within a
 *                  scope. Two packages each having a "setup" guide is not a duplicate.
 *
 * What it deliberately does not change: repository-wide documents stay repository-wide.
 * A security policy, a contributing guide and the system architecture govern everything, and
 * they live at the root, which is the scope everything else is nested inside.
 */

/** Files that mean "this directory is a unit of software", by the tooling that reads them. */
const MANIFESTS = ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'setup.py',
  'build.gradle', 'build.gradle.kts', 'pom.xml', 'composer.json', 'Gemfile', 'mix.exs'];

/** Directories that hold code but are never a scope of their own. */
const NEVER = /(^|\/)(node_modules|vendor|\.git|dist|build|target|testdata|fixtures|examples?)(\/|$)/;

/**
 * The scopes in a repository: those declared in config, plus those its build tooling declares.
 *
 * @returns {Array<{name:string, prefix:string, declared:boolean}>}
 */
export function detect(root, cfg, allPaths = []) {
  const found = new Map();

  // Config first and last: a repository that names its scopes has said something deliberate,
  // and detection must not quietly disagree with it.
  for (const [name, spec] of Object.entries(cfg?.scopes?.packages || {})) {
    const prefix = String(spec?.path || spec?.paths?.[0] || name).replace(/\/?\*+.*$/, '').replace(/\/$/, '');
    if (prefix) found.set(prefix, { name, prefix, declared: true });
  }

  if (cfg?.scopes?.detect !== false) {
    for (const rel of allPaths) {
      const p = toPosix(rel);
      const base = p.split('/').pop();
      if (!MANIFESTS.includes(base)) continue;
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      // The repository root is not a scope: it is what everything else is nested inside, and
      // calling it one would make every document "scoped" and the distinction meaningless.
      if (!dir || NEVER.test(`${dir}/`)) continue;
      if (!found.has(dir)) found.set(dir, { name: dir.split('/').pop(), prefix: dir, declared: false });
    }
  }

  // Longest prefix first, so a nested package wins over the one containing it.
  return [...found.values()]
    .filter((s) => s.declared || exists(path.join(root, s.prefix)))
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

/** Which scope a path belongs to, or null for the repository itself. */
export function scopeOf(scopes, p) {
  const rel = toPosix(p);
  for (const s of scopes) if (rel === s.prefix || rel.startsWith(`${s.prefix}/`)) return s;
  return null;
}

/** Do two paths answer to the same authority? */
export function sameScope(scopes, a, b) {
  return (scopeOf(scopes, a)?.prefix ?? null) === (scopeOf(scopes, b)?.prefix ?? null);
}

/**
 * A canonical destination, relative to the scope the document belongs to.
 *
 * A package's guide belongs in that package's documentation tree. Moving it to the
 * repository's is the behaviour that produced 345 proposed moves on one monorepo, and it is
 * wrong in a way nobody notices until the package is extracted and its documentation is gone.
 */
export function scopedDestination(scopes, currentPath, destination) {
  const s = scopeOf(scopes, currentPath);
  if (!s) return destination;
  if (destination.startsWith(`${s.prefix}/`)) return destination;   // already scoped
  return `${s.prefix}/${destination}`;
}

/** Config can exempt paths from ever being treated as scoped. */
export function excluded(cfg, p) {
  return (cfg?.scopes?.exclude || []).some((g) => matchGlob(toPosix(p), g));
}
