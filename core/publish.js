import { VISIBILITY } from './taxonomy.js';
import { matchAny } from './util.js';

/**
 * Publishing analysis (PRD §29).
 *
 * DocGov never copies an internal document outward. It identifies what is
 * publishable, flags what leaks, and hands the rewrite to a human or an agent
 * under the external lens. The boundary is deliberate, not incidental (PRD §43).
 */

/** Patterns that should never cross the internal/external boundary. */
const LEAK_PATTERNS = [
  { id: 'internal-host', re: /\b(?:[a-z0-9-]+\.)+(?:internal|local|corp|intranet|lan)\b/gi, what: 'internal hostname' },
  { id: 'private-ip', re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}(?:\.\d{1,3})?\b/g, what: 'private IP address' },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, what: 'AWS access key id' },
  { id: 'bearer', re: /\b(?:bearer|token|api[_-]?key|secret)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}/gi, what: 'credential-shaped string' },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, what: 'private key block' },
  { id: 'jira', re: /\b(?:[A-Z]{2,10}-\d{1,6})\b/g, what: 'internal ticket reference', soft: true },
  { id: 'internal-path', re: /\/(?:Users|home)\/[a-z0-9._-]+\//gi, what: 'developer machine path' },
  { id: 'employee-email', re: /\b[a-z0-9._%+-]+@(?!example\.)(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, what: 'email address', soft: true },
  { id: 'internal-jargon', re: /\b(?:TODO|FIXME|HACK|XXX|WIP)\b/g, what: 'work-in-progress marker' },
  { id: 'threat-detail', re: /\b(?:exploit|attack vector|unmitigated|known vulnerability|CVE-\d{4}-\d+)\b/gi, what: 'unmitigated-risk language', soft: true },
];

/**
 * @param {{cfg:object, docs:any[], target?:string}} args
 */
export function analyze({ cfg, docs, target = 'docs/11-external' }) {
  const publishable = [], blocked = [], rewrite = [];

  for (const d of docs) {
    const isPublic = d.visibility === 'public' || d.visibility === 'generated-public';
    const leaks = scan(d);
    const hard = leaks.filter((l) => !l.soft);

    if (!isPublic) {
      if (d.visibility === 'confidential') {
        blocked.push({ path: d.path, reason: 'confidential documents are never publishable', leaks: leaks.length });
      } else {
        rewrite.push({
          path: d.path, currentVisibility: d.visibility, leaks,
          reason: 'internal document — publishing requires an external-lens rewrite, not a copy',
          suggestedTarget: `${target}/${d.path.split('/').pop()}`,
        });
      }
      continue;
    }
    if (hard.length) blocked.push({ path: d.path, reason: `${hard.length} sensitive pattern(s) detected`, leaks: hard });
    else publishable.push({ path: d.path, visibility: d.visibility, softFlags: leaks.length });
  }

  return { publishable, blocked, rewrite, target,
    gate: 'Nothing is published by this command. Review, then publish through your own pipeline.' };
}

export function scan(doc) {
  const out = [];
  const body = doc.body ?? String(doc);
  for (const p of LEAK_PATTERNS) {
    const matches = [...body.matchAll(p.re)].slice(0, 3);
    for (const m of matches) {
      out.push({ id: p.id, what: p.what, sample: redact(m[0]), soft: Boolean(p.soft),
        line: body.slice(0, m.index).split('\n').length });
    }
  }
  return out;
}

function redact(s) {
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}…${s.slice(-3)}`;
}

/** The external lens brief handed to whichever agent does the rewrite. */
export function rewriteBrief(entry) {
  return [
    `Rewrite ${entry.path} for an external audience. This is a new artifact, not a copy.`,
    '',
    'Remove or generalize:',
    ...entry.leaks.map((l) => `  - line ${l.line}: ${l.what} (${l.sample})`),
    '',
    'External lens requirements:',
    '  - no internal jargon, team names, or ticket references',
    '  - no unmitigated risks, internal hostnames, or infrastructure topology',
    '  - task-oriented: what the reader wants to do, not how the system is built',
    '  - state prerequisites explicitly',
    '  - every example runnable as written',
    '',
    'A human must approve the result before it is published.',
  ].join('\n');
}
