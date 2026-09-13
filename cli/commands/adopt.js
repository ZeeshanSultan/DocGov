/**
 * Turning DocGov on, and bringing an existing repository under it: look at what is there,
 * propose a plan, execute the plan, annotate what is left.
 */
import path from 'node:path';
import fs from 'node:fs';
import * as cfgmod from '../../core/config.js';
import * as reg from '../../core/registry.js';
import * as graphmod from '../../core/graph.js';
import * as onboardmod from '../../core/onboard.js';
import * as migratemod from '../../core/migrate.js';
import * as tpl from '../../core/templates.js';
import * as inv from '../../core/inventory.js';
import * as git from '../../core/git.js';
import * as fm from '../../core/frontmatter.js';
import { Document } from '../../core/document.js';
import { classify, destinationFor } from '../../core/classify.js';
import { FULL_NAMESPACES, COMPACT_NAMESPACES } from '../../core/taxonomy.js';
import { EXIT, DocGovError, table, write, read, exists, plural } from '../../core/util.js';
import { emit, json, say, warn } from '../output.js';
import { list } from '../parse.js';
import { agentRules, ctx, inferMode, projectName } from '../context.js';

export function cmdSetup(flags) {
  const { root, initialized } = cfgmod.load(process.cwd());

  // `.claude/rules/documentation.md` is generated from the config but committed, so nothing
  // regenerates it when the config it describes changes — it went stale the first time this
  // project's mode did. Rewriting it needed `--force`, which also overwrites config.yaml and
  // takes every registration and domain with it: the repair was more destructive than the
  // fault. It has its own door now, and `doctor` sends people through that one.
  if (flags.rules) {
    if (!initialized) throw new DocGovError('this repository is not governed yet. Run `docgov setup` first.');
    const { cfg: current } = cfgmod.load(root);
    const at = path.join(root, '.claude', 'rules', 'documentation.md');
    write(at, agentRules(current));
    if (json()) return emit({ regenerated: '.claude/rules/documentation.md' }) ?? EXIT.OK;
    say(`Regenerated .claude/rules/documentation.md for mode ${current.project.mode}, layout ${current.project.layout}.`);
    return EXIT.OK;
  }

  if (initialized && !flags.force) throw new DocGovError('already initialized. Pass --force to rewrite .docgov/config.yaml.');

  const i = inv.inventory(root, cfgmod.defaults());
  const mode = flags.mode || inferMode(root, i);
  const layout = flags.layout || (i.documents.length > 25 ? 'full' : 'compact');
  const visibility = flags.visibility || (exists(path.join(root, 'LICENSE')) ? 'mixed' : 'internal');

  // Adoption ramp: a repository with documentation that predates DocGov would otherwise
  // fail CI the moment governance is switched on, which is how a governance tool earns
  // its uninstall. Start in warn-only and tell the user when to turn it off.
  const preexisting = i.documents.filter((d) => !d.frontmatter?.docgov).length;
  const warnOnly = preexisting > 0 && mode !== 'solo';

  const raw = {
    version: 1,
    project: { name: projectName(root), mode, visibility, layout },
    documentation: { root: 'docs' },
    governance: {
      canonical_changes_require_review: mode !== 'solo',
      prevent_duplicate_domains: true,
      ...(warnOnly ? { warn_only: true } : {}),
    },
    drift: { enabled: true },
    generated: { allow_manual_edit: false },
    domains: {},
  };
  cfgmod.save(root, raw);

  const { cfg } = cfgmod.load(root);
  const made = [];
  for (const dir of layout === 'full' ? FULL_NAMESPACES : COMPACT_NAMESPACES) {
    const abs = path.join(root, dir);
    if (!exists(abs)) { fs.mkdirSync(abs, { recursive: true }); made.push(dir); }
  }

  const rulesPath = path.join(root, '.claude', 'rules', 'documentation.md');
  if (!exists(rulesPath) || flags.force) { write(rulesPath, agentRules(cfg)); made.push('.claude/rules/documentation.md'); }

  const { registry } = reg.build(i.documents, i.contracts);
  reg.save(root, registry);
  graphmod.save(root, graphmod.build(i.documents, registry, cfg, i.contracts));

  if (json()) return emit({ initialized: true, mode, layout, visibility, created: made }) ?? EXIT.OK;
  say(`Initialized DocGov in ${root}`);
  say(`  mode       ${mode}      (${cfgmod.MODE_PROFILES[mode].block.length} rules block, the rest warn)`);
  say(`  layout     ${layout}`);
  say(`  visibility ${visibility}`);
  say(`  documents  ${i.documents.length} found, ${i.contracts.length} machine contract(s)`);
  say('');
  say('Created:');
  for (const m of made.slice(0, 12)) say(`  ${m}`);
  if (made.length > 12) say(`  … and ${made.length - 12} more namespaces`);
  say('');
  if (warnOnly) {
    say(`warn_only is on because ${preexisting} document(s) predate DocGov — nothing will block yet.`);
    say('Run `docgov review`, then `docgov fix`, then remove `warn_only` from .docgov/config.yaml.');
    say('');
  }
  say(i.documents.length > 2
    ? 'Next: `docgov review` to classify what is already here.'
    : 'Next: `docgov create user.readme` or `docgov check`.');
  if (git.isRepo(root) && !git.isClean(root)) {
    say('');
    say('Commit this before running `docgov fix` — it needs a clean tree so it stays revertible:');
    say('  git add -A && git commit -m "chore: adopt DocGov"');
  }
  return EXIT.OK;
}

export function cmdReview(flags) {
  const c = ctx({ requireInit: false });
  if (!c.initialized) {
    say('Not initialized — running `docgov setup` with inferred settings first.\n');
    cmdSetup();
    return cmdReview();
  }
  const planData = onboardmod.plan(c);
  const md = onboardmod.render(planData, c.cfg);
  write(path.join(c.root, onboardmod.PLAN_PATH), md + '\n');
  write(path.join(c.root, onboardmod.PLAN_DATA_PATH), JSON.stringify(planData, null, 2) + '\n');

  if (json()) return emit({ plan: onboardmod.PLAN_PATH, data: onboardmod.PLAN_DATA_PATH, ...planData }) ?? EXIT.OK;
  const s = planData.summary;
  say('DocGov review');
  say('─────────────');
  say(`${plural(s.documents, 'document')} inventoried · ${plural(planData.contracts.length, 'machine contract')} · stack: ${planData.stack.map((x) => x.id).join(', ') || 'none detected'}`);
  say('');
  say(table([
    { Finding: 'unclassified', Count: s.unclassified },
    { Finding: 'low-confidence classification', Count: s.lowConfidence },
    { Finding: 'moves proposed', Count: s.moves },
    { Finding: 'frontmatter to add', Count: s.annotations },
    { Finding: 'split candidates', Count: s.splits },
    { Finding: 'README extractions', Count: s.extracts },
    { Finding: 'suspected duplicates', Count: s.merges },
    { Finding: 'documents to archive', Count: s.archives },
    { Finding: 'missing documents', Count: s.creates },
    { Finding: 'broken internal links', Count: s.brokenLinks },
    { Finding: 'destination collisions', Count: s.collisions || 0 },
  ], ['Finding', 'Count']));
  say('');
  say(`Plan written to ${onboardmod.PLAN_PATH} — nothing has changed.`);
  say(`${s.needJudgement} of ${planData.actions.length} actions need a judgement call.`);
  if (s.collisions) {
    say('');
    say(`${plural(s.collisions, 'destination collision')} — \`docgov fix\` will refuse until resolved.`);
    for (const c of planData.collisions.slice(0, 5)) say(`  ${c.reason.replace(/`/g, '')}`);
    if (planData.collisions.length > 5) say(`  … and ${planData.collisions.length - 5} more`);
  }
  say('');
  say('Read the plan. To drop an action, pass its id: docgov fix --skip DG-01234');
  say('Then: docgov fix --dry-run');
  return EXIT.OK;
}

export function cmdFix(flags) {
  const c = ctx();
  const planData = onboardmod.loadPlan(c.root);
  if (!planData) throw new DocGovError('no fix plan found. Run `docgov review` first.');
  const dryRun = flags.dry_run === true || flags.dry === true;

  // A plan is a list of file operations computed against a particular set of documents.
  // Executing it against a different set is how a migration destroys something, and with a
  // main agent and subagents in one repository that is ordinary rather than exotic: one
  // agent writes documentation while another is still holding a plan that predates it.
  const drift = onboardmod.planDrift(planData, c.docs);
  if (drift && flags.force !== true) {
    const name = (xs, label) => (xs.length ? [`  ${xs.length} ${label}:`, ...xs.slice(0, 5).map((x) => `    ${x}`),
      ...(xs.length > 5 ? [`    … and ${xs.length - 5} more`] : [])] : []);
    throw new DocGovError([
      'the documentation has changed since this plan was written, so the plan no longer',
      'describes this repository.',
      ...name(drift.added, 'added'),
      ...name(drift.removed, 'removed'),
      ...name(drift.modified, 'modified'),
      '',
      'Run `docgov review` again and read the new plan. `--force` runs this one anyway, on',
      'the understanding that its destinations were computed for documents that have moved.',
    ].join('\n'));
  }

  const include = list(flags.include);
  const skip = flags.skip ? list(flags.skip) : [];
  const useGit = flags.no_git !== true;

  let branch = null;
  if (!dryRun && useGit && git.isRepo(c.root) && flags.no_branch !== true) {
    branch = typeof flags.branch === 'string' ? flags.branch : `docgov/migration-${new Date().toISOString().slice(0, 10)}`;
    if (git.revParse(c.root, branch)) say(`Branch ${branch} already exists — committing onto it.`);
    else git.createBranch(c.root, branch);
  }

  const result = migratemod.migrate({ root: c.root, cfg: c.cfg, docs: c.docs, planData, dryRun, include, skip, branch, useGit });

  if (!dryRun) {
    const after = ctx();
    const problems = migratemod.verify({ root: after.root, docs: after.docs, inv: after.inv });
    reg.save(after.root, reg.build(after.docs, after.inv.contracts).registry);
    graphmod.save(after.root, after.graph);
    result.verification = problems;
    if (problems.length && flags.keep !== true && useGit && git.isRepo(c.root)) {
      result.aborted = true;
      migratemod.abort(c.root);
    } else if (flags.commit === true) {
      git.add(c.root, ['.']);
      git.commit(c.root, `docs: migrate documentation to the DocGov taxonomy\n\n${result.moved} moved, ${result.annotated} annotated, ${result.linksRepaired} link sets repaired.`);
      result.committed = true;
    }
  }

  if (json()) return emit(result) ?? (result.aborted ? EXIT.VIOLATION : EXIT.OK);
  say(dryRun ? 'Migration plan (dry run — nothing changed)' : 'Migration');
  say('─'.repeat(42));
  for (const op of result.ops.slice(0, 60)) {
    if (op.op === 'move') say(`  MOVE   ${op.from}\n         → ${op.to}${op.rewroteLinks ? '   (links repaired)' : ''}${op.annotated ? '   (frontmatter added)' : ''}`);
    else if (op.op === 'edit') say(`  EDIT   ${op.path}${op.rewroteLinks ? '   (links repaired)' : ''}${op.annotated ? '   (frontmatter added)' : ''}`);
    else say(`  MKDIR  ${op.path}   (${op.type})`);
  }
  if (result.ops.length > 60) say(`  … and ${result.ops.length - 60} more operations`);
  say('');
  say(`${result.moved} moved · ${result.edited} edited in place · ${result.annotated} annotated · ${result.linksRepaired} documents had links repaired`);
  if (branch) say(`Branch: ${branch}`);
  if ((result.skipped || []).length) {
    say('');
    say(`Left alone — DocGov could not read their frontmatter (${result.skipped.length}):`);
    for (const sk of result.skipped.slice(0, 10)) say(`  ${sk.path}\n    ${sk.reason}`);
    if (result.skipped.length > 10) say(`  … and ${result.skipped.length - 10} more`);
    say('Everything else was migrated. Fix the frontmatter and re-run to pick them up.');
  }

  if (result.deferred.length) {
    say('');
    say(`Deferred to /docgov:tag (these rewrite prose, so an agent does them with you): ${result.deferred.length}`);
    for (const d of result.deferred.slice(0, 8)) say(`  ${d.kind.padEnd(8)} ${d.path || d.to}`);
  }
  if (result.verification?.length) {
    say('');
    say(result.aborted
      ? `Verification failed with ${result.verification.length} problem(s) — migration reverted with git reset --hard.`
      : `Verification found ${result.verification.length} problem(s):`);
    for (const p of result.verification.slice(0, 10)) say(`  ${p.kind}  ${p.path}${p.target ? ` → ${p.target}` : ''}`);
    return result.aborted ? EXIT.VIOLATION : EXIT.REVIEW;
  }
  if (!dryRun) say('\nVerified: no broken links, no duplicate ids.');
  return EXIT.OK;
}

export function cmdTag(flags) {
  const c = ctx();
  const apply = flags.apply === true;
  const only = flags.path ? [String(flags.path)] : null;
  const docs = only ? c.docs.filter((d) => only.includes(d.path)) : c.docs;
  const changes = [];
  for (const d of docs) {
    const res = classify(d);
    if (res.type === 'unknown') { changes.push({ path: d.path, action: 'needs-classification' }); continue; }
    const needsMeta = !d.externallyRegistered && (!d.registered || !d.meta.type || !d.meta.visibility);
    const dest = destinationFor(c.cfg, res.type, d.path, d);
    if (!needsMeta && dest === d.path) continue;
    const entry = { path: d.path, action: needsMeta ? 'annotate' : 'move', type: res.type, destination: dest };
    if (apply && needsMeta) {
      const meta = tpl.frontmatterFor({ type: res.type, id: d.meta.id || d.id, title: d.title, cfg: c.cfg,
        domain: d.domain, visibility: d.meta.visibility, owner: d.owner });
      write(path.join(c.root, d.path), fm.patchDocgov(d.source, meta));
      entry.applied = true;
    }
    changes.push(entry);
  }
  if (apply) {
    const after = ctx();
    reg.save(after.root, reg.build(after.docs, after.inv.contracts).registry);
    graphmod.save(after.root, after.graph);
  }
  if (json()) return emit({ applied: apply, changes }) ?? EXIT.OK;
  if (!changes.length) { say('Every document is classified, annotated and in the right place.'); return EXIT.OK; }
  say(table(changes.map((x) => ({ Document: x.path, Action: x.action, Type: x.type || '', Destination: x.destination || '' })),
    ['Document', 'Action', 'Type', 'Destination']));
  say('');
  say(apply ? 'Frontmatter applied. Moves are handled by `docgov fix` so they stay transactional.'
            : 'Pass --apply to write frontmatter. Moves go through `docgov review` + `docgov fix`.');
  return EXIT.OK;
}
