import { typeDef, isCurrent, AUTHORITY } from './taxonomy.js';

/**
 * Who already owns this documentation responsibility?
 *
 * The failure this exists to stop is one agents commit constantly: asked to document
 * something, they create a new file rather than find and update the document that already
 * covers it. Nothing structural catches it — the new document is well-formed, correctly
 * typed, in the right directory, and a second source of truth. `create` could only ever
 * check whether its *exact target path* was taken, so `create user.guide "Setup"` cheerfully
 * wrote a fourth setup guide beside docs/getting-started.md.
 *
 * The hard part is knowing where the line is. Whether "Setup" and "Getting started" are the
 * same responsibility is a judgement call, and DocGov does not block on judgement calls. So
 * this splits the question in two:
 *
 *   `update-existing` — decidable by software, and therefore blocking. A single-document
 *     class that is already held, or an existing document of the same class whose name means
 *     the same thing after normalisation.
 *   `review-first` — a same-class document that shares vocabulary with the request. Reported
 *     with the candidates named, never blocking, because being wrong here means refusing to
 *     create a document somebody asked for, which is worse than a duplicate.
 *
 * Note what is deliberately not used: `find()`. Its score is an unbounded composite of
 * lexical hits, a semantic cosine and an authority bonus, tuned for *ranking* search results
 * a human will read. On a thousand-document repository a query of pure nonsense still scores
 * 74 against dozens of documents, so no constant threshold on it means anything, and a
 * candidate list built from it is mostly noise. Ownership is decided on names — a document's
 * title and its filename — which is the evidence a reader would use and the only evidence
 * that stays explainable in the error message.
 */

/** Words that carry no topic. Kept short on purpose — an over-eager list loses real signal. */
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'your', 'our', 'its',
  'how', 'what', 'why', 'when', 'this', 'that', 'are', 'was']);

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Just enough stemming that "Backups" and "Backup strategy" are seen to share a word.
 * Two rules, both safe on short technical words ("css" and "aws" are left alone); anything
 * more ambitious is a linguistics project, and getting it wrong here costs a false refusal.
 */
function stem(t) {
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/** The topic words of a phrase: what is left once punctuation, casing and filler are gone. */
export function terms(s) {
  return new Set(slug(s).split('-').filter((t) => t.length > 2 && !STOP.has(t)).map(stem));
}

/** A document's own name, as words: its title and its filename both count. */
function docTerms(doc) {
  const base = (doc.path || '').split('/').pop().replace(/\.mdx?$/i, '');
  return new Set([...terms(doc.title), ...terms(base)]);
}

/**
 * Does an existing document's name already cover everything being asked for?
 *
 * The containment is one-directional on purpose. If the request's words are all in the
 * existing name, the existing document is at least as broad — updating it is right.
 * The reverse is not: "Getting started with auth" beside "Getting started" is a narrower
 * document, which is a legitimate thing to want and so is reported, not refused.
 *
 * Nothing cleverer than containment: synonyms are a judgement call and belong in
 * `review-first`.
 */
function covers(want, docNames) {
  if (!want.size || !docNames.size) return false;
  for (const t of want) if (!docNames.has(t)) return false;
  return true;
}

/** A singleton class is owned by exactly one document, by definition. */
function singletonOwner(docs, type) {
  if (!typeDef(type).singleton) return null;
  return docs.find((d) => d.type === type) || null;
}

/**
 * @returns {{decision:'create-new'|'update-existing'|'review-first', owner:object|null,
 *            candidates:Array, why:string}}
 */
export function whoOwns({ docs, type, name, domain = null }) {
  const def = typeDef(type);
  // Historical documents own nothing: a superseded guide must not block its replacement.
  const current = (docs || []).filter(isCurrent);

  const only = singletonOwner(current, type);
  if (only) {
    return { decision: 'update-existing', owner: only, candidates: [only],
      why: `${def.label} is a single-document class and ${only.path} already holds it` };
  }

  const sameType = current.filter((d) => d.type === type);
  if (!sameType.length) {
    return { decision: 'create-new', owner: null, candidates: [],
      why: `no ${def.label} exists yet` };
  }

  // The class's own label is not part of the topic: "Testing guide" and "Testing" name the
  // same engineering guide. Subtract it — unless that leaves nothing, which means the caller
  // named the document after its class and the label *is* the topic.
  const label = terms(def.label);
  const full = terms(name);
  const stripped = new Set([...full].filter((t) => !label.has(t)));
  const want = stripped.size ? stripped : full;
  if (!want.size) {
    return { decision: 'create-new', owner: null, candidates: [], why: 'nothing to match on' };
  }

  // Blocking: an existing document of this class already carries this name.
  const named = sameType.filter((d) => covers(want, docTerms(d)));
  if (named.length) {
    const owner = domain ? named.find((d) => d.domain === domain) || named[0] : named[0];
    return { decision: 'update-existing', owner, candidates: named,
      why: `${owner.path} is already the ${def.label} called "${owner.title || owner.id}"` };
  }

  // Advisory: same class, sharing topic words with the request in its own name. A shared
  // word is what qualifies a candidate at all, so a request that matches nothing by name
  // produces no candidates rather than a ranked list of noise.
  const overlapping = sameType.map((d) => {
    const dt = docTerms(d);
    let shared = 0;
    for (const t of want) if (dt.has(t)) shared += 1;
    return { doc: d, shared };
  }).filter((x) => x.shared > 0);

  if (!overlapping.length) {
    return { decision: 'create-new', owner: null, candidates: [],
      why: `no existing ${def.label} is named for "${name}"` };
  }

  // Most words in common first; ties go to the more authoritative document, since that is
  // the one a reader should look at before writing a second.
  const candidates = overlapping.sort((a, b) =>
    b.shared - a.shared
    || (domain ? Number(b.doc.domain === domain) - Number(a.doc.domain === domain) : 0)
    || (AUTHORITY[a.doc.authority]?.rank ?? 9) - (AUTHORITY[b.doc.authority]?.rank ?? 9))
    .map((x) => x.doc).slice(0, 5);

  return { decision: 'review-first', owner: null, candidates,
    why: `${candidates.length} existing ${def.label}${candidates.length > 1 ? 's' : ''} cover${candidates.length > 1 ? '' : 's'} part of "${name}"` };
}
