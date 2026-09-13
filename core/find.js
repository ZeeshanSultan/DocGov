import { AUTHORITY } from './taxonomy.js';
import { vectorize, cosine } from './similarity.js';

/**
 * Authority-aware search (PRD §32).
 *
 * The ranking is deliberately not pure relevance: an agent that reads the user
 * guide before the canonical spec writes confidently wrong code. Authority is a
 * first-class ranking term.
 */
export function find({ docs, query, limit = 10 }) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  const terms = q.match(/[a-z][a-z0-9_-]{1,}/g) || [q];

  const pseudo = { id: '__query__', tokens: () => terms };
  const vecs = vectorize([...docs, pseudo]);
  const qv = vecs.get('__query__');

  const results = docs.map((d) => {
    const text = `${d.title}\n${d.path}\n${d.body}`.toLowerCase();
    let lexical = 0;
    for (const t of terms) {
      const hits = text.split(t).length - 1;
      if (!hits) continue;
      lexical += Math.min(30, 6 + hits * 2);
      if ((d.title || '').toLowerCase().includes(t)) lexical += 18;
      if (d.path.toLowerCase().includes(t)) lexical += 12;
      if (d.id.toLowerCase().includes(t)) lexical += 14;
      if ((d.domain || '').toLowerCase() === t) lexical += 25;
    }
    if (text.includes(q)) lexical += 25;
    const semantic = Math.round(cosine(qv, vecs.get(d.id)) * 60);
    const rank = AUTHORITY[d.authority]?.rank ?? 9;
    const authorityBonus = Math.max(0, (8 - rank) * 5);
    const statusPenalty = d.status === 'deprecated' || d.status === 'superseded' ? 30 : 0;
    return {
      path: d.path, id: d.id, title: d.title, type: d.type, authority: d.authority,
      label: AUTHORITY[d.authority]?.label || d.authority, domain: d.domain, status: d.status,
      score: lexical + semantic + authorityBonus - statusPenalty,
      snippet: snippet(d.body, terms),
    };
  }).filter((r) => r.score > authorityOnly(r));

  return results.sort((a, b) =>
    (AUTHORITY[a.authority]?.rank ?? 9) - (AUTHORITY[b.authority]?.rank ?? 9) ||
    b.score - a.score).slice(0, limit);
}

/** A document must match on content, not merely be authoritative. */
function authorityOnly(r) { return Math.max(0, (8 - (AUTHORITY[r.authority]?.rank ?? 9)) * 5); }

function snippet(body, terms, width = 160) {
  const text = body.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { at = lower.indexOf(t); if (at >= 0) break; }
  if (at < 0) return text.slice(0, width).trim();
  const start = Math.max(0, at - 50);
  return `${start > 0 ? '…' : ''}${text.slice(start, start + width).trim()}…`;
}
