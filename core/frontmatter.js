import * as yaml from './yaml.js';
import { DocGovError } from './util.js';

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

/**
 * @param {string} source
 * @returns {{data:object, body:string, raw:string|null, hasFrontmatter:boolean}}
 */
export function parse(source) {
  const m = FENCE.exec(source);
  if (!m) return { data: {}, body: source, raw: null, hasFrontmatter: false };
  let data;
  try { data = yaml.parse(m[1]) || {}; }
  catch (e) { throw new DocGovError(`invalid frontmatter YAML: ${e.message}`); }
  if (typeof data !== 'object' || Array.isArray(data)) throw new DocGovError('frontmatter must be a mapping');
  return { data, body: source.slice(m[0].length), raw: m[1], hasFrontmatter: true };
}

/** Rewrite (or insert) frontmatter, preserving body byte-for-byte. */
export function stringify(data, body) {
  const keys = Object.keys(data || {});
  if (keys.length === 0) return body;
  return `---\n${yaml.stringify(data)}---\n${body.startsWith('\n') ? body.slice(1) : body}`;
}

/** Merge patch into a document's `docgov` block without touching other frontmatter keys. */
export function patchDocgov(source, patch) {
  const { data, body } = parse(source);
  const next = { ...data, docgov: { ...(data.docgov || {}), ...patch } };
  if (!('docgov' in data)) {
    // keep docgov first so the governance block is the first thing a reader sees
    const reordered = { docgov: next.docgov };
    for (const k of Object.keys(data)) reordered[k] = data[k];
    return stringify(reordered, body);
  }
  return stringify(next, body);
}

/** First markdown H1, used as a title fallback. */
export function firstHeading(body) {
  const m = /^#[ \t]+(.+?)[ \t]*$/m.exec(body);
  return m ? m[1].trim() : null;
}

/** Top-level section map: H2 title -> {start,end,lines}. */
export function sections(body, level = 2) {
  const prefix = '#'.repeat(level);
  const lines = body.split('\n');
  const out = [];
  let cur = null;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    if (inFence) continue;
    const m = new RegExp(`^${prefix}[ \\t]+(.+?)[ \\t]*$`).exec(l);
    if (m) {
      if (cur) { cur.end = i; cur.lines = cur.end - cur.start; out.push(cur); }
      cur = { title: m[1].trim(), start: i, end: lines.length, lines: 0 };
    }
  }
  if (cur) { cur.lines = cur.end - cur.start; out.push(cur); }
  return out;
}
