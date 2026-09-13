import path from 'node:path';
import * as schema from './schema.js';
import { classify, destinationFor } from './classify.js';
import { TYPES, AUTHORITY, typeDef } from './taxonomy.js';
import { similarPairs } from './similarity.js';
import { coverageGaps } from './inventory.js';
import { assess, readmeOverreach, splitCandidates } from './size.js';
import { brokenLinks } from './links.js';
import { primaryAuthor, isRepo, isClean, lastCommitDate, headSha } from './git.js';
import { locationFor } from './config.js';
import { matchAny, table, plural, exists, read, DocGovError, sha } from './util.js';

/**
 * Existing-project review (PRD §15, §44).
 *
 * The hard rule: this produces a plan and changes nothing. The plan is a file a
 * human reads and edits; `docgov fix` executes exactly what the plan says.
 * Separating proposal from execution is what makes the "without losing
 * information" promise checkable rather than aspirational.
 */

export const PLAN_PATH = '.docgov/fix-plan.md';
export const PLAN_DATA_PATH = '.docgov/fix-plan.json';

/**
 * Read back the plan `review` wrote, checking its version before anything acts on it.
 *
 * The plan is the one artifact DocGov both writes and reads, and it is the one whose
 * misreading actually moves files. It has declared `version` since before the field was
 * enforced anywhere — and nothing looked at it, so a plan from a newer DocGov would have
 * been executed on a guess. Both readers (`fix` and `inspect contradictions`) route through
 * here so neither can skip the check.
 *
 * @returns {object|null} the plan, or null if none has been written yet
 */
export function loadPlan(root) {
  const file = path.join(root, PLAN_DATA_PATH);
  if (!exists(file)) return null;
  let data;
  try { data = JSON.parse(read(file)); }
  catch (e) { throw new DocGovError(`${PLAN_DATA_PATH} is not valid JSON: ${e.message}. Run \`docgov review\` to rewrite it.`); }
  return schema.check('plan', data, PLAN_DATA_PATH);
}

/**
 * @param {{root:string, cfg:object, docs:any[], inv:object, graph:any, registry:object}} ctx
 */
export function plan({ root, cfg, docs, inv, graph, registry }) {
  const actions = [];
  const classifications = [];
  const gitAvailable = isRepo(root);

  for (const d of docs) {
    const c = classify(d);
    const owner = d.owner || (gitAvailable ? (primaryAuthor(root, d.path)?.name ?? null) : null);
    const lastChanged = gitAvailable ? lastCommitDate(root, d.path) : null;
    classifications.push({
      path: d.path, current: d.type, proposed: c.type, confidence: c.confidence,
      needsReview: c.needsReview, signals: c.signals.slice(0, 3), candidates: c.candidates,
      owner, lastChanged, lines: d.lines, registered: d.registered,
      // What this document said when the plan was computed. `fix` compares these to say
      // which documents moved underneath it, rather than only that something did.
      digest: sha(d.raw ?? d.body ?? ''),
    });

    const archived = matchAny(d.path, ['docs/99-archive/**', 'docs/archive/**']);
    const target = archived ? d.path : destinationFor(cfg, c.type, d.path, d);

    if (c.type === 'unknown') {
      actions.push({ kind: 'CLASSIFY', path: d.path, reason: 'no classification signal matched',
        risk: 'low', requiresJudgement: true });
    } else if (target !== d.path) {
      actions.push({ kind: 'MOVE', path: d.path, to: target, type: c.type,
        reason: `a ${typeDef(c.type).label} belongs in ${locationFor(cfg, c.type)}`,
        risk: c.needsReview ? 'medium' : 'low', requiresJudgement: c.needsReview });
    }
    if (!d.registered) {
      actions.push({ kind: 'ANNOTATE', path: d.path, to: target, type: c.type,
        reason: 'no docgov frontmatter; add id, type, authority, visibility',
        risk: 'low', requiresJudgement: false });
    }

    const size = assess(cfg, d);
    if (size.recommendSplit) {
      actions.push({ kind: 'SPLIT', path: d.path, type: c.type, risk: 'high', requiresJudgement: true,
        reason: `${d.lines} lines across ${size.independentConcepts} independently addressable concepts`,
        into: size.candidates.map((s) => ({ title: s.title, lines: s.lines,
          to: path.posix.join(stripFile(target), s.suggested) })) });
    }
    for (const r of readmeOverreach(cfg, d)) {
      actions.push({ kind: 'EXTRACT', path: d.path, section: r.section, lines: r.lines,
        to: r.moveTo ? locationFor(cfg, r.moveTo) : null, type: r.moveTo,
        reason: `README section "${r.section}" is ${r.lines} lines; a README links depth, it does not contain it`,
        risk: 'medium', requiresJudgement: true });
    }
    if (d.status === 'deprecated' || d.status === 'superseded' || /^(old|deprecated|legacy)[-_/]/i.test(d.path)) {
      if (!archived) actions.push({ kind: 'ARCHIVE', path: d.path,
        to: `${cfg.project.layout === 'full' ? 'docs/99-archive' : 'docs/archive'}/${path.basename(d.path)}`,
        reason: `status is ${d.status}`, risk: 'low', requiresJudgement: false });
    }
  }

  const duplicates = similarPairs(docs, { threshold: 0.5, limit: 25 });
  for (const p of duplicates) {
    if (p.score < 0.72) continue;
    actions.push({ kind: 'MERGE', path: p.a, other: p.b, score: p.score, risk: 'high', requiresJudgement: true,
      reason: `${Math.round(p.score * 100)}% textual overlap${p.reasons.length ? ` (${p.reasons.join(', ')})` : ''}` });
  }

  const gaps = coverageGaps(inv);
  for (const g of gaps) {
    actions.push({ kind: 'CREATE', type: g.type, to: locationFor(cfg, g.type), risk: 'low',
      requiresJudgement: false,
      reason: g.because === 'baseline'
        ? 'every repository should have this'
        : `${g.because} detected (${g.evidence}) but no ${g.label} exists` });
  }

  const broken = brokenLinks(docs, root, new Set(inv.all));

  const contradictionCandidates = duplicates
    .filter((p) => p.score >= 0.5)
    .map((p) => {
      const a = docs.find((d) => d.path === p.a), b = docs.find((d) => d.path === p.b);
      const ra = AUTHORITY[a?.authority]?.rank ?? 9, rb = AUTHORITY[b?.authority]?.rank ?? 9;
      return { ...p, authorityA: a?.authority, authorityB: b?.authority,
        sameAuthority: ra === rb,
        note: ra === rb ? 'equal authority — a contradiction here has no tie-break'
          : `${ra < rb ? p.a : p.b} wins a contradiction` };
    });

  // Two documents sharing a basename in different directories both resolve to
  // `<canonical dir>/<basename>`, so the destination rule collides with itself: one
  // repository produced 29 of these, which made its whole plan unrunnable. Where the
  // class has a directory to put things in, keep enough of the source path to tell them
  // apart — `core/docs/policy.md` becomes `…/policies/core/policy.md` rather than
  // fighting `how-tos-site/…/policy.md` for `…/policies/policy.md`. The leading segment
  // is used because in a monorepo it names the module the document belongs to.
  const moved = new Set(actions.filter((x) => x.kind === 'MOVE' && x.to && x.to !== x.path)
    .map((x) => x.path));
  const taken = new Set(docs.map((d) => d.path).filter((x) => !moved.has(x)));
  const byDest = new Map();
  for (const a of actions) {
    if (!(a.kind === 'MOVE' && a.to && a.to !== a.path)) continue;
    if (!byDest.has(a.to)) byDest.set(a.to, []);
    byDest.get(a.to).push(a);
  }
  for (const [dest, group] of byDest) {
    // Occupied when something is already there that is not itself leaving.
    const occupied = taken.has(dest) || (exists(path.join(root, dest)) && !moved.has(dest));
    if (group.length === 1 && !occupied) { taken.add(dest); continue; }

    const loc = locationFor(cfg, group[0].type);
    if (!loc || !loc.endsWith('/')) {
      // A fixed path — a single-document class. At most one document can hold it, and if
      // something is already there that is staying, none of these may. The rest are left
      // exactly where they are rather than moved onto each other.
      const keep = occupied ? null : group[0];
      for (const a of group) {
        if (a === keep) { taken.add(dest); continue; }
        a.kind = 'CLASSIFY'; a.to = a.path; a.requiresJudgement = true; a.risk = 'medium';
        a.reason = `\`${dest}\` holds one document and is already claimed — left in place for you to decide`;
      }
      continue;
    }

    // A directory class: keep enough of the source path to tell them apart. The leading
    // segment is used because in a monorepo it names the module the document belongs to.
    for (const a of group) {
      if (group.length === 1 && !occupied) { taken.add(dest); continue; }
      const base = path.posix.basename(a.path);
      const segs = path.posix.dirname(a.path).split('/').filter((x) => x && x !== '.');
      let picked = null;
      for (let n = 1; n <= segs.length && !picked; n++) {
        const cand = `${loc}${segs.slice(0, n).join('/')}/${base}`;
        if (!taken.has(cand) && !(exists(path.join(root, cand)) && !moved.has(cand))) picked = cand;
      }
      if (picked) { a.to = picked; a.disambiguated = true; taken.add(picked); }
    }
  }

  // Destination collisions, found while the plan is still a plan. `migrate` refuses to
  // execute these — two documents at one path would destroy one of them — but it only
  // discovers them at execution, after the user has read the plan and decided to trust
  // it. A plan that cannot run should say so on the page where it is approved.
  const collisions = [];
  const claimed = new Map();
  const moving = new Set(actions.filter((a) => (a.kind === 'MOVE' || a.kind === 'ARCHIVE')
    && a.to && a.to !== a.path).map((a) => a.path));
  for (const a of actions) {
    if (!((a.kind === 'MOVE' || a.kind === 'ARCHIVE') && a.to && a.to !== a.path)) continue;
    if (claimed.has(a.to)) {
      collisions.push({ kind: 'two-documents', to: a.to, paths: [claimed.get(a.to), a.path],
        reason: `\`${claimed.get(a.to)}\` and \`${a.path}\` both want \`${a.to}\`` });
      a.requiresJudgement = true; a.risk = 'high';
      const other = actions.find((x) => x.path === claimed.get(a.to) && x.kind === a.kind);
      if (other) { other.requiresJudgement = true; other.risk = 'high'; }
    } else if (exists(path.join(root, a.to)) && !moving.has(a.to)) {
      collisions.push({ kind: 'onto-existing', to: a.to, paths: [a.path],
        reason: `\`${a.to}\` already exists and is not itself being moved` });
      a.requiresJudgement = true; a.risk = 'high';
    }
    claimed.set(a.to, a.path);
  }

  // A stable id per action, so a human can drop one without editing either artifact.
  // The rendered plan used to say "delete any action you disagree with", but `fix` reads
  // the JSON: deleting from the Markdown changed nothing and every action still ran.
  for (const a of actions) {
    const basis = `${a.kind}:${a.path}:${a.to || ''}`;
    let h = 0;
    for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) >>> 0;
    a.id = `DG-${String(h % 100000).padStart(5, '0')}`;
  }

  for (const a of actions) a.tier = tierOf(a);

  const summary = {
    documents: docs.length,
    unclassified: classifications.filter((c) => c.proposed === 'unknown').length,
    lowConfidence: classifications.filter((c) => c.needsReview && c.proposed !== 'unknown').length,
    moves: actions.filter((a) => a.kind === 'MOVE').length,
    annotations: actions.filter((a) => a.kind === 'ANNOTATE').length,
    splits: actions.filter((a) => a.kind === 'SPLIT').length,
    extracts: actions.filter((a) => a.kind === 'EXTRACT').length,
    merges: actions.filter((a) => a.kind === 'MERGE').length,
    archives: actions.filter((a) => a.kind === 'ARCHIVE').length,
    creates: actions.filter((a) => a.kind === 'CREATE').length,
    brokenLinks: broken.length,
    collisions: collisions.length,
    duplicateCandidates: duplicates.length,
    needJudgement: actions.filter((a) => a.requiresJudgement).length,
    highRisk: actions.filter((a) => a.risk === 'high').length,
    safe: actions.filter((a) => a.tier === 'safe').length,
    confident: actions.filter((a) => a.tier === 'confident').length,
    review: actions.filter((a) => a.tier === 'review').length,
  };

  return {
    version: schema.SCHEMA.plan, generated: new Date().toISOString(),
    layout: cfg.project.layout, mode: cfg.project.mode,
    git: { repo: gitAvailable, clean: gitAvailable ? isClean(root) : false },
    // The repository this plan describes. A plan is a list of file operations computed
    // against a particular set of documents, and executing it against a different set is how
    // a migration destroys something — two agents in one repository make that ordinary
    // rather than exotic. `fix` refuses a plan whose fingerprint no longer matches.
    fingerprint: fingerprintOf(root, docs, gitAvailable),
    summary, classifications, actions, duplicates, contradictionCandidates, gaps, brokenLinks: broken,
    collisions,
    scopes: (inv.scopes || []).map((s) => ({ name: s.name, prefix: s.prefix, declared: s.declared })),
    stack: inv.stack.map((s) => ({ id: s.id, evidence: s.evidence[0], count: s.count })),
    contracts: inv.contracts,
    agentInstructions: inv.agentInstructions,
  };
}

/**
 * How much of itself a reader has to check.
 *
 * A two-thousand-line plan presented as one list reads as "this tool wants to rewrite my
 * repository", and the reader cannot tell the mechanical nine tenths from the tenth that
 * needs them without going line by line. The question they are actually asking is not "what
 * kind of action is this" — it is "do I have to decide anything about it".
 *
 *   safe       nothing moves. Frontmatter added, documents created. Reversible by deleting.
 *   confident  a file moves, and DocGov is sure where to. Reversible, but visible in the diff
 *              and in anything holding a path — so it is worth a glance even though nothing
 *              here is a guess.
 *   review     somebody has to decide. A classification with no clear winner, or prose that
 *              has to be rewritten. `fix` never does these on its own.
 *
 * The tier is derived, not declared: `requiresJudgement` was already on every action and the
 * kinds that rewrite prose were already known. Nothing here changes what `fix` executes.
 */
export function tierOf(a) {
  if (a.requiresJudgement) return 'review';
  if (a.kind === 'SPLIT' || a.kind === 'MERGE' || a.kind === 'EXTRACT') return 'review';
  if (a.kind === 'MOVE' || a.kind === 'ARCHIVE') return 'confident';
  return 'safe';
}

export const TIERS = [
  ['safe', 'Safe', 'Nothing moves. Frontmatter added, missing documents created. `docgov fix` does all of this, and undoing it means deleting what it wrote.'],
  ['confident', 'High confidence', 'Files move to the canonical position for their class, and every internal link that pointed at them is repaired in the same commit. `docgov fix` does these too. Nothing here is a guess — but a path is a thing other software remembers, so read the list.'],
  ['review', 'Needs review', 'DocGov could not settle these on its own. Two different things live here, and they behave differently:\n\n'
    + '- **Moves and classifications** — `docgov fix` **will** carry these out. What is uncertain is not the operation but what the document *is*: no signal won clearly. Check them, or delete the ones you disagree with from this plan before running `fix`.\n'
    + '- **Splits, merges and extractions** — prose has to be rewritten, so `fix` never does them on its own. They need `--include split,merge,extract`, and even then one at a time.'],
];

/**
 * What the repository looked like when a plan was computed.
 *
 * The commit is recorded because it is what a human recognises, but the documents are what
 * actually matter: a plan is a list of operations on *these* files with *this* content, and
 * neither an uncommitted edit nor a commit that touched no documentation changes what the
 * plan should do. Hashing the governed set directly means the fingerprint moves exactly when
 * the plan's assumptions do, and not otherwise.
 */
export function fingerprintOf(root, docs, gitAvailable = true) {
  const lines = docs.map((d) => `${d.path}\u0000${sha(d.raw ?? d.body ?? '')}`).sort();
  return {
    head: gitAvailable ? headSha(root) : null,
    documents: docs.length,
    tree: sha(lines.join('\n')),
  };
}

/**
 * Has the repository moved under a plan? Returns what changed, so the refusal can say which
 * documents rather than only that something did.
 */
export function planDrift(planData, docs) {
  const fp = planData?.fingerprint;
  const now = fingerprintOf(null, docs, false);
  if (!fp?.tree) return null;                 // a plan from before fingerprints; see loadPlan
  if (fp.tree === now.tree) return null;

  const then = new Map((planData.classifications || []).map((c) => [c.path, c.digest]));
  const current = new Map(docs.map((d) => [d.path, sha(d.raw ?? d.body ?? '')]));
  const added = [...current.keys()].filter((p) => !then.has(p));
  const removed = [...then.keys()].filter((p) => !current.has(p));
  const modified = [...current].filter(([p, h]) => then.has(p) && then.get(p) && then.get(p) !== h).map(([p]) => p);
  return { added, removed, modified };
}

function stripFile(p) { return p.replace(/\.mdx?$/, ''); }

/** The human-readable plan. This is the artifact the user approves. */
export function render(planData, cfg) {
  const L = [];
  const s = planData.summary;
  L.push('# DocGov fix plan');
  L.push('');
  L.push(`Generated ${planData.generated.slice(0, 19).replace('T', ' ')} · layout \`${planData.layout}\` · mode \`${planData.mode}\``);
  L.push('');
  L.push('**Nothing has changed yet.** This plan is a proposal. Edit it freely — delete any action you');
  L.push('disagree with — then run `docgov fix` to execute exactly what remains.');
  L.push('');
  L.push('```');
  L.push(`SAFE             ${String(s.safe).padStart(4)}  frontmatter and new documents; nothing moves`);
  L.push(`HIGH CONFIDENCE  ${String(s.confident).padStart(4)}  files move to their canonical place, links repaired`);
  L.push(`NEEDS REVIEW     ${String(s.review).padStart(4)}  DocGov was not sure; read these before running \`fix\``);
  L.push('```');
  L.push('');
  L.push('The first two are mechanical and reversible: run them and move on. The third is the part');
  L.push('that is actually asking you something.');
  L.push('');

  if (!planData.git.repo) {
    L.push('> ⚠ This is not a git repository. `docgov fix` refuses to run without git, because the');
    L.push('> only honest way to promise "without losing information" is to make every change revertible.');
    L.push('');
  } else if (!planData.git.clean) {
    L.push('> ⚠ The working tree is dirty. Commit or stash before migrating.');
    L.push('');
  }

  L.push('## Current state');
  L.push('');
  L.push(`- ${plural(s.documents, 'document')}, ${plural(planData.contracts.length, 'machine contract')}`);
  L.push(`- ${plural(s.unclassified, 'document')} could not be classified, ${s.lowConfidence} classified with low confidence`);
  L.push(`- ${plural(s.brokenLinks, 'broken internal link')}, ${plural(s.duplicateCandidates, 'suspected duplicate pair')}`);
  if (planData.stack.length) L.push(`- stack detected: ${planData.stack.map((x) => x.id).join(', ')}`);
  if (planData.scopes?.length) {
    L.push(`- ${plural(planData.scopes.length, 'authority scope')}: ${planData.scopes.map((x) => x.prefix).join(', ')}`);
    L.push('  Documents inside these stay inside them, and each has its own README.');
  }
  if (planData.agentInstructions.length) L.push(`- existing agent instructions: ${planData.agentInstructions.join(', ')}`);
  L.push('');

  L.push('## Proposed state');
  L.push('');
  L.push('```');
  L.push(tree(planData, cfg));
  L.push('```');
  L.push('');

  const groups = [
    ['MOVE', 'Moves', 'Relocated to the canonical position for their class. Links are repaired automatically.'],
    ['ANNOTATE', 'Annotations', 'Frontmatter added so the document becomes addressable by id.'],
    ['SPLIT', 'Splits', 'Each of these holds several independently addressable concepts. Needs your judgement.'],
    ['EXTRACT', 'Extractions', 'README sections that have outgrown a README.'],
    ['MERGE', 'Merges', 'Suspected duplicates. DocGov will not merge prose on its own — these are for you.'],
    ['ARCHIVE', 'Archives', 'Superseded or deprecated documents moved to the archive namespace.'],
    ['CREATE', 'Missing documents', 'The repository implies these should exist.'],
    ['CLASSIFY', 'Needs classification', 'No signal matched. Tell DocGov what these are.'],
  ];
  for (const [tier, tierTitle, tierBlurb] of TIERS) {
    const inTier = planData.actions.filter((a) => (a.tier || tierOf(a)) === tier);
    if (!inTier.length) continue;
    L.push(`# ${tierTitle} (${inTier.length})`);
    L.push('');
    L.push(tierBlurb);
    L.push('');
  for (const [kind, title, blurb] of groups) {
    const items = inTier.filter((a) => a.kind === kind);
    if (!items.length) continue;
    L.push(`## ${title} (${items.length})`);
    L.push('');
    L.push(tier === 'review' && (kind === 'MOVE' || kind === 'ARCHIVE')
      ? 'The destination follows from a classification no signal won clearly. `fix` will still move these — the reason each was classified as it was is on every line.'
      : blurb);
    L.push('');
    for (const a of items) {
      if (kind === 'MOVE' || kind === 'ARCHIVE') L.push(`- \`${a.id}\` \`${a.path}\` → \`${a.to}\`  \n  ${a.reason}`);
      else if (kind === 'SPLIT') {
        L.push(`- \`${a.path}\` — ${a.reason}`);
        for (const part of a.into) L.push(`    - \`${part.to}\` ← "${part.title}" (${part.lines} lines)`);
        L.push('    - parent becomes an index that links the parts');
      } else if (kind === 'EXTRACT') L.push(`- \`${a.path}\` § "${a.section}" (${a.lines} lines) → \`${a.to || '(choose a destination)'}\``);
      else if (kind === 'MERGE') L.push(`- \`${a.path}\` + \`${a.other}\` — ${a.reason}`);
      else if (kind === 'CREATE') L.push(`- \`${a.to}\` (${a.type}) — ${a.reason}`);
      else L.push(`- \`${a.path}\` — ${a.reason}`);
    }
    L.push('');
  }
  }

  if (planData.contradictionCandidates.length) {
    L.push('## Suspected contradictions');
    L.push('');
    L.push('Textual overlap narrows the candidates; only a reviewer can confirm a real contradiction.');
    L.push('Run `/docgov:inspect --contradictions` to have the architect agent adjudicate these pairs.');
    L.push('');
    for (const c of planData.contradictionCandidates.slice(0, 12)) {
      L.push(`- \`${c.a}\` (${c.authorityA}) vs \`${c.b}\` (${c.authorityB}) — ${Math.round(c.score * 100)}% overlap. ${c.note}`);
    }
    L.push('');
  }

  if (planData.brokenLinks.length) {
    L.push('## Broken internal links');
    L.push('');
    for (const b of planData.brokenLinks.slice(0, 25)) L.push(`- \`${b.path}\` → \`${b.target}\``);
    if (planData.brokenLinks.length > 25) L.push(`- … and ${planData.brokenLinks.length - 25} more`);
    L.push('');
  }

  if ((planData.collisions || []).length) {
    L.push('## Destination collisions — this plan will not run as written');
    L.push('');
    L.push('`docgov fix` refuses all of these: moving two documents onto one path, or onto a');
    L.push('file that is staying put, would destroy a document. Decide a destination for each,');
    L.push('edit it here, and the rest of the plan runs unchanged.');
    L.push('');
    for (const c of planData.collisions) L.push(`- ${c.reason}`);
    L.push('');
  }

  L.push(`${s.review} of ${planData.actions.length} actions need a human or an agent to decide something.`);
  L.push('');
  L.push('## Execute');
  L.push('');
  L.push('```bash');
  L.push('docgov fix --dry-run   # show every file operation, touch nothing');
  L.push('docgov fix             # on a new branch, mechanical actions only');
  L.push('docgov fix --include split,merge,extract   # also the judgement calls, one at a time');
  L.push('```');
  L.push('');
  L.push('`migrate` runs MOVE, ANNOTATE and ARCHIVE automatically and repairs every internal link.');
  L.push('SPLIT, MERGE and EXTRACT are left to `/docgov:tag`, which uses an agent to rewrite prose.');
  return L.join('\n');
}

function tree(planData, cfg) {
  const dirs = new Map();
  for (const c of planData.classifications) {
    const a = planData.actions.find((x) => x.kind === 'MOVE' && x.path === c.path);
    const final = a ? a.to : c.path;
    const dir = final.includes('/') ? final.slice(0, final.lastIndexOf('/')) : '.';
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push({ file: final.split('/').pop(), from: a ? c.path : null });
  }
  for (const a of planData.actions.filter((x) => x.kind === 'CREATE')) {
    const dir = a.to.replace(/\/$/, '');
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push({ file: '(to create)', from: null, create: true });
  }
  const out = [];
  for (const dir of [...dirs.keys()].sort()) {
    out.push(`${dir}/`);
    for (const f of dirs.get(dir).sort((x, y) => x.file.localeCompare(y.file))) {
      out.push(`  ${f.file}${f.from ? `   ← ${f.from}` : ''}${f.create ? '   (new)' : ''}`);
    }
  }
  return out.join('\n');
}
