import path from 'node:path';
import { classify, destinationFor } from './classify.js';
import { TYPES, AUTHORITY, typeDef } from './taxonomy.js';
import { similarPairs } from './similarity.js';
import { coverageGaps } from './inventory.js';
import { assess, readmeOverreach, splitCandidates } from './size.js';
import { brokenLinks } from './links.js';
import { primaryAuthor, isRepo, isClean, lastCommitDate } from './git.js';
import { locationFor } from './config.js';
import { matchAny, table, plural, exists } from './util.js';

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
  };

  return {
    version: 1, generated: new Date().toISOString(),
    layout: cfg.project.layout, mode: cfg.project.mode,
    git: { repo: gitAvailable, clean: gitAvailable ? isClean(root) : false },
    summary, classifications, actions, duplicates, contradictionCandidates, gaps, brokenLinks: broken,
    collisions,
    stack: inv.stack.map((s) => ({ id: s.id, evidence: s.evidence[0], count: s.count })),
    contracts: inv.contracts,
    agentInstructions: inv.agentInstructions,
  };
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
  for (const [kind, title, blurb] of groups) {
    const items = planData.actions.filter((a) => a.kind === kind);
    if (!items.length) continue;
    L.push(`## ${title} (${items.length})`);
    L.push('');
    L.push(blurb);
    L.push('');
    for (const a of items) {
      if (kind === 'MOVE' || kind === 'ARCHIVE') L.push(`- \`${a.path}\` → \`${a.to}\`  \n  ${a.reason}`);
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

  L.push('## Risk');
  L.push('');
  L.push(table([
    { Risk: 'low', Actions: planData.actions.filter((a) => a.risk === 'low').length, Meaning: 'mechanical, fully reversible' },
    { Risk: 'medium', Actions: planData.actions.filter((a) => a.risk === 'medium').length, Meaning: 'correct destination is a judgement call' },
    { Risk: 'high', Actions: planData.actions.filter((a) => a.risk === 'high').length, Meaning: 'content must be rewritten; never automatic' },
  ], ['Risk', 'Actions', 'Meaning']));
  L.push('');
  L.push(`${s.needJudgement} of ${planData.actions.length} actions need a human or an agent to decide something.`);
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
