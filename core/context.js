import { AUTHORITY, typeDef, isCurrent, DERIVATION_RELS } from './taxonomy.js';
import { collect as collectInvariants, applicable } from './invariants.js';

/**
 * Context packs (PRD §33).
 *
 * A skill injects this with `!`-prefix command substitution, so the pack is the
 * only documentation tokens the agent pays for. Authority order is the point:
 * the agent reads the constitution before the guide, never the other way round.
 *
 * The pack opens with a map rather than prose. An agent that has just been handed twelve
 * thousand characters needs to know, in the first six lines, what governs this area, what it
 * may not violate, which code is claimed, what is derived from what, what is already known to
 * be out of date, and where two documents contradict each other. Everything in that map is
 * countable — nothing in it is a model's opinion — and everything in it is drawn from
 * documents that are also in the pack, so an agent can always go and read the source.
 *
 * Every document considered is recorded with what happened to it and why. A pack that comes
 * back too thin or too large used to be a guess; `compile()` returns the decisions, so it is
 * now a question with an answer.
 */

const DEFAULT_BUDGET = 12000;   // characters, ~3k tokens

/**
 * Compile the pack: what goes in, what stays out, and why in both cases.
 *
 * `drift` is passed in rather than computed here because it needs git, and the engine that
 * decides what an agent reads must stay callable without a repository — a test, a hook and a
 * CI job all reach this with different amounts of history available. When it is absent the
 * pack says the staleness of its own contents is unknown, which is the honest answer.
 *
 * @param {{cfg:object, docs:any[], graph:any, topic:string, budget?:number,
 *          include?:string[], drift?:object|null}} args
 */
export function compile({ cfg, docs, graph, topic, budget = DEFAULT_BUDGET, include = null, drift = null }) {
  const needle = String(topic || '').toLowerCase();
  const byId = new Map(docs.map((d) => [d.id, d]));
  const decisions = [];
  const record = (doc, state, why) => decisions.push({ id: doc.id, path: doc.path,
    type: doc.type, authority: doc.authority, state, why });

  // A superseded or deprecated document is usually still true about the past, which is what
  // makes it dangerous here: nothing in its prose says it was replaced, so an agent reads it
  // as current. It is recorded as superseded rather than silently dropped, so a pack that
  // looks thin can be explained.
  const superseded = [];
  const scored = docs.map((d) => ({ doc: d, score: relevance(d, needle, cfg) }))
    .filter((x) => {
      if (x.score <= 0) { record(x.doc, 'rejected', `no match for "${topic}"`); return false; }
      if (!isCurrent(x.doc)) {
        superseded.push({ path: x.doc.path, id: x.doc.id, status: x.doc.status,
          supersededBy: x.doc.meta?.relationships?.superseded_by || null });
        record(x.doc, 'rejected', `${x.doc.status} — no longer what to follow`);
        return false;
      }
      return true;
    })
    .sort((a, b) => b.score - a.score);

  const seedIds = scored.slice(0, 6).map((x) => x.doc.id);
  // Pull in what the seeds depend on — a TRD without its canonical domain is a trap.
  const pulled = graph.reach(seedIds, { direction: 'out', rels: ['depends_on', 'derived_from', 'implements', 'generated_from'], maxDepth: 2 });

  const selected = [];
  const seen = new Set();
  const push = (doc, why) => {
    if (!doc || seen.has(doc.id)) return;
    seen.add(doc.id);
    selected.push({ doc, why });
    record(doc, 'selected', why);
  };

  // Constitution always travels with the pack: it is short and it governs everything.
  for (const d of docs) if (AUTHORITY[d.authority]?.rank === 0) push(d, 'project constitution');
  for (const x of scored.slice(0, 8)) push(x.doc, `matches "${topic}"`);
  for (const [id, info] of pulled) push(byId.get(id), `${info.via} of a matched document`);
  if (include) for (const id of include) push(byId.get(id), 'explicitly requested');

  selected.sort((a, b) => (AUTHORITY[a.doc.authority]?.rank ?? 9) - (AUTHORITY[b.doc.authority]?.rank ?? 9));

  const invSet = collectInvariants(docs, cfg);
  const domainPaths = cfg.domains?.[needle]?.paths || [];
  const invariants = domainPaths.length
    ? applicable(invSet, domainPaths.map((g) => g.replace(/\*+/g, 'x')), cfg)
    : invSet.invariants.filter((i) => (i.domain || '').includes(needle) || i.id.toLowerCase().includes(needle));

  const contracts = [...graph.nodes.values()].filter((n) => n.kind === 'contract' &&
    (n.path.toLowerCase().includes(needle) || seen.has(n.id)));

  // Anything that matched but was never selected fell off the end of the seed cut. Saying so
  // is the difference between a thin pack somebody can widen and a thin pack somebody
  // distrusts.
  for (const x of scored) if (!seen.has(x.doc.id)) record(x.doc, 'rejected', 'matched, but ranked below the cut');

  const map = mapOf({ selected, invariants, contracts, cfg, drift, byId });
  return { topic, selected, invariants, contracts, superseded, budget, map, decisions };
}

/**
 * The six lines at the top of the pack. Every one of them is countable — what governs this
 * area, what may not be violated, which code is claimed, what is derived from what, what is
 * already known to be out of date, and where two documents are playing the same role.
 */
function mapOf({ selected, invariants, contracts, cfg, drift, byId }) {
  const docs = selected.map((x) => x.doc);

  // Authoritative: everything a lower document may not contradict, plus the machine contracts,
  // which are authoritative over any prose describing them.
  const authoritative = [
    ...docs.filter((d) => (AUTHORITY[d.authority]?.rank ?? 9) <= 2).map((d) => d.path),
    ...contracts.map((c) => c.path),
  ];

  // Implementation: the code these documents claim. Both sources count — a document's own
  // `documents:` mapping and the domain globs in config — because drift uses both.
  const implementation = [...new Set(docs.flatMap((d) => [
    ...[].concat(d.meta?.documents || []).map(String),
    ...(cfg.domains?.[d.domain]?.paths || []).map(String),
  ]))];

  const derived = docs.flatMap((d) => {
    const rels = d.meta?.relationships || {};
    return DERIVATION_RELS.flatMap((rel) => [].concat(rels[rel] || []).map((src) => ({
      path: d.path, rel, source: byId.get(src)?.path || src,
    })));
  });

  // Known stale is a git question, and git may not be there. "Unknown" is reported as such
  // rather than as "none", which would be a claim this cannot make.
  const inPack = new Set(docs.map((d) => d.path));
  const stale = drift?.usable
    ? (drift.findings || []).filter((f) => inPack.has(f.document))
      .map((f) => ({ path: f.document, kind: f.kind, severity: f.severity, why: f.why }))
    : null;

  // Conflicts, decidably: two documents of one *authoritative* class naming the same domain.
  // Both claim the same role for the same area and nothing ranks one over the other, so an
  // agent reading both has no way to choose. Whether their prose actually disagrees is a
  // judgement call and is not asserted here.
  //
  // The two narrowings matter more than the rule. A domain is required, because without one
  // nothing says two documents cover the same area. And only constitution and canonical
  // classes qualify, because most classes are plural by design — a domain has many ADRs,
  // guides, runbooks and specification parts, and reporting those as conflicts would fill
  // this line with noise on every real repository. Grouping on class and domain alone flagged
  // the six parts of this project's own PRD.
  const groups = new Map();
  for (const d of docs) {
    if (!d.domain || (AUTHORITY[d.authority]?.rank ?? 9) > 1) continue;
    const key = `${d.type}\u0000${d.domain}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const conflicts = [...groups.values()].filter((g) => g.length > 1)
    .map((g) => ({ type: g[0].type, domain: g[0].domain, paths: g.map((d) => d.path) }));

  return {
    authoritative,
    invariants: invariants.map((i) => i.id),
    implementation,
    derived,
    stale,
    conflicts,
  };
}

/** The injected artifact: the compiled pack as the text an agent reads. */
export function pack(args) { return render(compile(args)); }

function relevance(d, needle, cfg) {
  if (!needle) return 1;
  let s = 0;
  if (d.domain && d.domain.toLowerCase() === needle) s += 60;
  if (d.id.toLowerCase().includes(needle)) s += 40;
  if (d.path.toLowerCase().includes(needle)) s += 30;
  if ((d.title || '').toLowerCase().includes(needle)) s += 25;
  const body = d.body.toLowerCase();
  const hits = body.split(needle).length - 1;
  if (hits) s += Math.min(25, 4 + hits * 2);
  // Authority bonus so the canonical spec outranks a blog-flavoured guide on ties.
  s += Math.max(0, 8 - (AUTHORITY[d.authority]?.rank ?? 9));
  return s;
}

/**
 * Pack rendering: full body while the budget lasts, then headings-only so the
 * agent still knows the document exists and can read it on demand.
 */
export function render({ topic, selected, invariants, contracts, budget, superseded = [], map = null, decisions = [] }) {
  const L = [];
  L.push(`# DocGov context pack: ${topic}`);
  L.push('');
  L.push('Authoritative documents for this topic, most authoritative first. A lower-authority');
  L.push('document may not contradict a higher one. If something here is wrong, fix the document,');
  L.push('do not work around it.');
  L.push('');

  if (map) {
    L.push('```');
    for (const [label, value] of mapRows(map)) L.push(`${label.padEnd(15)} ${value}`);
    L.push('```');
    L.push('');
  }

  if (invariants.length) {
    L.push('## Invariants in force');
    L.push('');
    for (const i of invariants) L.push(`- **${i.id}** ${i.statement}  _(${i.source})_`);
    L.push('');
  }

  if (contracts.length) {
    L.push('## Machine contracts (authoritative over prose)');
    L.push('');
    for (const c of contracts) L.push(`- \`${c.path}\` (${c.type})`);
    L.push('');
  }

  let used = L.join('\n').length;
  const truncated = [];
  for (const { doc, why } of selected) {
    const header = `## ${doc.title}\n\n\`${doc.path}\` · ${AUTHORITY[doc.authority]?.label || doc.authority} · ${doc.type} · included because it ${why}\n\n`;
    const bodyText = doc.body.trim();
    if (used + header.length + bodyText.length < budget) {
      L.push(header.trimEnd());
      L.push('');
      L.push(bodyText);
      L.push('');
      used += header.length + bodyText.length;
    } else {
      truncated.push(doc);
      // Selected, but the budget ran out before its body. The trace has to say which of the
      // two happened, or "why is this document not in my pack" has no answer.
      const d = decisions.find((x) => x.id === doc.id && x.state === 'selected');
      if (d) { d.state = 'headings-only'; d.why = `${d.why}; budget of ${budget} characters reached before its body`; }
    }
  }

  if (truncated.length) {
    L.push('## Not included in full (read on demand)');
    L.push('');
    for (const doc of truncated) {
      const heads = doc.sections.slice(0, 8).map((s) => s.title).join(', ');
      L.push(`- \`${doc.path}\` — ${AUTHORITY[doc.authority]?.label || doc.authority}${heads ? `: ${heads}` : ''}`);
    }
    L.push('');
  }

  if (superseded.length) {
    L.push('## Superseded — deliberately not included');
    L.push('');
    L.push('These match the topic but are no longer what to follow. They are listed so a thin');
    L.push('pack is explainable, not so they can be read as current.');
    L.push('');
    for (const x of superseded.slice(0, 10)) {
      L.push(`- \`${x.path}\` — ${x.status}${x.supersededBy ? `, superseded by \`${x.supersededBy}\`` : ''}`);
    }
    if (superseded.length > 10) L.push(`- … and ${superseded.length - 10} more`);
    L.push('');
  }

  L.push('---');
  L.push(`${selected.length} document(s) considered, ${selected.length - truncated.length} included in full, ${invariants.length} invariant(s).`);
  if (superseded.length) L.push(`${superseded.length} superseded document(s) withheld.`);
  return L.join('\n');
}

/**
 * The map, as the lines it prints. Each row is either a list of facts or the word that says
 * why there is nothing to list — `none` when it was checked and there was nothing, `unknown`
 * when it could not be checked. Collapsing those two into one word is how a tool ends up
 * claiming a clean result it never established.
 */
function mapRows(map) {
  const some = (xs, f) => (xs.length ? xs.slice(0, 8).map(f).join(', ') + (xs.length > 8 ? `, … ${xs.length - 8} more` : '') : 'none');
  return [
    ['AUTHORITATIVE', some(map.authoritative, String)],
    ['INVARIANTS', some(map.invariants, String)],
    ['IMPLEMENTATION', some(map.implementation, String)],
    ['DERIVED', some(map.derived, (d) => `${d.path} ${d.rel.replace(/_/g, ' ')} ${d.source}`)],
    ['KNOWN STALE', map.stale === null ? 'unknown — no git history available' : some(map.stale, (x) => `${x.path} (${x.kind}, ${x.severity})`)],
    ['CONFLICTS', some(map.conflicts, (c) => `${c.paths.join(' vs ')} — both ${c.type}${c.domain ? ` for ${c.domain}` : ''}`)],
  ];
}

/** The agent lens (PRD §11): is this document safe for another agent to act on? */
export function agentReadiness(doc) {
  const issues = [];
  if (!doc.registered) issues.push('no docgov.id — an agent cannot cite or update it reliably');
  if (doc.type === 'unknown') issues.push('unclassified — an agent cannot tell what authority it carries');
  if (doc.status === 'draft') issues.push('marked draft but contains no warning in the body');
  if (!/\n/.test(doc.body.trim())) issues.push('effectively empty');
  const def = typeDef(doc.type);
  const missing = doc.missingSections();
  if (missing.length) issues.push(`missing required sections: ${missing.join(', ')}`);
  if (/\b(TBD|TODO|FIXME|\?\?\?)\b/.test(doc.body)) issues.push('contains TBD/TODO an agent may read as fact');
  if (doc.lines > 1200) issues.push('too long to fit a focused agent context without truncation');
  if (!doc.relationships || Object.keys(doc.relationships).length === 0) issues.push('no relationships — invisible to impact analysis');
  return { path: doc.path, ready: issues.length === 0, issues };
}
