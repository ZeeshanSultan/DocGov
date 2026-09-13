import path from 'node:path';
import fs from 'node:fs';
import * as git from './git.js';
import * as fm from './frontmatter.js';
import { rewriteLinks } from './links.js';
import { frontmatterFor } from './templates.js';
import { read, write, exists, DocGovError, EXIT } from './util.js';
import { classify } from './classify.js';
import { PLAN_DATA_PATH } from './onboard.js';

/**
 * Transactional migration (PRD §41).
 *
 * Two guarantees, both enforced here rather than promised in prose:
 *   1. nothing runs unless git can revert it;
 *   2. every internal link is repaired in the same operation as the move, so the
 *      repository is never left in a half-migrated state.
 *
 * Only mechanical actions run. SPLIT, MERGE and EXTRACT rewrite prose, so they
 * belong to an agent with a human in the loop — not to a file mover.
 */

const MECHANICAL = new Set(['MOVE', 'ANNOTATE', 'ARCHIVE', 'CREATE']);

/**
 * @param {{root:string, cfg:object, docs:any[], planData:object, dryRun?:boolean,
 *          include?:string[], branch?:string|null, useGit?:boolean}} args
 */
export function migrate({ root, cfg, docs, planData, dryRun = false, include = [], skip = [], branch = null, useGit = true }) {
  const kinds = new Set([...MECHANICAL, ...include.map((k) => k.toUpperCase())]);
  let actions = planData.actions.filter((a) => kinds.has(a.kind));
  const skipIds = new Set(skip);
  if (skipIds.size) actions = actions.filter((a) => !skipIds.has(a.id));
  const ops = [];
  const skipped = [];

  if (useGit && !dryRun) {
    if (!git.isRepo(root)) throw new DocGovError(
      'migrate needs a git repository — without it a migration is not revertible. Run `git init` first, or pass --no-git to accept that risk.',
      EXIT.CONFIG);
    if (!git.isClean(root)) throw new DocGovError(
      ['the working tree has uncommitted changes, so a migration would not be separable from them:',
        ...git.dirtyPaths(root).slice(0, 10).map((p) => `  ${p}`),
        'Commit or stash these first — `git add -A && git commit -m "chore: adopt DocGov"` is usually what is wanted.',
      ].join('\n'),
      EXIT.CONFIG);
  }

  // ---- every path in the plan must stay inside the repository, checked before anything
  // moves. The plan is an editable file: a human resolves collisions in it, and anything
  // that can write it can choose where a document lands. Until this existed the boundary
  // was held by `git mv` refusing an outside path — incidental, not designed, and absent
  // entirely on the `--no-git` path, where `fs.renameSync` wrote wherever it was told.
  // Every action is validated before the first one executes, so a bad plan moves nothing
  // rather than stopping halfway.
  const repoRoot = path.resolve(root);
  const insideRepo = (rel) => {
    if (typeof rel !== 'string' || rel === '') return false;
    if (path.isAbsolute(rel)) return false;
    if (/^[a-zA-Z]:[\\/]/.test(rel)) return false;          // c:\… on Windows
    if (rel.includes('\0')) return false;
    const resolved = path.resolve(repoRoot, rel);
    return resolved === repoRoot || resolved.startsWith(repoRoot + path.sep);
  };
  for (const a of actions) {
    for (const [field, value] of [['path', a.path], ['to', a.to]]) {
      if (value == null) continue;
      if (!insideRepo(value)) throw new DocGovError(
        `refusing to act on a path outside the repository: ${a.kind || 'action'} ${field} ${JSON.stringify(value)}. `
        + `Every path in ${PLAN_DATA_PATH} must be relative to the repository root.`);
    }
  }

  // ---- plan the file operations
  const moves = new Map();                        // old rel -> new rel
  for (const a of actions) {
    if ((a.kind === 'MOVE' || a.kind === 'ARCHIVE') && a.to && a.to !== a.path) moves.set(a.path, a.to);
  }
  // A destination collision would silently destroy a document. Refuse instead.
  const dests = new Map();
  for (const [from, to] of moves) {
    if (dests.has(to)) throw new DocGovError(
      `migration would put two documents at ${to} (${dests.get(to)} and ${from}). Edit ${PLAN_DATA_PATH} to disambiguate.`);
    if (exists(path.join(root, to)) && !moves.has(to)) throw new DocGovError(
      `migration destination ${to} already exists and is not itself being moved.`);
    dests.set(to, from);
  }

  const annotate = new Map();
  for (const a of actions) if (a.kind === 'ANNOTATE') annotate.set(a.path, a);

  const byPath = new Map(docs.map((d) => [d.path, d]));

  // ---- rewrite every document's content once: links + frontmatter together
  for (const d of docs) {
    const finalPath = moves.get(d.path) || d.path;
    let content = d.source;

    const linked = rewriteLinks(content, d.path, finalPath, moves);
    const linksChanged = linked !== content;
    content = linked;

    let metaChanged = false;
    const ann = annotate.get(d.path);
    // A document whose frontmatter this parser will not read cannot be annotated — but it
    // is one document, and aborting the run over it leaves every other document
    // ungoverned. `Document` already degrades this way: it records the error and carries
    // on. Two files out of 299 used to stop a whole repository's migration.
    if (ann && d.error) {
      skipped.push({ path: d.path, reason: d.error });
    } else if (ann) {
      const c = classify(d);
      const type = ann.type && ann.type !== 'unknown' ? ann.type : c.type;
      if (type !== 'unknown') {
        const meta = frontmatterFor({
          type, id: d.meta.id || suggestId(finalPath), title: d.title, cfg,
          domain: d.domain, visibility: d.meta.visibility, owner: d.owner || ann.owner,
        });
        content = fm.patchDocgov(content, meta);
        metaChanged = true;
      }
    }

    if (finalPath !== d.path) {
      ops.push({ op: 'move', from: d.path, to: finalPath, rewroteLinks: linksChanged, annotated: metaChanged });
    } else if (linksChanged || metaChanged) {
      ops.push({ op: 'edit', path: d.path, rewroteLinks: linksChanged, annotated: metaChanged });
    }

    if (!dryRun) {
      if (finalPath !== d.path) {
        if (useGit && git.isRepo(root)) git.move(root, d.path, finalPath);
        else {
          fs.mkdirSync(path.dirname(path.join(root, finalPath)), { recursive: true });
          fs.renameSync(path.join(root, d.path), path.join(root, finalPath));
        }
      }
      if (content !== d.source) write(path.join(root, finalPath), content);
    }
  }

  // ---- namespace directories for the chosen layout, so empty namespaces exist on purpose
  for (const a of actions.filter((x) => x.kind === 'CREATE')) {
    const dir = a.to.endsWith('/') ? a.to : path.dirname(a.to);
    ops.push({ op: 'mkdir', path: dir, reason: a.reason, type: a.type });
    if (!dryRun) fs.mkdirSync(path.join(root, dir), { recursive: true });
  }

  const deferred = planData.actions.filter((a) => !kinds.has(a.kind));

  return {
    dryRun, ops, deferred, skipped,
    moved: ops.filter((o) => o.op === 'move').length,
    edited: ops.filter((o) => o.op === 'edit').length,
    linksRepaired: ops.filter((o) => o.rewroteLinks).length,
    annotated: ops.filter((o) => o.annotated).length,
    branch: branch || null,
  };
}

function suggestId(relPath) {
  return relPath.replace(/\.mdx?$/, '').replace(/^(docs|documentation)\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);
}

/** Verify a migration left the repository coherent. Run immediately after. */
export function verify({ root, docs, inv }) {
  const problems = [];
  const files = new Set(inv.all);
  for (const d of docs) {
    for (const t of d.links().internal) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(d.path), t));
      if (!files.has(resolved) && !exists(path.join(root, resolved))) {
        problems.push({ kind: 'broken-link', path: d.path, target: t });
      }
    }
  }
  const ids = new Map();
  for (const d of docs) {
    if (!d.meta.id) continue;
    if (ids.has(d.meta.id)) problems.push({ kind: 'duplicate-id', path: d.path, other: ids.get(d.meta.id), id: d.meta.id });
    else ids.set(d.meta.id, d.path);
  }
  return problems;
}

/** Abort: undo a migration that has not been committed. */
export function abort(root) {
  if (!git.isRepo(root)) throw new DocGovError('cannot abort without git');
  git.resetHard(root, 'HEAD');
  return true;
}
