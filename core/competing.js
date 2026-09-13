import { typeDef, isCurrent } from './taxonomy.js';
import { terms } from './responsibility.js';
import { vectorize, cosine, topTerms } from './similarity.js';

/**
 * Documents that already compete for one responsibility.
 *
 * `whoOwns` answers this question at the moment a document is created. This answers it about a
 * repository that already has the problem — and it is a different problem from the one textual
 * similarity finds.
 *
 * Three setup guides at twenty per cent textual overlap are three competing sources of truth
 * for "how do I run this locally", and nothing about their wording says so. Meanwhile the
 * near-copy detector's strongest hits on a real repository were almost entirely deliberate.
 * Overlap of words is not overlap of *responsibility*, and responsibility is what governance
 * is about.
 *
 * What is decidable here, and therefore what this reports:
 *
 *   same scope      the package they govern. In a monorepo two packages each having a setup
 *                   guide is not a duplicate; each is authoritative for its own package.
 *   same audience   the lens their class implies. A tutorial and an architecture document may
 *                   share every keyword and owe each other nothing, so nothing is ever
 *                   compared across lenses — and an unclassified document is never compared
 *                   at all, because nothing has established what audience it has.
 *   same topic      a distinctive word shared by their names once the class label and any word
 *                   common across the repository are stripped out — *and* enough shared
 *                   vocabulary in their bodies to corroborate it. Both, because either on its
 *                   own reports documents that are not competing for anything.
 *   unrelated       no edge between them in the graph. A parent index and its parts, a public
 *                   version and its internal source, a document and the one it supersedes: in
 *                   each case somebody already stated the relationship, and a stated
 *                   relationship is the opposite of an undeclared competition.
 *
 * What is *not* decidable is whether they should be one document. Two guides for two audiences
 * may be exactly right. So this is advisory, it never blocks, and its output is shaped to be
 * handed to a model — which records what it concludes through `docgov judge`, where a verdict
 * stays visibly a verdict.
 *
 * Known limit, stated rather than papered over: two documents covering one subject under
 * entirely different names — "Local setup" and "Setting up locally" share no word at all — are
 * not found. Catching them needs body similarity to decide on its own, and the numbers below
 * show it cannot. A missed duplicate costs a duplicate; a detector that reported the README
 * and the command reference as rivals would cost the feature its credibility.
 */

/**
 * How much shared vocabulary corroborates that two documents are about one thing.
 *
 * Far below the 0.55 the near-copy check uses, because competing sources of truth do not read
 * alike — they were written independently by people who did not know the other existed, which
 * is exactly why they compete.
 *
 * It is a corroborating signal and never a sufficient one. Measured on this project's own
 * documentation: CONTRIBUTING and the testing strategy score 0.283, the testing strategy and
 * the command reference 0.289, the README and the command reference 0.433 — and none of those
 * pairs competes for anything. In a repository about one subject, everything is about that
 * subject, and no threshold on body similarity separates a duplicated responsibility from a
 * legitimately distinct document. The name has to carry the claim; the body only confirms it.
 */
const TOPIC_THRESHOLD = 0.2;

/** A name word shared by more than this share of a pool's documents says nothing about it. */
const COMMON_TERM_SHARE = 0.15;

/** Classes whose job is to point at other documents rather than to own a subject. */
const INDEX_TYPES = new Set(['docs.index']);

/** Edges that mean somebody already decided how these two documents relate. */
const DECLARED = new Set(['derived_from', 'derives', 'generated_from', 'generates',
  'summarizes', 'summarized_by', 'public_version_of', 'has_public_version',
  'supersedes', 'superseded_by', 'depends_on', 'depended_on_by',
  'implements', 'implemented_by', 'defines', 'defined_by', 'references', 'referenced_by']);

const pairKey = (a, b) => [a, b].sort().join(' ');

function declaredPairs(docs) {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const pairs = new Set();
  for (const d of docs) {
    const rels = d.meta?.relationships || d.relationships || {};
    for (const [rel, targets] of Object.entries(rels)) {
      if (!DECLARED.has(rel)) continue;
      for (const t of [].concat(targets || [])) {
        const other = byId.get(t);
        if (other) pairs.add(pairKey(d.path, other.path));
      }
    }
  }
  return pairs;
}

/** A document's own topic words: its title and filename, minus the words naming its class. */
function topicsOf(doc) {
  const def = typeDef(doc.type);
  const label = terms(def.label);
  const base = (doc.path || '').split('/').pop().replace(/\.mdx?$/i, '');
  const all = new Set([...terms(doc.title), ...terms(base)]);
  return { lens: def.lens || 'developer', topics: new Set([...all].filter((t) => !label.has(t))) };
}

/**
 * @param {{docs:any[], minSize?:number, limit?:number}} args
 * @returns {Array<{topic:string, lens:string, paths:string[], documents:Array, why:string}>}
 */
export function competing({ docs, minSize = 2, limit = 20 }) {
  const current = (docs || []).filter(isCurrent);
  const declared = declaredPairs(current);

  // A directory with an index has already been organised: the index says these belong
  // together. The six parts of this project's own PRD are exactly that, and reporting them as
  // competing sources of truth would be reporting a deliberate structure as a defect.
  const indexed = new Set(current.filter((d) => typeDef(d.type).lens && INDEX_TYPES.has(d.type))
    .map((d) => d.path.split('/').slice(0, -1).join('/')));

  const byLens = new Map();
  for (const d of current) {
    // A document DocGov could not classify has no established audience, so "same audience"
    // is not a fact about it. On a repository that has not adopted DocGov that is nearly
    // every document, and treating them as one audience produced a single cluster of 900
    // files — a finding nobody can act on, dressed as a serious one.
    if (!d.type || d.type === 'unknown') continue;
    // An index's job is to point at other documents. Two indexes for two directories are not
    // competing for a responsibility; they are doing the one they have.
    if (INDEX_TYPES.has(d.type)) continue;
    if (indexed.has(d.path.split('/').slice(0, -1).join('/'))) continue;
    const { lens, topics } = topicsOf(d);
    if (!byLens.has(lens)) byLens.set(lens, []);
    byLens.get(lens).push({ doc: d, topics });
  }

  const groups = [];
  for (const [lens, members] of byLens) {
    if (members.length < minSize) continue;
    const vecs = vectorize(members.map((m) => m.doc));

    // A word most of this pool shares carries no information about what any one of them
    // covers. On this project's own documentation "docgov" clustered the changelog with the
    // roadmap and the feasibility study with the vision, establishing only the name of the
    // project. tf-idf already does this for bodies; names needed it too.
    //
    // Counted within the pool rather than across the repository, because a word that is
    // everywhere in a repository may be the distinguishing word inside one package — and on
    // a small pool a repository-wide count filtered away every term there was.
    const df = new Map();
    for (const m of members) for (const t of m.topics) df.set(t, (df.get(t) || 0) + 1);
    const floor = Math.max(2, members.length * COMMON_TERM_SHARE);
    const distinctive = (m) => new Set([...m.topics].filter((t) => df.get(t) <= floor));
    for (const m of members) m.topics = distinctive(m);

    const about = (a, b) => {
      // Two packages each having a setup guide is not a duplicate: each governs its own
      // package, and nothing about one is a second source of truth for the other.
      if ((a.doc.scope ?? null) !== (b.doc.scope ?? null)) return false;
      if (declared.has(pairKey(a.doc.path, b.doc.path))) return false;  // already decided
      // Both, not either. The name says what the document claims to be about; the body
      // corroborates that it actually is. See COMMON_TERM_SHARE for why either alone fails.
      if (![...a.topics].some((t) => b.topics.has(t))) return false;
      return cosine(vecs.get(a.doc.id), vecs.get(b.doc.id)) >= TOPIC_THRESHOLD;
    };

    // Cohesive groups, not connected ones. Transitive closure was the first attempt and it
    // was badly wrong: A relates to B and B to C merges A with C, and on a real repository
    // that chained into one cluster holding most of the tree. A responsibility is something
    // every document in the group shares, so every pair in the group has to satisfy it.
    const remaining = [...members];
    while (remaining.length >= minSize) {
      const seed = remaining.shift();
      const group = [seed];
      for (let i = 0; i < remaining.length; i++) {
        if (group.every((g) => about(g, remaining[i]))) group.push(...remaining.splice(i--, 1));
      }
      if (group.length >= minSize) groups.push({ lens, docs: group.map((m) => m.doc) });
    }
  }

  const out = groups.map(({ lens, docs: group }) => {
    // Name the shared subject, so the finding says what the competition is *about* and not
    // only which files are in it.
    const shared = group.map(topicsOf).reduce((acc, t) => new Set([...acc].filter((x) => t.topics.has(x))),
      new Set(topicsOf(group[0]).topics));
    const topic = shared.size ? [...shared].sort()[0] : (topTerms(group[0], group, 1)[0] || lens);
    return {
      topic,
      lens,
      paths: group.map((d) => d.path).sort(),
      documents: group.map((d) => ({ id: d.id, path: d.path, type: d.type,
        authority: d.authority, title: d.title })),
      why: `${group.length} documents for the same audience cover "${topic}", and none of them says how it relates to the others`,
    };
  });

  return out.sort((a, b) => b.paths.length - a.paths.length || a.topic.localeCompare(b.topic)).slice(0, limit);
}
