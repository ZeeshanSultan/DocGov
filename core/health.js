import { AUTHORITY, TYPES } from './taxonomy.js';
import { pct } from './util.js';
import { inboundCounts } from './links.js';
import { coverageGaps } from './inventory.js';
import { limitFor, qualityFor } from './config.js';

/**
 * Documentation health (PRD §31).
 *
 * Every component here is computed from countable facts, so the number moves for
 * a reason you can point at. Nothing is a model's opinion.
 */
export function health({ cfg, docs, inv, graph, registry, findings, stale = [] }) {
  const n = Math.max(1, docs.length);
  const gaps = coverageGaps(inv);
  const inbound = inboundCounts(docs);

  const classified = docs.filter((d) => d.type !== 'unknown').length;
  const registered = docs.filter((d) => d.registered).length;
  // Coverage has two halves: how much of what exists is understood, and how much
  // of what the repository's stack implies actually exists.
  const expected = gaps.length + new Set(docs.map((d) => d.type)).size;
  const coverage = Math.round(0.5 * pct(classified, n) + 0.5 * pct(expected - gaps.length, expected));

  const staleRisk = stale.length ? Math.round(stale.reduce((a, s) => a + s.risk, 0) / stale.length) : 0;
  const freshness = Math.max(0, 100 - Math.round(staleRisk * (stale.length / n)));

  const byCheck = (c) => findings.filter((f) => f.check === c).length;
  const consistency = clamp(100
    - byCheck('duplicate-id') * 20
    - byCheck('authority-violation') * 20
    - byCheck('unknown-reference') * 8
    - byCheck('duplicate-candidate') * 4
    - byCheck('invalid-relationship') * 4);

  const structure = clamp(100
    - byCheck('wrong-location') * 6
    - byCheck('hard-limit') * 8
    - byCheck('soft-limit') * 2
    - byCheck('missing-sections') * 3
    - byCheck('new-root-document') * 5);

  const linked = [...inbound.values()].filter((c) => c > 0).length;
  const discoverability = clamp(Math.round(0.6 * pct(linked, n) + 0.4 * (100 - byCheck('missing-index') * 10)));

  const withRels = docs.filter((d) => Object.keys(d.relationships).length > 0).length;
  const crossLinking = clamp(Math.round(0.5 * pct(withRels, n) + 0.5 * (100 - byCheck('broken-link') * 8)));

  const canonical = docs.filter((d) => (AUTHORITY[d.authority]?.rank ?? 9) <= 1);
  const canonicalIntegrity = clamp(100
    - graph.authorityViolations().length * 25
    - canonical.filter((d) => d.missingSections().length).length * 8
    - canonical.filter((d) => !d.registered).length * 10);

  const metadata = clamp(Math.round(pct(registered, n)
    - byCheck('missing-visibility') * 2
    - byCheck('missing-owner') * 2));

  const components = { coverage: clamp(coverage), freshness, consistency, structure, discoverability,
    'cross-linking': crossLinking, 'canonical integrity': canonicalIntegrity, metadata };

  const weights = { coverage: 0.18, freshness: 0.14, consistency: 0.16, structure: 0.13,
    discoverability: 0.11, 'cross-linking': 0.10, 'canonical integrity': 0.12, metadata: 0.06 };
  const overall = Math.round(Object.entries(components).reduce((a, [k, v]) => a + v * weights[k], 0));

  return {
    overall, components,
    issues: {
      stale: stale.filter((s) => s.risk >= (cfg.drift?.stale_threshold ?? 60)).length,
      oversized: byCheck('hard-limit') + byCheck('soft-limit'),
      orphans: byCheck('orphan'),
      brokenLinks: byCheck('broken-link'),
      unclassified: byCheck('unclassified'),
      missingCrossReferences: byCheck('unknown-reference'),
      duplicateCandidates: byCheck('duplicate-candidate'),
      coverageGaps: gaps.length,
    },
    gaps,
    counts: { documents: docs.length, classified, registered, canonical: canonical.length,
      contracts: inv.contracts.length, lines: inv.counts.markdownLines },
  };
}

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

/** Quality-gate scaffolding (PRD §20). Deterministic dimensions only; the rest is the reviewer agent's. */
export function qualityFloor({ cfg, doc, findings }) {
  const mine = findings.filter((f) => f.path === doc.path);
  const threshold = qualityFor(cfg, doc.type);
  const { soft, hard } = limitFor(cfg, doc.type);
  const structure = clamp(100 - doc.missingSections().length * 12 - (hard && doc.lines > hard ? 20 : 0));
  const grounding = clamp(100 - mine.filter((f) => f.check === 'broken-link').length * 15
    - mine.filter((f) => f.check === 'unknown-reference').length * 10);
  const crossRefs = clamp(Object.keys(doc.relationships).length ? 100 : 55);
  const freshness = doc.status === 'draft' ? 60 : 100;
  return {
    path: doc.path, type: doc.type, threshold,
    deterministic: { structure, 'technical grounding': grounding, 'cross references': crossRefs, freshness },
    note: 'Clarity, completeness, audience fit and security judgement are scored by the quality-reviewer agent and are advisory.',
  };
}
