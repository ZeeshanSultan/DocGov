import path from 'node:path';
import { TYPES } from './taxonomy.js';
import { matchGlob } from './util.js';

/**
 * Deterministic, explainable classification.
 *
 * Every candidate carries the signals that produced it, so `docgov whatis`
 * can always answer "why". The LLM layer is only asked to adjudicate when the
 * top two candidates are close (see `needsReview`) — it never sees the easy cases.
 */

/** filename / path signals: [regex, type, weight] */
const NAME_SIGNALS = [
  [/^readme\.mdx?$/i, 'user.readme', 100],
  [/^(readme|index)\.mdx?$/i, 'docs.index', 55],
  [/^contributing/i, 'governance.contributing', 100],
  [/^security\.mdx?$/i, 'security.public-model', 70],
  [/^support/i, 'governance.support', 90],
  [/^changelog/i, 'release.changelog', 100],
  [/^(claude|agents|gemini)\.mdx?$|^\.(cursorrules|windsurfrules)$|^copilot-instructions\.mdx?$/i, 'agent.instructions', 100],
  [/^code_of_conduct/i, 'governance.code-of-conduct', 95],
  [/^(third[-_ ]?party[-_ ]?notices?|notices?|attributions?|credits)\.mdx?$/i,
    'governance.attribution', 95],
  [/^license/i, 'governance.policy', 30],
  [/^product\.mdx?$/i, 'constitution.product', 90],
  [/^principles?\.mdx?$/i, 'constitution.principles', 90],
  [/^invariants?\.mdx?$/i, 'constitution.invariants', 95],
  [/^glossary\.mdx?$/i, 'constitution.glossary', 95],
  [/^domains?\.mdx?$/i, 'constitution.domains', 80],
  [/(^|[-_/])adr[-_]?\d*|^\d{3,4}-.*\.mdx?$/i, 'architecture.adr', 75],
  [/(^|[-_])prd(\b|[-_.])|product[-_]requirements/i, 'product.prd', 85],
  [/(^|[-_])trd(\b|[-_.])|technical[-_]requirements|tech[-_]design|design[-_]doc/i, 'architecture.trd', 80],
  [/feasibilit|spike|evaluation|assessment|trade[-_]?off|prior[-_]art|research[-_]note/i, 'architecture.assessment', 85],
  [/threat[-_]?model/i, 'security.threat-model', 95],
  [/runbook|playbook|oncall|on[-_]call/i, 'operations.runbook', 90],
  [/disaster|dr[-_]plan|business[-_]continuity/i, 'operations.disaster-recovery', 85],
  [/deploy(ment)?/i, 'operations.deployment', 70],
  [/infra(structure)?|terraform|kubernetes|k8s/i, 'operations.infrastructure', 65],
  [/observability|monitoring|telemetry|metrics|logging|alerting/i, 'operations.observability', 70],
  [/getting[-_]?started|quick[-_]?start/i, 'user.getting-started', 90],
  [/tutorial|walkthrough/i, 'user.tutorial', 80],
  [/troubleshoot|common[-_]issues|known[-_]issues/i, 'user.troubleshooting', 85],
  [/^faq|\bfaq\b/i, 'user.faq', 85],
  [/user[-_]guide|admin(istrator)?[-_]guide/i, 'user.guide', 75],
  [/architecture|system[-_]design/i, 'architecture.overview', 65],
  [/migration|upgrad(e|ing)/i, 'release.migration', 75],
  [/deprecat/i, 'release.deprecation', 80],
  [/release[-_]notes?/i, 'release.notes', 85],
  [/roadmap/i, 'product.roadmap', 90],
  [/persona/i, 'product.persona', 90],
  [/\bux\b|user[-_]experience/i, 'design.ux', 75],
  [/accessibilit|a11y|wcag/i, 'design.accessibility', 85],
  [/\bflows?\b|user[-_]journey/i, 'design.flow', 60],
  [/authoriz|authz|rbac|permissions?/i, 'security.authorization', 75],
  [/data[-_]classif/i, 'security.data-classification', 90],
  [/auth(entication)?|identity|oauth|sso/i, 'security.architecture', 55],
  [/test(ing)?[-_]?(strategy|plan|guide)/i, 'engineering.testing', 80],
  [/conventions?|style[-_]guide|standards?/i, 'engineering.conventions', 70],
  [/dependenc/i, 'engineering.dependencies', 75],
  [/development|dev[-_]setup|contributing[-_]setup|local[-_]dev/i, 'engineering.development', 70],
  [/config(uration)?[-_]?(reference|ref)?/i, 'operations.configuration', 60],
  [/\breference\b|api[-_]reference|cli[-_]reference/i, 'user.reference', 70],
  [/lifecycle|versioning|support[-_]policy/i, 'governance.lifecycle', 70],
  [/policy|polic(y|ies)/i, 'governance.policy', 55],
  [/\bnotes?\b|scratch|wip|todo|ideas?/i, 'note.internal', 50],
  [/vision/i, 'product.vision', 80],
  [/feature/i, 'product.feature', 55],
  [/component/i, 'architecture.component', 60],
  [/data[-_]model|schema[-_]design|erd/i, 'architecture.data', 75],
  [/integration/i, 'architecture.integration', 70],
  [/domain/i, 'architecture.domain', 55],
];

const PATH_SIGNALS = [
  ['docs/00-canonical/**', null, 40, 'constitution'],
  ['docs/01-product/**', 'product.prd', 30, null],
  ['docs/01-product/features/**', 'product.feature', 45, null],
  ['docs/01-product/personas/**', 'product.persona', 60, null],
  ['docs/01-product/roadmap/**', 'product.roadmap', 60, null],
  ['docs/02-design/ux/**', 'design.ux', 50, null],
  ['docs/02-design/flows/**', 'design.flow', 60, null],
  ['docs/02-design/accessibility/**', 'design.accessibility', 60, null],
  ['docs/03-architecture/overview/**', 'architecture.overview', 55, null],
  ['docs/03-architecture/domains/**', 'architecture.domain', 70, null],
  ['docs/03-architecture/components/**', 'architecture.component', 45, null],
  ['docs/03-architecture/data/**', 'architecture.data', 60, null],
  ['docs/03-architecture/integrations/**', 'architecture.integration', 60, null],
  ['docs/03-architecture/adr/**', 'architecture.adr', 80, null],
  ['docs/adr/**', 'architecture.adr', 80, null],
  ['docs/decisions/**', 'architecture.adr', 70, null],
  ['docs/04-security/threat-models/**', 'security.threat-model', 70, null],
  ['docs/04-security/authorization/**', 'security.authorization', 70, null],
  ['docs/04-security/data-classification/**', 'security.data-classification', 70, null],
  ['docs/04-security/**', 'security.architecture', 35, null],
  ['docs/05-engineering/testing/**', 'engineering.testing', 60, null],
  ['docs/05-engineering/conventions/**', 'engineering.conventions', 60, null],
  ['docs/05-engineering/dependencies/**', 'engineering.dependencies', 60, null],
  ['docs/05-engineering/**', 'engineering.development', 30, null],
  ['docs/06-operations/runbooks/**', 'operations.runbook', 75, null],
  ['docs/06-operations/deployment/**', 'operations.deployment', 60, null],
  ['docs/06-operations/infrastructure/**', 'operations.infrastructure', 60, null],
  ['docs/06-operations/configuration/**', 'operations.configuration', 60, null],
  ['docs/06-operations/observability/**', 'operations.observability', 60, null],
  ['docs/06-operations/disaster-recovery/**', 'operations.disaster-recovery', 70, null],
  ['docs/07-release/releases/**', 'release.notes', 60, null],
  ['docs/07-release/migrations/**', 'release.migration', 65, null],
  ['docs/07-release/deprecations/**', 'release.deprecation', 65, null],
  ['docs/08-user/getting-started/**', 'user.getting-started', 70, null],
  ['docs/08-user/guides/**', 'user.guide', 50, null],
  ['docs/08-user/reference/**', 'user.reference', 65, null],
  ['docs/08-user/troubleshooting/**', 'user.troubleshooting', 70, null],
  ['docs/08-user/faq/**', 'user.faq', 70, null],
  ['docs/09-governance/**', 'governance.policy', 35, null],
  ['docs/10-internal/**', 'note.internal', 45, null],
  ['docs/internal/**', 'note.internal', 45, null],
  ['docs/90-generated/**', 'user.reference', 60, null],
  ['docs/99-archive/**', 'archive.document', 95, null],
  ['docs/archive/**', 'archive.document', 90, null],

  // Every glob above describes DocGov's own canonical layout, so structural evidence only
  // ever fired on a repository that had already adopted DocGov — exactly not the case this
  // tool exists for. On three unfamiliar repositories that left 86-96% of documents without
  // a trustworthy classification, not because the documents were unclear but because nobody
  // had put them where DocGov expected.
  //
  // These describe the layouts projects actually use: Diátaxis names, which DocGov already
  // says it adopts, and the content trees Hugo, Docusaurus and MkDocs generate from. They
  // are weighted below the canonical globs, so a repository that has adopted the layout
  // still wins on its own terms, and they are anchored on whole path segments so
  // `integrations/` cannot be matched by a stray substring.
  ['**/getting-started/**', 'user.getting-started', 55, null],
  ['**/getting_started/**', 'user.getting-started', 55, null],
  ['**/tutorials/**', 'user.tutorial', 55, null],
  ['**/tutorial/**', 'user.tutorial', 55, null],
  ['**/how-to/**', 'user.guide', 50, null],
  ['**/how-tos/**', 'user.guide', 50, null],
  ['**/howto/**', 'user.guide', 50, null],
  ['**/guides/**', 'user.guide', 50, null],
  ['**/guide/**', 'user.guide', 45, null],
  ['**/usage/**', 'user.guide', 45, null],
  ['**/integrations/**', 'user.guide', 45, null],
  ['**/reference/**', 'user.reference', 50, null],
  ['**/faq/**', 'user.faq', 60, null],
  ['**/troubleshooting/**', 'user.troubleshooting', 60, null],
  ['**/runbooks/**', 'operations.runbook', 60, null],
  ['**/runbook/**', 'operations.runbook', 60, null],
  ['**/deployment/**', 'operations.deployment', 55, null],
  ['**/deploy/**', 'operations.deployment', 45, null],
  ['**/observability/**', 'operations.observability', 55, null],
  ['**/monitoring/**', 'operations.observability', 50, null],
  ['**/infrastructure/**', 'operations.infrastructure', 55, null],
  ['**/architecture/**', 'architecture.overview', 45, null],
  ['**/contributing/**', 'governance.contributing', 45, null],
  ['**/governance/**', 'governance.policy', 45, null],
  ['**/threat-model/**', 'security.threat-model', 65, null],
  ['**/threat-models/**', 'security.threat-model', 65, null],
];

/** content signals: [regex over body, type, weight] */
const CONTENT_SIGNALS = [
  [/^\s*#+\s*(status|decision)\s*$/im, 'architecture.adr', 35],
  [/\bsupersed(es|ed by)\b/i, 'architecture.adr', 20],
  [/\b(trust boundar|threat actor|attack surface|STRIDE|residual risk)/i, 'security.threat-model', 45],
  [/\b(non-?goals?)\b/i, 'product.prd', 20],
  [/\bacceptance criteria\b/i, 'product.prd', 25],
  [/\b(personas?|user stor(y|ies))\b/i, 'product.prd', 15],
  [/\b(rollback|rollout)\b.*\n[\s\S]*\b(observability|migration)\b/i, 'architecture.trd', 30],
  [/\b(RPO|RTO)\b/, 'operations.disaster-recovery', 50],
  // Not \b: a hyphen is a word boundary, so `\bpager\b` matched the dependency
  // `memory-pager` in a third-party licence table and classified it as a runbook.
  [/(?<![\w-])(escalat\w*|pager|severity|SEV-?\d)(?![\w-])/i, 'operations.runbook', 30],
  [/^\s*#+\s*(trigger|diagnostics|procedure)\s*$/im, 'operations.runbook', 45],
  [/\binvariant\b/i, 'constitution.invariants', 25],
  [/^\s*\|?\s*term\s*\|/im, 'constitution.glossary', 40],
  [/\bnpm install\b|\bpip install\b|\bgetting started\b/i, 'user.getting-started', 20],
  [/\bSLO\b|\bSLI\b|\bprometheus\b|\bgrafana\b/i, 'operations.observability', 35],
  [/\b(kubernetes|terraform|helm|ECS|EKS)\b/i, 'operations.infrastructure', 25],
  [/\bWCAG\b|\bscreen reader\b|\baria-/i, 'design.accessibility', 45],
  [/\bRBAC\b|\brole\b.*\bpermission\b/i, 'security.authorization', 30],
  [/\bdeprecat(ed|ion)\b/i, 'release.deprecation', 25],
  [/^\s*#+\s*v?\d+\.\d+\.\d+/m, 'release.notes', 40],
  [/\bopenapi\b|\bswagger\b/i, 'user.reference', 15],
  [/\bAUTO-?GENERATED\b|\bDo not edit\b/i, 'user.reference', 55],
  [/^#+\s*\d+\.\s+verdict|^#+\s*verdict\s*$/im, 'architecture.assessment', 45],
];

const CONFIDENT = 60;
/** Structural evidence — where a document sits, what it is called — needed to trust a type. */
const STRUCTURAL_FLOOR = 40;
const AMBIGUOUS_GAP = 15;

/**
 * @param {{path:string, body?:string, frontmatter?:object}} doc
 * @returns {{type:string, confidence:number, signals:string[], candidates:{type:string,score:number}[], needsReview:boolean, declared:boolean}}
 */
export function classify(doc) {
  const declared = doc.frontmatter?.docgov?.type;
  if (declared && TYPES[declared]) {
    return { type: declared, confidence: 100, signals: ['declared in frontmatter'],
      candidates: [{ type: declared, score: 100 }], needsReview: false, declared: true };
  }

  const rel = doc.path;
  const base = path.basename(rel);
  const scores = new Map();
  const signals = new Map();
  // Evidence is not all the same quality. Where a document *sits* and what it is *called*
  // are decisions somebody made about what it is; a regex matching its prose is a guess.
  // Measured across three repositories, 269 of 278 low-confidence classifications rested on
  // structural evidence and were right, while the content-only ones were wrong — a
  // branching model read as a runbook, a contributing guide as a getting-started page.
  // Scoring them on one scale made a correct path match (54) and a bad prose match (45)
  // indistinguishable, and both fell under one threshold.
  const structural = new Map();
  const bump = (type, w, why, kind = 'content') => {
    if (!type || !TYPES[type]) return;
    scores.set(type, (scores.get(type) || 0) + w);
    if (!signals.has(type)) signals.set(type, []);
    signals.get(type).push(why);
    if (kind === 'structural') structural.set(type, (structural.get(type) || 0) + w);
  };

  for (const [re, type, w] of NAME_SIGNALS) {
    if (re.test(base)) bump(type, w, `filename matches ${re.source.slice(0, 34)}`, 'structural');
    // A filename pattern that matched somewhere in the *path* is a hint, not a decision:
    // `integration` matches `docs/content/en/integrations/parsers/api/cobalt.md`, which is a
    // user's import guide rather than an integration spec. It still scores, so it can break
    // a tie, but on its own it does not make a classification trustworthy.
    else if (re.test(rel)) bump(type, Math.round(w * 0.6), `path matches ${re.source.slice(0, 34)}`);
  }
  for (const [glob, type, w, authority] of PATH_SIGNALS) {
    if (!matchGlob(rel, glob)) continue;
    if (type) bump(type, w, `located in ${glob}`, 'structural');
    if (authority) for (const [id, t] of Object.entries(TYPES)) if (t.authority === authority) bump(id, w, `located in ${glob}`, 'structural');
  }
  // Inside a generated documentation site, the site's own configuration says these pages
  // are published documentation. Their sections are named for readers — `ai-assistant/`,
  // `cli-reference/`, `errors/` — so no naming convention reaches them, and one repository
  // had 363 such documents matching nothing at all. Weighted so that a more specific
  // signal, including the Diátaxis names above, still wins.
  if (doc.inSiteContent) bump('user.guide', 45, 'inside a published documentation site', 'structural');

  const body = doc.body ?? '';
  for (const [re, type, w] of CONTENT_SIGNALS) {
    if (re.test(body)) bump(type, w, `content matches ${re.source.slice(0, 34)}`);
  }

  // Root-level singletons are a strong tie-break: only one README can exist.
  if (!rel.includes('/')) {
    for (const [id, t] of Object.entries(TYPES)) {
      if (t.singleton && (t.compact || t.full) === rel) bump(id, 60, 'canonical singleton path', 'structural');
    }
  }

  // Singleton classes (README, CHANGELOG, the constitution documents) exist exactly once,
  // at a fixed path. A nested README.md is a directory index, not *the* README, and letting
  // it win would send every subdirectory README to the repository root.
  // Demoted rather than deleted. Deleting left a misplaced singleton with no candidates
  // at all — `docs/CODE_OF_CONDUCT.md` classified as `unknown`, "no signal matched",
  // when being in the wrong place is exactly what should have been reported. A nested
  // README still loses, because `docs.index` scores 55 against a demoted 25.
  const SINGLETON_OFF_CANONICAL = 0.25;
  for (const [type, t] of Object.entries(TYPES)) {
    if (!t.singleton || !scores.has(type)) continue;
    const canonical = t.compact || t.full;
    if (rel !== canonical) {
      scores.set(type, Math.round(scores.get(type) * SINGLETON_OFF_CANONICAL));
      // The structural evidence is demoted with it: the filename still says CODE_OF_CONDUCT,
      // but sitting somewhere else is exactly what makes the classification doubtful.
      if (structural.has(type)) structural.set(type, Math.round(structural.get(type) * SINGLETON_OFF_CANONICAL));
      const why = signals.get(type) || [];
      why.push(`not at the canonical path ${canonical}`);
      signals.set(type, why);
    }
  }

  const candidates = [...scores.entries()]
    .map(([type, score]) => ({ type, score }))
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));

  if (candidates.length === 0) {
    return { type: 'unknown', confidence: 0, signals: ['no signal matched'], candidates: [], needsReview: true, declared: false };
  }

  const top = candidates[0];
  // Ambiguity needs a rival. Measuring the gap against a candidate that does not exist made
  // every unrivalled-but-modest classification look contested: a lone candidate scoring 11
  // was reported as a close call against nothing. Weak evidence is caught by the structural
  // floor below, which is the check that actually means it.
  const gap = candidates.length > 1 ? top.score - candidates[1].score : Infinity;
  const confidence = Math.min(99, top.score);
  // A classification needs a human when a rival is close, when nothing structural backs it,
  // or when even the structural evidence is thin. Raw score alone answered none of those:
  // it made one good path match look as doubtful as one bad prose match.
  const backed = (structural.get(top.type) || 0);
  return {
    type: top.type,
    confidence,
    signals: signals.get(top.type) || [],
    candidates: candidates.slice(0, 5),
    needsReview: gap < AMBIGUOUS_GAP || backed < STRUCTURAL_FLOOR,
    declared: false,
  };
}

/** Suggested destination path for a doc of `type`, given the active layout. */
export function destinationFor(cfg, type, currentPath, doc = null) {
  const t = TYPES[type] || TYPES.unknown;
  if (t.anywhere) return currentPath;                       // belongs to its directory
  // Inside a generated documentation site a page's path is its URL, and the navigation,
  // the section indexes and every inbound link are built from it. Classifying those pages
  // is useful; relocating them publishes a different site. One repository would have had
  // 287 pages moved out of its content tree into docs/08-user/guides/.
  if (doc && doc.inSiteContent) return currentPath;
  // Anchored: something outside this repository looks for the file at a path it
  // hard-codes. GitHub reads README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY and SUPPORT
  // from the root, `.github/` or `docs/` and nowhere else; Claude Code reads CLAUDE.md,
  // Gemini CLI GEMINI.md, Cursor .cursorrules. Relocating any of them by layout is not a
  // tidy-up, it is a silent breakage — `full` layout previously sent SECURITY.md to
  // docs/11-external/security.md, where GitHub stops finding it.
  if (t.anchored) return currentPath;
  const loc = cfg.project.layout === 'full' ? t.full : (t.compact || t.full);
  if (!loc.endsWith('/')) return loc;                       // singleton or fixed file
  const base = path.basename(currentPath);
  return loc + base;
}
