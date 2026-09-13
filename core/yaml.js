/**
 * Strict YAML subset parser + emitter. Zero dependencies.
 *
 * Supported: comments, nested block maps (2-space or any consistent indent),
 * block sequences, scalars (string / number / bool / null), single- and
 * double-quoted strings, inline flow sequences [a, b], inline flow maps {a: b}.
 *
 * Deliberately UNSUPPORTED — these throw rather than guess, because a governance
 * engine that silently misreads its own config is worse than one that refuses to
 * start: anchors (&), aliases (*), tags (!!), block scalars (| >), tabs,
 * multi-document streams (---  beyond frontmatter fences), complex keys (?).
 */

export class YamlError extends Error {
  constructor(msg, line) {
    super(line == null ? msg : `${msg} (line ${line + 1})`);
    this.name = 'YamlError';
    this.line = line;
  }
}

const UNSUPPORTED = [
  [/^\s*[?]\s/, 'complex mapping keys (?)'],
  [/\t/, 'tab indentation'],
];

function stripComment(s) {
  // Remove a trailing # comment that is not inside quotes.
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

function parseScalar(raw, lineNo) {
  const s = raw.trim();
  if (s === '') return '';
  if (s[0] === '&' || s[0] === '*') throw new YamlError('anchors and aliases are not supported', lineNo);
  if (s.startsWith('!!') || s.startsWith('!')) throw new YamlError('YAML tags are not supported', lineNo);
  if (s === '|' || s === '>' || s === '|-' || s === '>-' || s === '|+' || s === '>+')
    throw new YamlError('block scalars (| >) are not supported; use a quoted single-line string', lineNo);
  if (s[0] === '"' && s.endsWith('"') && s.length > 1) return JSON.parse(s);
  if (s[0] === "'" && s.endsWith("'") && s.length > 1) return s.slice(1, -1).replace(/''/g, "'");
  if (s[0] === '[') return parseFlowSeq(s, lineNo);
  if (s[0] === '{') return parseFlowMap(s, lineNo);
  if (s === 'null' || s === '~') return null;
  if (s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === 'false' || s === 'no' || s === 'off') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function splitFlow(body, lineNo) {
  const parts = [];
  let depth = 0, q = null, cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"') { cur += body[++i] ?? ''; }
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (q) throw new YamlError('unterminated quote in flow collection', lineNo);
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

function parseFlowSeq(s, lineNo) {
  if (!s.endsWith(']')) throw new YamlError('unterminated flow sequence', lineNo);
  const body = s.slice(1, -1).trim();
  if (body === '') return [];
  return splitFlow(body, lineNo).map((p) => parseScalar(p, lineNo));
}

function parseFlowMap(s, lineNo) {
  if (!s.endsWith('}')) throw new YamlError('unterminated flow mapping', lineNo);
  const body = s.slice(1, -1).trim();
  const out = {};
  if (body === '') return out;
  for (const p of splitFlow(body, lineNo)) {
    const i = splitKey(p);
    if (i < 0) throw new YamlError('flow mapping entry missing ":"', lineNo);
    out[parseScalar(p.slice(0, i), lineNo)] = parseScalar(p.slice(i + 1), lineNo);
  }
  return out;
}

/** Index of the ":" that separates key from value, ignoring quoted regions. */
function splitKey(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ':' && (i + 1 === s.length || /[\s]/.test(s[i + 1]))) return i;
  }
  return -1;
}

/** @returns {{indent:number, text:string, lineNo:number}[]} */
function tokenize(src) {
  const out = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    for (const [re, what] of UNSUPPORTED) {
      if (re.test(raw)) throw new YamlError(`${what} is not supported`, i);
    }
    const text = stripComment(raw).replace(/\s+$/, '');
    if (text.trim() === '') continue;
    out.push({ indent: raw.length - raw.trimStart().length, text: text.trimStart(), lineNo: i });
  }
  return out;
}

/**
 * @param {string} src
 * @returns {any}
 */
export function parse(src) {
  if (src == null) return {};
  const toks = tokenize(String(src));
  if (toks.length === 0) return {};
  const [value, next] = parseBlock(toks, 0, toks[0].indent);
  if (next < toks.length) throw new YamlError('unexpected content after document', toks[next].lineNo);
  return value;
}

function parseBlock(toks, i, indent) {
  if (i >= toks.length) return [null, i];
  if (toks[i].text.startsWith('- ') || toks[i].text === '-') return parseSeq(toks, i, indent);
  return parseMap(toks, i, indent);
}

function parseSeq(toks, i, indent) {
  const out = [];
  while (i < toks.length && toks[i].indent === indent) {
    const t = toks[i];
    if (!(t.text === '-' || t.text.startsWith('- '))) break;
    const rest = t.text === '-' ? '' : t.text.slice(2).trim();
    if (rest === '') {
      i++;
      if (i < toks.length && toks[i].indent > indent) {
        const [v, n] = parseBlock(toks, i, toks[i].indent);
        out.push(v); i = n;
      } else out.push(null);
      continue;
    }
    const k = splitKey(rest);
    if (k >= 0) {
      // "- key: value" opens an inline map whose continuation is indented past the dash
      const inner = [{ indent: indent + 2, text: rest, lineNo: t.lineNo }];
      let j = i + 1;
      while (j < toks.length && toks[j].indent > indent) { inner.push(toks[j]); j++; }
      const [v, n] = parseMap(inner, 0, indent + 2);
      if (n < inner.length) throw new YamlError('unexpected content in sequence item', inner[n].lineNo);
      out.push(v); i = j;
      continue;
    }
    out.push(parseScalar(rest, t.lineNo));
    i++;
  }
  return [out, i];
}

function parseMap(toks, i, indent) {
  const out = {};
  while (i < toks.length && toks[i].indent === indent) {
    const t = toks[i];
    if (t.text.startsWith('- ')) break;
    const k = splitKey(t.text);
    if (k < 0) throw new YamlError(`expected "key: value", got ${JSON.stringify(t.text)}`, t.lineNo);
    const key = String(parseScalar(t.text.slice(0, k), t.lineNo));
    const rest = t.text.slice(k + 1).trim();
    if (rest !== '') { out[key] = parseScalar(rest, t.lineNo); i++; continue; }
    // nested block, or explicit empty
    if (i + 1 < toks.length && toks[i + 1].indent > indent) {
      const [v, n] = parseBlock(toks, i + 1, toks[i + 1].indent);
      out[key] = v; i = n;
    } else if (i + 1 < toks.length && toks[i + 1].indent === indent && toks[i + 1].text.startsWith('- ')) {
      const [v, n] = parseSeq(toks, i + 1, indent);
      out[key] = v; i = n;
    } else { out[key] = null; i++; }
  }
  return [out, i];
}

const PLAIN_SAFE = /^[A-Za-z0-9_][A-Za-z0-9 _\-./:+@]*$/;

function emitScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '') return "''";
  if (PLAIN_SAFE.test(s) && !/^(true|false|yes|no|on|off|null|~)$/i.test(s) && !/^-?\d+(\.\d+)?$/.test(s) && !s.endsWith(' '))
    return s;
  return JSON.stringify(s);
}

/**
 * Deterministic emitter: object keys in insertion order, 2-space indent.
 * @param {any} value
 * @param {number} [indent]
 */
export function stringify(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value.map((v) => {
      if (v !== null && typeof v === 'object') {
        const body = stringify(v, indent + 2);
        return `${pad}-${body.slice(indent + 1)}`;
      }
      return `${pad}- ${emitScalar(v)}\n`;
    }).join('');
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return `${pad}{}\n`;
    return keys.map((k) => {
      const v = value[k];
      const key = PLAIN_SAFE.test(k) ? k : JSON.stringify(k);
      if (v !== null && typeof v === 'object') {
        if (Array.isArray(v) && v.length === 0) return `${pad}${key}: []\n`;
        if (!Array.isArray(v) && Object.keys(v).length === 0) return `${pad}${key}: {}\n`;
        return `${pad}${key}:\n${stringify(v, indent + 2)}`;
      }
      return `${pad}${key}: ${emitScalar(v)}\n`;
    }).join('');
  }
  return `${pad}${emitScalar(value)}\n`;
}
