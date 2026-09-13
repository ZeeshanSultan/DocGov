import { AUTHORITY, typeDef, isCurrent } from './taxonomy.js';
import { collect as collectInvariants, applicable } from './invariants.js';

/**
 * Context packs (PRD §33).
 *
 * A skill injects this with `!`-prefix command substitution, so the pack is the
 * only documentation tokens the agent pays for. Authority order is the point:
 * the agent reads the constitution before the guide, never the other way round.
 */

const DEFAULT_BUDGET = 12000;   // characters, ~3k tokens

/**
 * @param {{cfg:object, docs:any[], graph:any, topic:string, budget?:number, include?:string[]}} args
 */
export function pack({ cfg, docs, graph, topic, budget = DEFAULT_BUDGET, include = null }) {
  const needle = String(topic || '').toLowerCase();
  const byId = new Map(docs.map((d) => [d.id, d]));

  // A superseded or deprecated document is usually still true about the past, which is what
  // makes it dangerous here: nothing in its prose says it was replaced, so an agent reads it
  // as current. It is recorded as superseded rather than silently dropped, so a pack that
  // looks thin can be explained.
  const superseded = [];
  const scored = docs.map((d) => ({ doc: d, score: relevance(d, needle, cfg) }))
    .filter((x) => {
      if (x.score <= 0) return false;
      if (!isCurrent(x.doc)) {
        superseded.push({ path: x.doc.path, id: x.doc.id, status: x.doc.status,
          supersededBy: x.doc.meta?.relationships?.superseded_by || null });
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

  return render({ topic, selected, invariants, contracts, budget, cfg, superseded });
}

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
function render({ topic, selected, invariants, contracts, budget, superseded = [] }) {
  const L = [];
  L.push(`# DocGov context pack: ${topic}`);
  L.push('');
  L.push('Authoritative documents for this topic, most authoritative first. A lower-authority');
  L.push('document may not contradict a higher one. If something here is wrong, fix the document,');
  L.push('do not work around it.');
  L.push('');

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
