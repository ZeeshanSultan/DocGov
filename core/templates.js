import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from './yaml.js';
import { TYPES, typeDef } from './taxonomy.js';
import { read, exists, titleCase, slug } from './util.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_DIR = path.join(HERE, '..', 'templates');

/**
 * Templates (PRD §12).
 *
 * 52 document classes do not need 52 hand-written files. A class's required
 * sections already describe its shape, so templates are synthesized from the
 * taxonomy and only the classes whose value is in their *prose scaffolding*
 * (PRD, TRD, ADR, threat model, runbook, README) ship a hand-authored file.
 */

/** Per-section prompts used when synthesizing. Keyed by lowercased section title. */
const SECTION_HINTS = {
  context: 'What situation makes this necessary? Link the upstream document.',
  problem: 'State the problem in terms the reader can verify, not in terms of the solution.',
  goals: 'Outcomes, each one observable.',
  'non-goals': 'What this explicitly does not do, so nobody has to guess.',
  scope: 'What is inside and outside this document\'s authority.',
  purpose: 'One paragraph: why this exists.',
  boundaries: 'What this owns, and what it explicitly delegates.',
  invariants: 'Rules that must hold at all times. Give each an ID like `INV-<DOMAIN>-001`.',
  interfaces: 'Inputs and outputs. Point at the machine contract rather than restating it.',
  'failure modes': 'What goes wrong, how it is detected, what happens next.',
  dependencies: 'What this relies on, and what breaks if each one is unavailable.',
  'acceptance criteria': 'Verifiable conditions. If a reviewer cannot check it, rewrite it.',
  'open questions': 'Unresolved decisions, each with an owner.',
  assets: 'What is worth protecting, and why.',
  actors: 'Who interacts with this, including the ones you would rather not have.',
  'trust boundaries': 'Where trust changes. Name what crosses each boundary.',
  threats: 'Each threat, its affected asset, and its likelihood.',
  controls: 'What stops each threat. Point at the implementation.',
  'residual risks': 'What remains after the controls, and who accepted it.',
  assumptions: 'What must be true for this document to remain correct.',
  trigger: 'The exact signal that starts this procedure.',
  preconditions: 'What must be true before you begin.',
  diagnostics: 'Commands and queries that tell you what is actually happening.',
  procedure: 'Numbered steps. Each step has one action and one expected result.',
  validation: 'How you know it worked.',
  rollback: 'How to undo this, and the point past which you cannot.',
  escalation: 'Who to wake, and when.',
  install: 'The shortest path from nothing to installed.',
  usage: 'The smallest useful example, runnable as written.',
  steps: 'Numbered, each with its expected result.',
  security: 'Trust boundaries, secrets, authorization. Link the threat model.',
  performance: 'Targets, measured not guessed.',
  observability: 'Signals, dashboards, alerts.',
  migration: 'How existing data and clients move across.',
  rollout: 'Order, gates, and the blast radius at each stage.',
  testing: 'What is covered, at which level, and what is deliberately not.',
  status: 'proposed | accepted | superseded',
  decision: 'The decision, in one sentence, in the active voice.',
  alternatives: 'What else was considered and why it lost.',
  consequences: 'What this makes easier, and what it makes harder.',
};

/** @returns {string|null} hand-authored template body, if one exists */
export function override(type) {
  const f = path.join(TEMPLATE_DIR, `${type}.md`);
  return exists(f) ? read(f) : null;
}

/**
 * @param {{type:string, title?:string, id?:string, cfg:object, domain?:string|null,
 *          relationships?:object, owner?:string|null, visibility?:string|null}} args
 */
export function create({ type, title, id, cfg, domain = null, relationships = null, owner = null, visibility = null }) {
  const def = typeDef(type);
  if (!TYPES[type]) throw new Error(`unknown document type: ${type}`);
  const docId = id || slug(title || def.label);
  const meta = {
    id: docId,
    type,
    authority: def.authority,
    audience: audienceFor(def),
    visibility: visibility || def.visibility || 'internal',
    status: 'draft',
  };
  if (domain) meta.domain = domain;
  if (owner || cfg.profile?.require_owner) meta.owner = owner || 'unassigned';
  if (relationships && Object.keys(relationships).length) meta.relationships = relationships;
  if (def.generated) meta.generation = { mode: 'generated' };
  else meta.generation = { mode: 'human-maintained' };
  if (def.authority === 'canonical' || def.authority === 'constitution') meta.review = { cadence: '90d' };

  const front = `---\n${yaml.stringify({ docgov: meta })}---\n`;
  const body = override(type) ?? synthesize(type, title || def.label);
  return front + body;
}

export function synthesize(type, title) {
  const def = typeDef(type);
  const L = [`# ${title}`, ''];
  L.push(`> ${def.label}. ${guidanceFor(def)}`);
  L.push('');
  const sections = def.sections || [];
  if (sections.length === 0) {
    L.push('<!-- No required sections for this document class. Keep it focused on one concept. -->');
    L.push('');
    return L.join('\n');
  }
  for (const s of sections) {
    L.push(`## ${s}`);
    L.push('');
    const hint = SECTION_HINTS[s.toLowerCase()];
    L.push(`<!-- ${hint || `${s}.`} -->`);
    L.push('');
  }
  return L.join('\n');
}

function guidanceFor(def) {
  const limit = def.hard ? `Keep it under ${def.soft} lines; ${def.hard} triggers review.` : '';
  const auth = {
    constitution: 'Changes here should be rare and deliberate — everything else defers to this.',
    canonical: 'This is the authoritative description. Lower-authority documents may not contradict it.',
    requirements: 'This explains what is being built and why, not how the code happens to work today.',
    decision: 'Record the decision and the alternatives. Do not rewrite history; supersede instead.',
    generated: 'Generated — do not edit by hand. Change the source and regenerate.',
    audience: 'Written for its reader, not for the architecture. Link depth rather than embedding it.',
    historical: 'Historical record. Correct only factual errors.',
    'machine-contract': 'The contract is authoritative; prose describing it is not.',
  }[def.authority] || '';
  return [auth, limit].filter(Boolean).join(' ');
}

function audienceFor(def) {
  return {
    readme: ['everyone'], developer: ['engineering'], architecture: ['engineering', 'architecture'],
    security: ['engineering', 'security'], user: ['users'], operations: ['operations'], agent: ['agents'],
  }[def.lens] || ['engineering'];
}

/** Frontmatter block for an existing document that has none (used by `organize`). */
export function frontmatterFor({ type, id, title, cfg, domain = null, visibility = null, owner = null }) {
  const def = typeDef(type);
  const meta = {
    id, type, authority: def.authority, audience: audienceFor(def),
    visibility: visibility || def.visibility || 'internal', status: 'active',
  };
  if (domain) meta.domain = domain;
  if (cfg.profile?.require_owner) meta.owner = owner || 'unassigned';
  meta.generation = { mode: def.generated ? 'generated' : 'human-maintained' };
  return meta;
}

export function listTypes() {
  return Object.entries(TYPES).map(([id, t]) => ({
    type: id, label: t.label, authority: t.authority, lens: t.lens,
    soft: t.soft || '', hard: t.hard || '', sections: (t.sections || []).length,
    handwritten: exists(path.join(TEMPLATE_DIR, `${id}.md`)) ? 'yes' : '',
  }));
}
