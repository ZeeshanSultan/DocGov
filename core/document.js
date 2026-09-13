import path from 'node:path';
import * as fm from './frontmatter.js';
import { TYPES, AUTHORITY, typeDef } from './taxonomy.js';
import { read, sha, slug, titleCase, toPosix } from './util.js';

/**
 * A governed document. Built from disk once and passed around; no module
 * re-reads a file after this point, so the whole engine sees one consistent
 * snapshot per run.
 */
export class Document {
  /**
   * @param {string} root
   * @param {string} rel
   * @param {string} [source]
   * @param {object} [externalMeta] registration from config, for files that must not carry
   *   frontmatter. GitHub renders YAML frontmatter in Markdown as a table, so README,
   *   CONTRIBUTING, SECURITY and CHANGELOG are governed from the registry instead.
   */
  constructor(root, rel, source, externalMeta) {
    this.root = root;
    this.path = toPosix(rel);
    this.source = source ?? read(path.join(root, rel));
    this.error = null;
    let parsed;
    try { parsed = fm.parse(this.source); }
    catch (e) { this.error = e.message; parsed = { data: {}, body: this.source, hasFrontmatter: true }; }
    this.frontmatter = parsed.data;
    this.body = parsed.body;
    this.hasFrontmatter = parsed.hasFrontmatter;
    this.meta = this.frontmatter.docgov || externalMeta || {};
    this.externallyRegistered = !this.frontmatter.docgov && Boolean(externalMeta);
    this.registered = Boolean(this.meta.id);
    this.lines = this.source.split('\n').length;
    this.bodyLines = this.body.split('\n').length;
    this.hash = sha(this.source);
    this.sections = fm.sections(this.body);
    this.title = this.frontmatter.title || fm.firstHeading(this.body) || titleCase(path.basename(rel, path.extname(rel)));
  }

  get id() { return this.meta.id || slug(this.path.replace(/\.mdx?$/, '').replace(/\//g, '-')); }
  get type() { return this.meta.type && TYPES[this.meta.type] ? this.meta.type : (this.meta.type || 'unknown'); }
  get def() { return typeDef(this.type); }
  get authority() { return this.meta.authority || this.def.authority; }
  get tier() { return (AUTHORITY[this.authority] || AUTHORITY.historical).tier; }
  get visibility() { return this.meta.visibility || this.def.visibility || 'internal'; }
  get status() { return this.meta.status || 'active'; }
  get domain() { return this.meta.domain || null; }
  get owner() { return this.meta.owner || null; }
  get lens() { return this.meta.lens || this.def.lens || 'developer'; }
  get generationMode() { return (this.meta.generation || {}).mode || (this.def.generated ? 'generated' : 'human-maintained'); }
  get isGenerated() { return this.generationMode === 'generated'; }

  /** @returns {Record<string,string[]>} */
  get relationships() {
    const r = this.meta.relationships || {};
    const out = {};
    for (const [k, v] of Object.entries(r)) out[k] = Array.isArray(v) ? v.map(String) : (v == null ? [] : [String(v)]);
    return out;
  }

  /** Section titles present, normalized for comparison against required sections. */
  sectionTitles() { return this.sections.map((s) => normalizeHeading(s.title)); }

  missingSections() {
    const have = this.sectionTitles();
    return (this.def.sections || []).filter((req) => {
      const n = normalizeHeading(req);
      return !have.some((h) => h === n || h.startsWith(n) || n.startsWith(h));
    });
  }

  /** Markdown links, split into internal file refs and external URLs. */
  links() {
    const out = { internal: [], external: [], anchors: [] };
    // CommonMark allows balanced parentheses inside a link destination, and also
    // `<...>` around one. Stopping at the first `)` truncated every path containing
    // them — Next.js route groups like `app/(dashboard)/billy/` are the common case,
    // and the truncated path was then reported as a broken link.
    const re = /\[(?:[^\]\\]|\\.)*\]\(\s*(?:<([^>\n]*)>|((?:[^()\s\\]|\\.|\([^()\s]*\))+))(?:\s+"[^"]*")?\s*\)/g;
    let m;
    const body = this.body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    while ((m = re.exec(body))) {
      const target = m[1] !== undefined ? m[1] : m[2];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) out.external.push(target);
      else if (target.startsWith('#')) out.anchors.push(target);
      else out.internal.push(target.split('#')[0]);
    }
    return out;
  }

  /** Words for tf-idf similarity. Code fences and frontmatter excluded. */
  tokens() {
    if (this._tokens) return this._tokens;
    const text = this.body.replace(/```[\s\S]*?```/g, ' ').toLowerCase();
    this._tokens = text.match(/[a-z][a-z0-9_-]{2,}/g) || [];
    return this._tokens;
  }

  toRegistryEntry() {
    const e = { path: this.path, type: this.type, authority: this.authority, visibility: this.visibility };
    if (this.externallyRegistered) e.registered_in = 'config';
    if (this.title) e.title = this.title;
    if (this.domain) e.domain = this.domain;
    if (this.owner) e.owner = this.owner;
    if (this.status !== 'active') e.status = this.status;
    if (this.isGenerated) e.generated = true;
    e.hash = this.hash;
    e.lines = this.lines;
    const rel = this.relationships;
    if (Object.keys(rel).length) e.relationships = rel;
    return e;
  }
}

/**
 * Normalize a heading for comparison: drop an ordinal prefix ("1.", "2.1", "Step 3 —",
 * "IV. Context") and any punctuation. Numbered headings are common enough that not
 * handling them would make the required-sections gate fire on documents that pass.
 *
 * Roman numerals are only stripped when a separator follows them. Without that guard,
 * `[ivxlc]+` eats the first letter of ordinary words — "Verdict" becomes "erdict",
 * "Install" becomes "nstall", "Context" becomes "ontext" — and every required section
 * starting with one of those letters silently stops matching.
 */
export function normalizeHeading(title) {
  let t = String(title).trim();
  t = t.replace(/^(?:step|phase|part|section)\s+(?:\d+|[ivxlc]+)\b[\s).:\-\u2013\u2014]*/i, '');
  t = t.replace(/^\d+(?:\.\d+)*[\s).:\-\u2013\u2014]+/, '');
  t = t.replace(/^[ivxlc]+[.)][\s\-\u2013\u2014]*/i, '');
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function loadDocuments(root, relPaths) {
  return relPaths.map((rel) => new Document(root, rel));
}
