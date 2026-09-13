import path from 'node:path';
import * as yaml from './yaml.js';
import { TYPES, MODES, VISIBILITY_PATHS, GENERATED_PATHS } from './taxonomy.js';
import { read, exists, write, merge, DocGovError, findRepoRoot } from './util.js';

export const CONFIG_PATH = '.docgov/config.yaml';

/**
 * Enforcement profiles per project mode (PRD §9).
 * `block` lists rule ids that may fail a write or CI; everything else warns.
 * Over-enforcement is the product's main failure mode, so solo blocks almost nothing.
 */
export const MODE_PROFILES = {
  solo: {
    block: ['generated-edit', 'duplicate-id', 'invalid-yaml'],
    require_owner: false, require_review: false, classify_new_files: true,
  },
  team: {
    block: ['generated-edit', 'duplicate-id', 'invalid-yaml', 'missing-frontmatter',
      'unknown-reference', 'broken-link', 'wrong-location'],
    require_owner: true, require_review: true, classify_new_files: true,
  },
  enterprise: {
    block: ['generated-edit', 'duplicate-id', 'invalid-yaml', 'missing-frontmatter',
      'unknown-reference', 'broken-link', 'wrong-location', 'visibility-path',
      'missing-sections', 'hard-limit', 'frozen-edit', 'missing-visibility'],
    require_owner: true, require_review: true, classify_new_files: true,
  },
  'open-source': {
    block: ['generated-edit', 'duplicate-id', 'invalid-yaml', 'broken-link', 'visibility-path'],
    require_owner: false, require_review: true, classify_new_files: true,
  },
};

function defaultLimits() {
  const limits = {};
  for (const [id, t] of Object.entries(TYPES)) {
    if (t.soft || t.hard) limits[id] = { soft_lines: t.soft, hard_lines: t.hard };
  }
  return limits;
}

function defaultQuality() {
  const q = {};
  for (const [id, t] of Object.entries(TYPES)) if (t.quality) q[id] = t.quality;
  return q;
}

export function defaults() {
  return {
    version: 1,
    project: { name: null, mode: 'solo', visibility: 'internal', layout: 'compact' },
    documentation: {
      root: 'docs',
      include: ['**/*.md', '**/*.mdx'],
      // Agent infrastructure is instructions, not documentation. Governing it would
      // make DocGov police the files that configure DocGov.
      exclude: ['.claude/**', '.docgov/**', '**/node_modules/**', '**/SKILL.md',
        '.github/ISSUE_TEMPLATE/**', '**/PULL_REQUEST_TEMPLATE.md', '**/CHANGELOG_UNRELEASED.md'],
    },
    governance: {
      canonical_changes_require_review: true,
      prevent_duplicate_domains: true,
      enforce: null,            // null = derive from mode profile
      warn_only: false,
      max_new_root_docs: 0,     // new top-level *.md beyond the allowlist below
      // Project-level artifacts that legitimately live at the repository root. A repository
      // whose own specification is a root document should say so here rather than be nagged
      // about it on every check.
      allowed_root_docs: ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md',
        'CLAUDE.md', 'AGENTS.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md', 'LICENSE.md'],
    },
    limits: defaultLimits(),
    quality: defaultQuality(),
    visibility_paths: VISIBILITY_PATHS,
    generated_paths: GENERATED_PATHS,
    drift: { enabled: true, stale_threshold: 60, lookback: '30 days ago' },
    generated: { allow_manual_edit: false },
    contracts: { openapi: ['openapi/**/*.{yaml,yml,json}', 'api/**/openapi.{yaml,yml,json}'] },
    domains: {},                // domain -> { paths: [...], docs: [...], owner }
    policy_packs: [],           // V3: paths or file: URLs merged over defaults
    suppressions_file: '.docgov/suppressions.yaml',
  };
}

/** @returns {{root:string, raw:object, cfg:object, initialized:boolean}} */
export function load(cwd = process.cwd()) {
  const root = findRepoRoot(cwd);
  const file = path.join(root, CONFIG_PATH);
  let raw = {};
  const initialized = exists(file);
  if (initialized) {
    try { raw = yaml.parse(read(file)) || {}; }
    catch (e) { throw new DocGovError(`${CONFIG_PATH} is not valid: ${e.message}`); }
  }
  let cfg = merge(defaults(), raw);

  for (const p of cfg.policy_packs || []) {
    const abs = path.isAbsolute(p) ? p : path.join(root, p);
    const packFile = exists(path.join(abs, 'policy.yaml')) ? path.join(abs, 'policy.yaml') : abs;
    if (!exists(packFile)) throw new DocGovError(`policy pack not found: ${p}`);
    let pack;
    try { pack = yaml.parse(read(packFile)) || {}; }
    catch (e) { throw new DocGovError(`policy pack ${p} is not valid: ${e.message}`); }
    // Packs layer under local config: org sets the floor, repo keeps the last word.
    cfg = merge(merge(cfg, pack), raw);
  }

  if (!MODES.includes(cfg.project.mode))
    throw new DocGovError(`project.mode must be one of ${MODES.join(', ')} (got ${cfg.project.mode})`);

  // A Claude Code plugin's own components are payload, not documentation. Governing them
  // would make DocGov police the skills, agents and templates that implement DocGov.
  if (exists(path.join(root, '.claude-plugin', 'plugin.json'))) {
    const payload = ['skills/**', 'agents/**', 'hooks/**', 'templates/**', 'lenses/**',
      'rules/**', 'commands/**', 'output-styles/**', 'workflows/**'];
    const ex = cfg.documentation.exclude || [];
    cfg.documentation.exclude = [...new Set([...ex, ...payload])];
  }

  const profile = MODE_PROFILES[cfg.project.mode];
  cfg.governance.enforce = cfg.governance.enforce || profile.block;
  cfg.profile = profile;
  return { root, raw, cfg, initialized, file };
}

export function save(root, raw) {
  return write(path.join(root, CONFIG_PATH), yaml.stringify(raw));
}

/** Does this rule id block, given mode + warn_only? */
export function blocks(cfg, ruleId) {
  if (cfg.governance.warn_only) return false;
  return (cfg.governance.enforce || []).includes(ruleId);
}

export function limitFor(cfg, type) {
  const l = (cfg.limits || {})[type] || {};
  const t = TYPES[type] || {};
  return { soft: l.soft_lines ?? t.soft ?? 0, hard: l.hard_lines ?? t.hard ?? 0 };
}

export function qualityFor(cfg, type) {
  return (cfg.quality || {})[type] ?? (TYPES[type] || {}).quality ?? 0;
}

/** Canonical directory or file for a type under the active layout. */
export function locationFor(cfg, type) {
  const t = TYPES[type] || TYPES.unknown;
  const loc = cfg.project.layout === 'full' ? t.full : (t.compact || t.full);
  return loc;
}
