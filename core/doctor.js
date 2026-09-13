import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from './yaml.js';
import * as cfgmod from './config.js';
import * as reg from './registry.js';
import * as supp from './suppressions.js';
import * as inv from './inventory.js';
import { isRepo } from './git.js';
import { isEnabled, enabledLenses, LENSES } from './lenses.js';
import { read, exists } from './util.js';

/**
 * Is DocGov actually working here?
 *
 * A hook is invisible when it works and mystifying when it does not. Nothing tells you a hook
 * never fired — you find out by noticing its absence, weeks later, in the documentation it
 * failed to govern. The same is true of a skill registered under the wrong name, a plugin
 * option the engine never reads, and a rules file that still describes the mode the project
 * had last year.
 *
 * Two of those were real. `plugin.json` advertised three settings and the engine read none of
 * them for two releases, including one that claimed to switch off the only thing leaving the
 * machine. `.claude/rules/documentation.md` is generated but committed, and went stale the
 * first time the project mode changed, because `setup` only rewrites it with `--force`.
 * Neither was caught by any test, because both are agreements between files rather than
 * behaviour of one.
 *
 * So every check here answers a question of the form "does this file still agree with that
 * one", and each one exists because the disagreement it looks for either happened or was one
 * edit away from happening. None of them asks a model anything.
 */

const MIN_NODE = 20;

/** Hook events `bin/docgov` implements. A hooks.json naming anything else fires into a void. */
export const HOOK_EVENTS = ['pre-tool', 'pre-write', 'post-write', 'session-start', 'pre-code-edit', 'stop'];

const ok = (id, message) => ({ id, status: 'ok', message, fix: null });
const warn = (id, message, fix) => ({ id, status: 'warn', message, fix });
const fail = (id, message, fix) => ({ id, status: 'fail', message, fix });

/**
 * @param {{root:string, pluginRoot:string, env?:object}} args
 * @returns {{checks:Array, counts:object, ok:boolean}}
 */
export function run({ root, pluginRoot, env = process.env }) {
  const checks = [
    ...environment(),
    ...install(pluginRoot),
    ...plugin(pluginRoot, env),
    ...repository(root),
  ];
  const counts = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.status] += 1;
  return { checks, counts, ok: counts.fail === 0 };
}

// ───────────────────────────── environment ─────────────────────────────

function environment() {
  const out = [];
  const major = Number(process.versions.node.split('.')[0]);
  out.push(major >= MIN_NODE
    ? ok('node', `Node ${process.versions.node}`)
    : fail('node', `Node ${process.versions.node}; DocGov needs ${MIN_NODE} or later`,
      `install Node ${MIN_NODE}+ — the engine uses language features older versions do not have`));
  return out;
}

// ───────────────────────────── the install itself ─────────────────────────────

function install(pluginRoot) {
  const out = [];
  const at = (...p) => path.join(pluginRoot, ...p);

  // Version skew between the two manifests. They are read by different software — npm and
  // Claude Code — so nothing forces them to agree, and a user reporting a bug quotes one.
  const pkg = readJSON(at('package.json'));
  const manifest = readJSON(at('.claude-plugin', 'plugin.json'));
  if (!pkg || !manifest) {
    out.push(fail('manifests', 'package.json or .claude-plugin/plugin.json is missing or unparseable',
      'reinstall DocGov — this install is incomplete'));
  } else if (pkg.version !== manifest.version) {
    out.push(fail('version-skew', `package.json says ${pkg.version}, plugin.json says ${manifest.version}`,
      'set both to the same version; a user reporting a bug quotes whichever they can see'));
  } else {
    out.push(ok('version', `DocGov ${pkg.version}`));
  }

  // Hooks: registered, parseable, pointing at files that exist, and naming events the CLI
  // implements. An event this binary does not handle is a hook that runs and does nothing.
  const hooksFile = at('hooks', 'hooks.json');
  if (!exists(hooksFile)) {
    out.push(fail('hooks-file', 'hooks/hooks.json is missing', 'reinstall DocGov'));
  } else {
    const h = readJSON(hooksFile);
    if (!h) {
      out.push(fail('hooks-file', 'hooks/hooks.json is not valid JSON', 'reinstall DocGov'));
    } else {
      const commands = [];
      for (const group of Object.values(h.hooks || {})) {
        for (const entry of group || []) {
          for (const hook of entry.hooks || []) if (hook.type === 'command') commands.push(hook.args || []);
        }
      }
      const events = commands.map((args) => args[args.length - 1]);
      const unknown = events.filter((e) => !HOOK_EVENTS.includes(e));
      out.push(unknown.length
        ? fail('hook-events', `hooks.json registers ${unknown.join(', ')}, which this build does not handle`,
          `a hook naming an event the CLI does not implement runs and does nothing; known events: ${HOOK_EVENTS.join(', ')}`)
        : ok('hook-events', `${commands.length} command hook(s) registered, all handled`));

      // `${CLAUDE_PLUGIN_ROOT}/bin/docgov` has to be a real file. It is interpolated by Claude
      // Code, so nothing on this side checks it and a renamed binary fails silently.
      const targets = [...new Set(commands.flatMap((args) => args.filter((a) => String(a).includes('CLAUDE_PLUGIN_ROOT'))))];
      const missing = targets.filter((t) => !exists(path.join(pluginRoot, String(t).replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/?/, ''))));
      out.push(missing.length
        ? fail('hook-targets', `hooks point at files that do not exist: ${missing.join(', ')}`,
          'reinstall DocGov; a hook whose target is missing fails on every write')
        : ok('hook-targets', 'every hook target exists'));
    }
  }

  // Every directory the code imports from has to be in package.json `files`, or the published
  // tarball is a binary importing a directory that is not there. `cli/` was one refactor away
  // from exactly that, and nothing but an install would have shown it.
  if (pkg?.files) {
    const shipped = new Set(pkg.files);
    const needed = ['bin', 'cli', 'core'].filter((d) => exists(at(d)) && !shipped.has(d));
    out.push(needed.length
      ? fail('package-files', `package.json does not publish ${needed.join(', ')}`,
        'the published tarball would be missing code the binary imports; add it to `files`')
      : ok('package-files', 'every source directory is published'));
  }

  // A skill whose `name:` differs from its directory registers under the wrong slash command,
  // or under none. It is the quietest failure in the whole install.
  const skillsDir = at('skills');
  if (exists(skillsDir)) {
    const bad = [];
    for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const f = path.join(skillsDir, d.name, 'SKILL.md');
      if (!exists(f)) { bad.push(`${d.name} (no SKILL.md)`); continue; }
      const declared = (read(f).match(/^name:\s*(.+)$/m) || [])[1]?.trim();
      if (declared !== d.name) bad.push(`${d.name} declares name: ${declared || '(none)'}`);
    }
    out.push(bad.length
      ? fail('skills', `skill name does not match its directory: ${bad.join('; ')}`,
        'the directory name is the slash command; a mismatch registers the skill under the wrong one or not at all')
      : ok('skills', `${fs.readdirSync(skillsDir).length} skill(s), each named for its directory`));
  }

  return out;
}

// ───────────────────────────── the plugin surface ─────────────────────────────

function plugin(pluginRoot, env) {
  const out = [];
  const declared = env.CLAUDE_PLUGIN_ROOT;

  if (!declared) {
    out.push(ok('plugin-root', 'not running under Claude Code (fine — the CLI is fully usable on its own)'));
  } else if (!exists(declared)) {
    out.push(fail('plugin-root', `CLAUDE_PLUGIN_ROOT points at ${declared}, which does not exist`,
      'reinstall the plugin: every hook command is resolved against this path'));
  } else {
    out.push(ok('plugin-root', `CLAUDE_PLUGIN_ROOT → ${declared}`));
  }

  // Every advertised option must be read somewhere. This is the check that would have caught
  // three settings being honoured nowhere for two releases: an option nobody reads is worse
  // than no option, because the user believes they have configured something.
  const manifest = readJSON(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
  const keys = Object.keys(manifest?.userConfig || {});
  if (keys.length) {
    // Every source directory, walked. Scanning a fixed list of two was itself a version of
    // the bug this check exists for: splitting the CLI moved the reader of one option into a
    // directory the scan did not know about, and doctor reported the option as unread.
    const source = sources(pluginRoot).join('\n');
    const unread = keys.filter((k) => !source.includes(`CLAUDE_PLUGIN_OPTION_${k}`)
      && !source.includes(`CLAUDE_PLUGIN_OPTION_${k.toUpperCase()}`));
    out.push(unread.length
      ? fail('plugin-options', `plugin.json advertises ${unread.join(', ')} and nothing reads ${unread.length > 1 ? 'them' : 'it'}`,
        'either read the option or remove it: a setting that silently does nothing is worse than no setting')
      : ok('plugin-options', `${keys.length} option(s) advertised, all read by the engine`));
  }

  return out;
}

// ───────────────────────────── this repository ─────────────────────────────

function repository(root) {
  const out = [];

  out.push(isRepo(root)
    ? ok('git', 'git repository')
    : warn('git', 'not a git repository',
      'drift, impact and `docgov fix` all need git history; everything else works without it'));

  let cfg = null;
  try {
    const loaded = cfgmod.load(root);
    if (!loaded.initialized) {
      out.push(warn('config', 'this repository is not governed yet', 'run `docgov setup`'));
      return out;
    }
    cfg = loaded.cfg;
    out.push(ok('config', `.docgov/config.yaml — mode ${cfg.project.mode}, layout ${cfg.project.layout}`));
  } catch (e) {
    out.push(fail('config', `.docgov/config.yaml did not load: ${e.message}`,
      'fix the YAML, or delete it and run `docgov setup` again'));
    return out;
  }

  // Writable, because every command that records anything writes here and a read-only
  // .docgov/ turns `ignore`, `judge` and `review` into commands that appear to work.
  const dir = path.join(root, '.docgov');
  try {
    const probe = path.join(dir, '.doctor-probe');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    out.push(ok('state-writable', '.docgov/ is writable'));
  } catch (e) {
    out.push(fail('state-writable', `.docgov/ is not writable: ${e.message}`,
      'every command that records a decision writes here'));
  }

  // Every stored artifact must still be readable by this build. `schema.check` refuses a file
  // from a newer DocGov, and finding that out here beats finding it out mid-migration.
  const unreadable = [];
  for (const [label, fn] of [
    ['registry', () => reg.load(root)],
    ['suppressions', () => supp.load(root, cfg)],
  ]) {
    try { fn(); } catch (e) { unreadable.push(`${label}: ${e.message}`); }
  }
  out.push(unreadable.length
    ? fail('artifacts', `stored state could not be read — ${unreadable.join('; ')}`,
      'upgrade DocGov if these were written by a newer build, or rebuild with `docgov registry --rebuild`')
    : ok('artifacts', 'stored state reads cleanly'));

  // A registry entry pointing at a file that is gone means the graph is describing a
  // repository that no longer exists — impact analysis silently under-reports.
  try {
    const registry = reg.load(root);
    const entries = Object.entries(registry.documents || {});
    const gone = entries.filter(([, e]) => !exists(path.join(root, e.path))).map(([id]) => id);
    out.push(gone.length
      ? warn('registry-drift', `${gone.length} registry entr${gone.length === 1 ? 'y points' : 'ies point'} at files that no longer exist: ${gone.slice(0, 5).join(', ')}`,
        'run `docgov registry --rebuild`')
      : ok('registry', `${entries.length} document(s) registered, all present`));
  } catch { /* already reported above */ }

  // The agent rules file is generated but committed, so nothing regenerates it when the
  // config it describes changes. It went stale exactly this way once already.
  const rules = path.join(root, '.claude', 'rules', 'documentation.md');
  if (!exists(rules)) {
    out.push(warn('agent-rules', '.claude/rules/documentation.md is missing',
      'run `docgov setup --rules` — without it, agents in this repository never see the rules'));
  } else {
    const body = read(rules);
    const stale = [];
    if (!body.includes(`\`${cfg.project.mode}\``)) stale.push(`mode is ${cfg.project.mode}`);
    if (!body.includes(`\`${cfg.project.layout}\``)) stale.push(`layout is ${cfg.project.layout}`);
    out.push(stale.length
      ? warn('agent-rules', `.claude/rules/documentation.md disagrees with the config (${stale.join(', ')})`,
        'run `docgov setup --rules` to regenerate it; it is generated but committed, so it does not self-heal')
      : ok('agent-rules', '.claude/rules/documentation.md matches the config'));
  }

  // Which reviews are actually in force. A review that is switched off is not a failure —
  // but silently reviewing less than the user believes is the failure this command exists for,
  // and neither state is visible anywhere else.
  const on = enabledLenses(cfg);
  const leak = isEnabled(cfg, 'leak');
  if (!on.length && !leak) {
    out.push(warn('review', 'both audience review and leak detection are switched off',
      'nothing judges a document here beyond the deterministic checks; set `review:` in .docgov/config.yaml'));
  } else {
    const audience = on.length === Object.keys(LENSES).length ? 'all lenses'
      : on.length ? on.join(', ') : 'off';
    out.push(ok('review', `audience: ${audience} · leak detection: ${leak ? 'on' : 'off'}`));
  }

  // Duplicate ids make the graph ambiguous, which makes every lookup through it a coin toss.
  try {
    const i = inv.inventory(root, cfg);
    const { collisions } = reg.build(i.documents, i.contracts);
    out.push(collisions?.length
      ? fail('duplicate-ids', `${collisions.length} duplicate docgov.id: ${collisions.slice(0, 3).map((c) => c.id ?? c).join(', ')}`,
        'two documents claiming one id make every lookup through the graph ambiguous; `docgov check` names them')
      : ok('ids', 'no duplicate document ids'));
    if (i.scanSkipped?.length) {
      out.push(warn('scan', `${i.scanSkipped.length} path(s) could not be scanned`,
        'run `docgov check` to see them; a clean result over an incomplete scan is the worst output a governance tool can give'));
    }
  } catch (e) {
    out.push(fail('inventory', `the repository could not be scanned: ${e.message}`, 'report this'));
  }

  const sup = supp.load(root, cfg);
  const expired = (sup.suppressions || []).filter((s) => s.expires && s.expires < new Date().toISOString().slice(0, 10));
  if (expired.length) {
    out.push(warn('suppressions', `${expired.length} suppression(s) expired`,
      'they are no longer in effect; renew them or fix what they were hiding'));
  }

  return out;
}

// ───────────────────────────── helpers ─────────────────────────────

function readJSON(file) {
  try { return JSON.parse(read(file)); } catch { return null; }
}
function safeRead(file) {
  try { return read(file); } catch { return ''; }
}

/** Every `.js` file DocGov ships, wherever it lives. */
function sources(pluginRoot, dirs = ['bin', 'core', 'cli']) {
  const out = [];
  const walk = (abs) => {
    let entries = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(safeRead(p));
    }
  };
  for (const d of dirs) walk(path.join(pluginRoot, d));
  return out;
}

/**
 * Where this install lives, whatever it was invoked as.
 *
 * Anchored to this module rather than to the caller's `import.meta.url`. It used to take the
 * caller's, which was correct only while the caller was `bin/docgov` — moving the command into
 * `cli/commands/` silently resolved the root one directory too deep, and doctor then reported
 * its own install as broken. `core/doctor.js` is always exactly one directory below the root,
 * so this is the one location that cannot drift.
 */
export function pluginRootOf() {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

/** Parse YAML without throwing, for checks that only care whether it parses. */
export function parses(text) {
  try { yaml.parse(text); return true; } catch { return false; }
}
