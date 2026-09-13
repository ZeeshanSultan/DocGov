import * as yaml from './yaml.js';
import { DocGovError } from './util.js';

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

/**
 * Frontmatter in a format this parser does not own. Hugo accepts TOML (`+++`) and JSON
 * (`{`) as well as YAML, and a document may legitimately use either. DocGov writes YAML,
 * and the fence above does not match those, so a document with TOML frontmatter looked
 * like a document with none — and annotating it prepended a YAML block *above* the TOML.
 * Hugo then reads the injected block as the frontmatter and renders the real one as body
 * text, losing the page's title, weight and draft status.
 * @returns {'toml'|'json'|null}
 */
export function foreignFence(source) {
  if (/^\+\+\+[ \t]*\r?\n/.test(source)) return 'toml';
  if (/^\{[ \t]*\r?\n/.test(source)) return 'json';
  return null;
}

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
  const foreign = foreignFence(source);
  if (foreign) throw new DocGovError(
    `this document uses ${foreign.toUpperCase()} frontmatter, which DocGov does not write. `
    + 'Adding a YAML block above it would replace the frontmatter the site actually reads.');
  const { data, body, raw, hasFrontmatter } = parse(source);
  const block = { ...(data.docgov || {}), ...patch };
  const rendered = yaml.stringify({ docgov: block }).replace(/\n$/, '');

  if (!hasFrontmatter) return `---\n${rendered}\n---\n${body.startsWith('\n') ? body.slice(1) : body}`;

  // Splice, do not re-serialise.
  //
  // Rebuilding the whole block from the parsed object round-tripped every key, value, type
  // and ordering correctly and silently deleted every comment, because the YAML subset parses
  // to a plain object and a comment has nowhere in an object to live. A governance tool that
  // edits people's files must not quietly delete what they wrote — it is the same reason TOML
  // and JSON frontmatter are refused outright rather than converted.
  //
  // Only the `docgov:` block is DocGov's to write, so only those lines are replaced. Every
  // other line, including comments, blank lines, quoting style and key order, is carried
  // across untouched. Comments *inside* the docgov block are still lost: that block is
  // regenerated, and it is the one part of the file DocGov owns.
  const lines = raw.split('\n');
  const start = lines.findIndex((l) => /^docgov[ \t]*:/.test(l));

  if (start === -1) {
    // Keep docgov first, so the governance block is the first thing a reader sees — but after
    // any leading comment, which is almost always a header about the file as a whole.
    let at = 0;
    while (at < lines.length && /^\s*(#|$)/.test(lines[at])) at += 1;
    const kept = [...lines.slice(0, at), ...rendered.split('\n'), ...lines.slice(at)];
    return `---\n${kept.join('\n')}\n---\n${body.startsWith('\n') ? body.slice(1) : body}`;
  }

  // The block runs to the next line that starts a new top-level key.
  let end = start + 1;
  while (end < lines.length && !/^[^\s#][^:]*:/.test(lines[end])) end += 1;
  const kept = [...lines.slice(0, start), ...rendered.split('\n'), ...lines.slice(end)];
  return `---\n${kept.join('\n')}\n---\n${body.startsWith('\n') ? body.slice(1) : body}`;
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
