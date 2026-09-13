import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const EXIT = { OK: 0, VIOLATION: 1, REVIEW: 2, CONFIG: 3 };

export class DocGovError extends Error {
  constructor(msg, code = EXIT.CONFIG) { super(msg); this.name = 'DocGovError'; this.code = code; }
}

export function read(p) { return fs.readFileSync(p, 'utf8'); }
export function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

export function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

export function sha(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.docgov', 'dist', 'build', 'out', 'target', 'vendor',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.pytest_cache', 'coverage',
  '.turbo', '.cache', '.idea', '.vscode', 'site-packages',
]);

/**
 * Depth-limited recursive walk returning repo-relative POSIX paths.
 * @param {string} root
 * @param {{match?:(rel:string)=>boolean, maxDepth?:number, includeDirs?:boolean}} [opts]
 */
export function walk(root, opts = {}) {
  const { match = () => true, maxDepth = 12, includeDirs = false } = opts;
  const out = [];
  const rec = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github' && e.name !== '.claude') continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const rel = toPosix(path.relative(root, abs));
      if (e.isDirectory()) {
        if (includeDirs && match(rel)) out.push(rel);
        rec(abs, depth + 1);
      } else if (e.isFile() && match(rel)) out.push(rel);
    }
  };
  rec(root, 0);
  return out.sort();
}

export function toPosix(p) { return p.split(path.sep).join('/'); }

/** Minimal glob: supports **, *, ?, and {a,b} alternation. Anchored. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches zero or more path segments
        if (glob[i + 2] === '/') { re += '(?:[^/]*\\/)*'; i += 2; }
        else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close < 0) { re += '\\{'; continue; }
      re += `(?:${glob.slice(i + 1, close).split(',').map(escapeRe).join('|')})`;
      i = close;
    } else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function matchGlob(p, glob) { return globToRegExp(glob).test(p); }
export function matchAny(p, globs) { return (globs || []).some((g) => matchGlob(p, g)); }

/** Deep merge; arrays replace, objects merge, undefined ignored. */
export function merge(base, over) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over;
  if (typeof base !== 'object' || typeof over !== 'object' || base === null) return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export function titleCase(s) {
  return String(s).replace(/[-_/]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function pct(n, d) { return d === 0 ? 100 : Math.round((n / d) * 100); }

export function table(rows, headers) {
  if (rows.length === 0) return '(none)';
  const cols = headers || Object.keys(rows[0]);
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells) => cells.map((v, i) => String(v ?? '').padEnd(width[i])).join('  ').trimEnd();
  return [line(cols), line(width.map((w) => '-'.repeat(w))), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

export function plural(n, one, many = `${one}s`) { return `${n} ${n === 1 ? one : many}`; }

export function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (exists(path.join(dir, '.docgov', 'config.yaml')) || exists(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}
