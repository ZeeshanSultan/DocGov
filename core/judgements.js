import path from 'node:path';
import * as schema from './schema.js';
import { read, write, exists, DocGovError } from './util.js';
import { SEVERITY } from './drift.js';

/**
 * Findings a model reached, kept apart from findings software decided.
 *
 * The whole product rests on one separation: software decides what blocks, a model decides
 * what is subjective. Everything in `check.js` is decidable without asking anyone, which is
 * precisely why it is allowed to fail a build. A model's verdict — "these two documents
 * contradict each other", "this drift is real" — is not, and it never earns that power.
 *
 * The danger is not that the two are stored together; it is that they *render* the same. A
 * line reading `HIGH  contradiction  docs/billing.md` looks identical whether a regex or an
 * opus-class model produced it, and a user who cannot tell them apart has to trust both
 * equally or neither. So a judgement is a different kind of object, in a different file,
 * printed in its own section, and absent from the `findings` array entirely — there is no
 * path by which one can arrive somewhere a deterministic finding is expected.
 *
 * Three fields are mandatory and exist to make a judgement falsifiable:
 *
 *   `confidence` — how sure the model was. A verdict without one is an assertion.
 *   `evidence`   — what it actually read. The agent prompts already demand quotes, because
 *                  "a verdict without both quotes is a guess wearing a label"; this makes
 *                  that a rule of the format rather than advice in a prompt.
 *   `agent`      — who said it. Judgements from different lenses age differently, and a
 *                  reader needs to know which one to re-run.
 */

export const CONFIDENCE = ['low', 'medium', 'high'];

const FILE = '.docgov/judgements.json';

/** Numeric confidence is accepted and bucketed: agents produce both, and refusing 0.82
 *  would only teach them to send the string "high" for it anyway. */
function confidenceOf(v) {
  if (typeof v === 'number') {
    if (!(v >= 0 && v <= 1)) return null;
    return v >= 0.8 ? 'high' : v >= 0.5 ? 'medium' : 'low';
  }
  const s = String(v || '').toLowerCase();
  return CONFIDENCE.includes(s) ? s : null;
}

/**
 * Validate one raw judgement. Returns the problems, so a whole file can be reported at once
 * rather than an agent discovering the format one rejection at a time.
 */
export function problems(raw) {
  const out = [];
  if (!raw || typeof raw !== 'object') return ['not an object'];
  if (!raw.check) out.push('`check` is required: what kind of judgement this is');
  if (!raw.path) out.push('`path` is required: the document it is about');
  if (!raw.message) out.push('`message` is required: what was concluded');
  if (!confidenceOf(raw.confidence)) out.push(`\`confidence\` is required: ${CONFIDENCE.join(', ')}, or a number from 0 to 1`);
  if (!Array.isArray(raw.evidence) || !raw.evidence.length) {
    out.push('`evidence` is required and must not be empty: what was read to reach this');
  }
  if (!raw.agent) out.push('`agent` is required: which lens reached this verdict');
  if (raw.severity && !SEVERITY.includes(raw.severity)) {
    out.push(`\`severity\` must be one of ${SEVERITY.join(', ')}`);
  }
  return out;
}

/**
 * Normalise one judgement into the stored shape.
 *
 * `deterministic: false`, `blocking: false` and `source: 'model'` are set here rather than
 * read from the input. They are properties of where the finding came from, not claims its
 * author gets to make — an agent cannot mark its own opinion as a rule.
 */
export function normalize(raw, { agent = null } = {}) {
  const r = { ...raw, agent: raw?.agent || agent };
  const errs = problems(r);
  if (errs.length) throw new DocGovError(`judgement about ${r?.path || '(no path)'}:\n  ${errs.join('\n  ')}`);
  return {
    check: String(r.check),
    path: String(r.path),
    id: r.id != null ? String(r.id) : null,
    severity: r.severity || 'medium',
    message: String(r.message),
    confidence: confidenceOf(r.confidence),
    evidence: r.evidence.map(String),
    agent: String(r.agent),
    recorded: r.recorded || new Date().toISOString().slice(0, 10),
    source: 'model',
    deterministic: false,
    blocking: false,
  };
}

export function load(root) {
  const file = path.join(root, FILE);
  if (!exists(file)) return { version: 1, judgements: [] };
  try {
    const j = schema.check('judgements', JSON.parse(read(file)) || {}, file);
    j.judgements ||= [];
    // Anything on disk is re-flattened on read. This file is writable by anything that can
    // write the repository, and a `blocking: true` smuggled into it must not survive as far
    // as the renderer, let alone the exit code.
    j.judgements = j.judgements.map((x) => ({ ...x, source: 'model', deterministic: false, blocking: false }));
    return j;
  } catch (e) { throw new DocGovError(`judgements file is not valid: ${e.message}`); }
}

export function save(root, judgements) {
  write(path.join(root, FILE), `${JSON.stringify(schema.stamp('judgements', { judgements }), null, 2)}\n`);
}

/**
 * Record a batch, replacing anything the same agent previously said about the same document
 * and the same kind of judgement. A lens re-run corrects itself rather than accumulating.
 */
export function record(root, raws, { agent = null } = {}) {
  const incoming = raws.map((r) => normalize(r, { agent }));
  const superseded = new Set(incoming.map((j) => `${j.agent} ${j.check} ${j.path}`));
  const data = load(root);
  const kept = data.judgements.filter((j) => !superseded.has(`${j.agent} ${j.check} ${j.path}`));
  save(root, [...kept, ...incoming]);
  return { recorded: incoming.length, replaced: data.judgements.length - kept.length };
}

export function clear(root, { agent = null } = {}) {
  const data = load(root);
  const kept = agent ? data.judgements.filter((j) => j.agent !== agent) : [];
  save(root, kept);
  return data.judgements.length - kept.length;
}
