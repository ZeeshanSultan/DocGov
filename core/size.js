import { limitFor } from './config.js';
import { typeDef } from './taxonomy.js';

/**
 * Size discipline (PRD §13).
 *
 * Line count alone never triggers a split — it only decides whether a semantic
 * reviewer is worth spending. The split *candidates* are computed structurally:
 * a document whose H2 sections each carry enough substance to stand alone is a
 * document of several documents.
 */

const SPLITTABLE_MIN_LINES = 40;

export function assess(cfg, doc) {
  const { soft, hard } = limitFor(cfg, doc.type);
  const over = hard > 0 && doc.lines > hard;
  const warn = soft > 0 && doc.lines > soft;
  const candidates = splitCandidates(doc);
  return {
    path: doc.path, type: doc.type, lines: doc.lines, soft, hard,
    level: over ? 'hard' : warn ? 'soft' : 'ok',
    independentConcepts: candidates.length,
    candidates,
    // Structural evidence, not an opinion: several fat sections in one file.
    recommendSplit: candidates.length >= 3 && (warn || over),
  };
}

/** H2 sections substantial enough to become their own document. */
export function splitCandidates(doc) {
  return doc.sections
    .filter((s) => s.lines >= SPLITTABLE_MIN_LINES)
    .map((s) => ({ title: s.title, lines: s.lines, suggested: fileNameFor(s.title) }));
}

function fileNameFor(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '.md';
}

/**
 * README-specific extraction advice (PRD §28). A README section that has grown
 * past `maxSection` lines belongs somewhere else with a summary left behind.
 */
export function readmeOverreach(cfg, doc, maxSection = 40) {
  if (doc.type !== 'user.readme') return [];
  const EXTRACT = {
    architecture: 'architecture.overview', design: 'architecture.overview',
    development: 'engineering.development', contributing: 'governance.contributing',
    security: 'security.public-model', deployment: 'operations.deployment',
    configuration: 'operations.configuration', api: 'user.reference',
    troubleshooting: 'user.troubleshooting', faq: 'user.faq', testing: 'engineering.testing',
    roadmap: 'product.roadmap', changelog: 'release.notes',
  };
  const out = [];
  for (const s of doc.sections) {
    if (s.lines <= maxSection) continue;
    const key = Object.keys(EXTRACT).find((k) => s.title.toLowerCase().includes(k));
    out.push({ section: s.title, lines: s.lines, moveTo: key ? EXTRACT[key] : null,
      replaceWith: `${Math.min(12, Math.ceil(s.lines / 15))}-line summary plus a link` });
  }
  return out;
}

/** Progressive disclosure check (PRD §14): does a tree have an index document? */
export function missingIndexes(docs) {
  const dirs = new Map();
  for (const d of docs) {
    const dir = d.path.includes('/') ? d.path.slice(0, d.path.lastIndexOf('/')) : '';
    if (!dir) continue;
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push(d);
  }
  const out = [];
  for (const [dir, group] of dirs) {
    if (group.length < 3) continue;
    const hasIndex = group.some((d) => /\/(README|index)\.mdx?$/i.test(d.path));
    if (!hasIndex) out.push({ dir, documents: group.length, suggest: `${dir}/README.md`, type: 'docs.index' });
  }
  return out;
}

export function requiredSectionReport(doc) {
  const def = typeDef(doc.type);
  const missing = doc.missingSections();
  return { path: doc.path, type: doc.type, required: (def.sections || []).length, missing };
}
