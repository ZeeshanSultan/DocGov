/**
 * tf-idf cosine similarity over document bodies.
 *
 * This exists so duplicate and contradiction detection can narrow ~5,000 candidate
 * pairs down to ~20 before any model is asked to look (FEASIBILITY §3.5). Local,
 * deterministic, no embedding service — which keeps PRD §43's local-first promise.
 */

const STOP = new Set(('the and for that this with are was from have has not you your our they them their can will'
  + ' should would could but all any its where when what which who how why into than then also more most other'
  + ' such only own same too very just about over under via per use used using based each one two new'
  + ' docs doc documentation document section see also note example examples').split(/\s+/));

/** @param {string[]} tokens */
function termFreq(tokens) {
  const tf = new Map();
  let n = 0;
  for (const t of tokens) {
    if (STOP.has(t) || t.length < 4) continue;
    tf.set(t, (tf.get(t) || 0) + 1);
    n++;
  }
  return { tf, n };
}

/**
 * @param {{id:string, tokens:()=>string[]}[]} docs
 * @returns {Map<string, Map<string, number>>} id -> term -> tf-idf weight (L2 normalized)
 */
export function vectorize(docs) {
  const freqs = docs.map((d) => ({ id: d.id, ...termFreq(d.tokens()) }));
  const df = new Map();
  for (const f of freqs) for (const t of f.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const N = Math.max(1, docs.length);
  const out = new Map();
  for (const f of freqs) {
    const vec = new Map();
    let norm = 0;
    for (const [t, c] of f.tf) {
      const idf = Math.log(1 + N / (df.get(t) || 1));
      const w = (c / Math.max(1, f.n)) * idf;
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    out.set(f.id, vec);
  }
  return out;
}

export function cosine(a, b) {
  if (!a || !b) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [t, w] of small) { const o = large.get(t); if (o) s += w * o; }
  return s;
}

/**
 * Candidate near-duplicate pairs, most similar first.
 * @param {{id:string,path:string,type:string,domain:string|null,tokens:()=>string[]}[]} docs
 * @param {{threshold?:number, limit?:number}} [opts]
 */
export function similarPairs(docs, opts = {}) {
  const { threshold = 0.45, limit = 40 } = opts;
  const vecs = vectorize(docs);
  const pairs = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i], b = docs[j];
      const score = cosine(vecs.get(a.id), vecs.get(b.id));
      if (score < threshold) continue;
      const reasons = [];
      if (a.type === b.type && a.type !== 'unknown') reasons.push('same document type');
      if (a.domain && a.domain === b.domain) reasons.push('same domain');
      pairs.push({ a: a.path, b: b.path, aId: a.id, bId: b.id, score: Math.round(score * 100) / 100, reasons });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, limit);
}

/** Terms that carry a document's topic, for a human-readable "about" line. */
export function topTerms(doc, allDocs, k = 8) {
  const vecs = vectorize(allDocs);
  const v = vecs.get(doc.id);
  if (!v) return [];
  return [...v.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([t]) => t);
}
