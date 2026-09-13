import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { exists, toPosix } from './util.js';

/** Git is the audit log (PRD §38). DocGov reads it, never replaces it. */

function git(root, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (allowFail) return '';
    throw new Error(`git ${args.join(' ')} failed: ${String(e.stderr || e.message).trim()}`);
  }
}

export function isRepo(root) { return exists(path.join(root, '.git')); }

/**
 * Is the tree clean enough to migrate?
 *
 * DocGov's own state under .docgov/ does not count: `onboard` writes the plan that
 * `migrate` then executes, so counting it would make the two commands mutually
 * exclusive. Everything else must be committed, because that is what makes a
 * migration revertible.
 */
export function isClean(root, { ignore = ['.docgov/'] } = {}) {
  if (!isRepo(root)) return false;
  const out = git(root, ['status', '--porcelain'], { allowFail: true });
  if (out === '') return true;
  return out.split('\n').filter(Boolean).every((line) => {
    const p = line.slice(3).replace(/^"|"$/g, '');
    return ignore.some((prefix) => p.startsWith(prefix));
  });
}

export function currentBranch(root) {
  return git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }) || 'HEAD';
}

export function headSha(root) { return git(root, ['rev-parse', 'HEAD'], { allowFail: true }); }

/** @returns {{path:string, status:string, oldPath?:string}[]} */
export function changedFiles(root, base = 'HEAD') {
  if (!isRepo(root)) return [];
  const out = git(root, ['diff', '--name-status', '-M', base], { allowFail: true });
  const staged = git(root, ['diff', '--name-status', '-M', '--cached', base], { allowFail: true });
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard'], { allowFail: true });
  const seen = new Map();
  for (const block of [out, staged]) {
    for (const line of block.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const status = parts[0][0];
      if (status === 'R') seen.set(toPosix(parts[2]), { path: toPosix(parts[2]), status: 'R', oldPath: toPosix(parts[1]) });
      else seen.set(toPosix(parts[1]), { path: toPosix(parts[1]), status });
    }
  }
  for (const f of untracked.split('\n').filter(Boolean)) {
    if (!seen.has(toPosix(f))) seen.set(toPosix(f), { path: toPosix(f), status: 'A' });
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Unified diff for one path, used to extract changed values for drift review. */
export function diffFor(root, relPath, base = 'HEAD') {
  return git(root, ['diff', '-U2', base, '--', relPath], { allowFail: true });
}

/** Commits touching a path since `since`. */
export function commitsSince(root, relPath, since = '90 days ago') {
  const out = git(root, ['log', `--since=${since}`, '--format=%H%x09%an%x09%ad%x09%s', '--date=short', '--', relPath], { allowFail: true });
  return out.split('\n').filter(Boolean).map((l) => {
    const [sha, author, date, subject] = l.split('\t');
    return { sha, author, date, subject };
  });
}

export function lastCommitDate(root, relPath) {
  const d = git(root, ['log', '-1', '--format=%ad', '--date=short', '--', relPath], { allowFail: true });
  return d || null;
}

/** Primary author of a path, as an owner hint for `docgov onboard`. */
export function primaryAuthor(root, relPath) {
  const out = git(root, ['shortlog', '-sne', 'HEAD', '--', relPath], { allowFail: true });
  const first = out.split('\n').filter(Boolean)[0];
  if (!first) return null;
  const m = /^\s*\d+\s+(.+?)\s+<(.+?)>/.exec(first);
  return m ? { name: m[1], email: m[2] } : null;
}

export function move(root, from, to) {
  const dir = path.dirname(path.join(root, to));
  execFileSync('mkdir', ['-p', dir]);
  git(root, ['mv', '-f', from, to]);
}

export function createBranch(root, name) { git(root, ['checkout', '-b', name]); }
export function checkout(root, ref) { git(root, ['checkout', ref]); }
export function stashPush(root, msg) { return git(root, ['stash', 'push', '-u', '-m', msg], { allowFail: true }); }
export function resetHard(root, ref = 'HEAD') { git(root, ['reset', '--hard', ref]); }
export function add(root, paths) { git(root, ['add', '--', ...paths]); }
export function commit(root, message) { git(root, ['commit', '-m', message, '--no-verify']); }
export function revParse(root, ref) { return git(root, ['rev-parse', ref], { allowFail: true }); }
export function mergeBase(root, a, b) { return git(root, ['merge-base', a, b], { allowFail: true }); }
