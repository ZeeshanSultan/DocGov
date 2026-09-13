/**
 * Everything the CLI prints.
 *
 * `--json` is not a formatting preference: it decides whether stdout carries a document
 * another program parses. So the mode is set once, at startup, and every writer here honours
 * it — rather than each command remembering to check a flag, which is how a stray `console.log`
 * ends up corrupting a payload a skill is parsing.
 */
import { AUTHORITY } from '../core/taxonomy.js';

let JSONOUT = false;
let COMPACT = false;

/** Called once from `bin/docgov`, before any command runs. */
export function configure({ json = false, compact = false } = {}) {
  JSONOUT = json === true;
  COMPACT = compact === true;
}

export function json() { return JSONOUT; }

export function say(...a) { if (!JSONOUT) console.log(...a); }
export function emit(obj) { if (JSONOUT) console.log(JSON.stringify(obj, null, COMPACT ? 0 : 2)); }
// Advice goes to stderr so it survives `--json` without corrupting the document on stdout.
export function warn(...a) { console.error(...a); }

export function yn(b) { return b ? 'yes' : 'no '; }

export function printFinding(f) {
  say(`  ${f.severity.padEnd(8)} ${f.check.padEnd(21)} ${f.path}`);
  say(`           ${f.message}`);
  if (f.fix) say(`           fix: ${f.fix}`);
}

export function emitOrPrint(obj) {
  if (JSONOUT) return emit(obj);
  console.log(JSON.stringify(obj, null, 2));
}

export function excerpt(doc, chars = 2500) {
  if (!doc) return null;
  const body = doc.body.trim();
  return { path: doc.path, type: doc.type, authority: doc.authority,
    text: body.length <= chars ? body : `${body.slice(0, chars)}\n… (${body.length - chars} more characters)` };
}

