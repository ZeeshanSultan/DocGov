/**
 * The snapshot every command reads, and the few facts about the install that several of them
 * need. `ctx()` loads once per invocation on purpose: two commands in one process must not be
 * able to disagree about what the repository contains.
 */
import path from 'node:path';
import * as cfgmod from '../core/config.js';
import * as reg from '../core/registry.js';
import * as graphmod from '../core/graph.js';
import * as inv from '../core/inventory.js';
import { DocGovError, read, exists, plural } from '../core/util.js';
import { say } from './output.js';

/** Load everything once. Every command sees the same snapshot. */
export function ctx({ requireInit = true } = {}) {
  const { root, cfg, raw, initialized } = cfgmod.load(process.cwd());
  if (requireInit && !initialized) {
    throw new DocGovError('this repository is not governed yet. Run `docgov setup` (or `docgov review` for an existing documentation tree).');
  }
  const i = inv.inventory(root, cfg);
  const docs = i.documents;
  const { registry, collisions } = reg.build(docs, i.contracts);
  const graph = graphmod.build(docs, registry, cfg, i.contracts);
  return { root, cfg, raw, initialized, inv: i, docs, registry, collisions, graph };
}

export function findingId(f) {
  const basis = `${f.check}:${f.path}:${f.other || ''}`;
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) >>> 0;
  return `${f.check.toUpperCase().replace(/-/g, '')}-${String(h % 10000).padStart(4, '0')}`;
}

/**
 * A clean result has to mean the intended scope was inspected. Anything the sweep could not
 * look at — too deep, unreadable, a symlink it does not follow — is said out loud, because
 * otherwise silence is indistinguishable from compliance.
 */
export function reportIncompleteScan(c) {
  const skipped = c.inv?.scanSkipped || [];
  if (!skipped.length) return;
  say('');
  say(`Scan incomplete — ${plural(skipped.length, 'path')} could not be inspected:`);
  for (const s of skipped.slice(0, 10)) say(`  ${s.path || '(repository root)'} — ${s.reason}`);
  if (skipped.length > 10) say(`  … and ${skipped.length - 10} more`);
}

export function inferMode(root, i) {
  if (exists(path.join(root, 'LICENSE')) || exists(path.join(root, 'LICENSE.md'))) {
    if (exists(path.join(root, 'CONTRIBUTING.md')) || exists(path.join(root, '.github'))) return 'open-source';
  }
  if (exists(path.join(root, 'CODEOWNERS')) || exists(path.join(root, '.github', 'CODEOWNERS'))) return 'team';
  if (i.documents.length > 40 || i.stack.some((s) => s.id === 'kubernetes' || s.id === 'terraform')) return 'team';
  return 'solo';
}

export function projectName(root) {
  const pkg = path.join(root, 'package.json');
  if (exists(pkg)) { try { return JSON.parse(read(pkg)).name || path.basename(root); } catch { /* fall through */ } }
  return path.basename(root);
}

export function packageVersion() {
  try { return JSON.parse(read(new URL('../package.json', import.meta.url))).version; } catch { return '0.0.0'; }
}

export function agentRules(cfg) {
  return read(new URL('../policy/documentation.md', import.meta.url))
    .replace(/\{\{MODE\}\}/g, cfg.project.mode)
    .replace(/\{\{LAYOUT\}\}/g, cfg.project.layout)
    .replace(/\{\{BLOCKING\}\}/g, (cfg.governance.enforce || []).join(', '));
}
