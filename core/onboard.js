import path from 'node:path';
import { classify, destinationFor } from './classify.js';
import { TYPES, AUTHORITY, typeDef } from './taxonomy.js';
import { similarPairs } from './similarity.js';
import { coverageGaps } from './inventory.js';
import { assess, readmeOverreach, splitCandidates } from './size.js';
import { brokenLinks } from './links.js';
import { primaryAuthor, isRepo, isClean, lastCommitDate } from './git.js';
import { locationFor } from './config.js';
import { matchAny, table, plural } from './util.js';

/**
 * Existing-project onboarding (PRD §15, §44).
 *
 * The hard rule: this produces a plan and changes nothing. The plan is a file a
 * human reads and edits; `docgov migrate` executes exactly what the plan says.
 * Separating proposal from execution is what makes the "without losing
 * information" promise checkable rather than aspirational.
 */

export const PLAN_PATH = '.docgov/onboarding-plan.md';
export const PLAN_DATA_PATH = '.docgov/onboarding-plan.json';

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
    const target = archived ? d.path : destinationFor(cfg, c.type, d.path);

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
    duplicateCandidates: duplicates.length,
    needJudgement: actions.filter((a) => a.requiresJudgement).length,
    highRisk: actions.filter((a) => a.risk === 'high').length,
  };

  return {
    version: 1, generated: new Date().toISOString(),
    layout: cfg.project.layout, mode: cfg.project.mode,
    git: { repo: gitAvailable, clean: gitAvailable ? isClean(root) : false },
    summary, classifications, actions, duplicates, contradictionCandidates, gaps, brokenLinks: broken,
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
  L.push('# DocGov onboarding plan');
  L.push('');
  L.push(`Generated ${planData.generated.slice(0, 19).replace('T', ' ')} · layout \`${planData.layout}\` · mode \`${planData.mode}\``);
  L.push('');
  L.push('**Nothing has changed yet.** This plan is a proposal. Edit it freely — delete any action you');
  L.push('disagree with — then run `docgov migrate` to execute exactly what remains.');
  L.push('');

  if (!planData.git.repo) {
    L.push('> ⚠ This is not a git repository. `docgov migrate` refuses to run without git, because the');
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
    L.push('Run `/docgov:review --contradictions` to have the architect agent adjudicate these pairs.');
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
  L.push('docgov migrate --dry-run   # show every file operation, touch nothing');
  L.push('docgov migrate             # on a new branch, mechanical actions only');
  L.push('docgov migrate --include split,merge,extract   # also the judgement calls, one at a time');
  L.push('```');
  L.push('');
  L.push('`migrate` runs MOVE, ANNOTATE and ARCHIVE automatically and repairs every internal link.');
  L.push('SPLIT, MERGE and EXTRACT are left to `/docgov:organize`, which uses an agent to rewrite prose.');
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
