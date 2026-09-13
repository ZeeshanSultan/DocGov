import { DocGovError } from './util.js';

/**
 * Versions for everything DocGov persists, and everything it emits for a machine to parse.
 *
 * The moment another repository holds one of these files — or a skill, hook or CI job parses
 * one of these `--json` outputs — DocGov owns a data format it can no longer change freely.
 * Several artifacts already carried `version: 1` — but nothing ever read it back, so a future
 * DocGov writing version 2 would have been silently misread by an older one rather than
 * refused. A version nobody checks is decoration.
 *
 * The field is `version`, not `schemaVersion`, because that is what the files in the wild
 * already say. Matching the data that exists is worth more than matching a nicer name.
 *
 * Raising a number here is a deliberate act. Do it when a change would make an older DocGov
 * misread the file — a renamed or retyped field, a changed meaning — and not for an added
 * optional field, which older versions ignore harmlessly. Every raise needs a migration in
 * `migrate()` below, or a reason in the changelog why none is possible.
 */
export const SCHEMA = {
  // Files under .docgov/, which other repositories hold on disk.
  config: 1,
  registry: 1,
  graph: 1,
  suppressions: 1,
  plan: 1,
  checklist: 1,
  tools: 1,
  // Machine-readable output. Nothing writes these to disk, but a skill, a hook or a CI job
  // parses them, which makes their shape a contract exactly as much as a file's is. The
  // reader is someone else's code, so all DocGov can do for them is say which shape this is.
  findings: 1,
  brief: 1,
  health: 1,
  rules: 1,
};

/** Human names, so an error says what the file is rather than which key it belongs to. */
const LABELS = {
  config: 'configuration', registry: 'document registry', graph: 'documentation graph',
  suppressions: 'suppressions file', plan: 'fix plan', checklist: 'change checklist',
  tools: 'capability registry', findings: 'findings report', brief: 'context pack',
  health: 'health report', rules: 'rule set',
};

/** Stamp an object with the current version for its artifact. */
export function stamp(artifact, obj) {
  const v = SCHEMA[artifact];
  if (v == null) throw new DocGovError(`unknown artifact "${artifact}"`);
  return { version: v, ...obj };
}

/**
 * Check a loaded artifact before anything trusts its contents.
 *
 * Older than current: handed to `migrate`, which either upgrades it or refuses.
 * Newer than current: refused. An older DocGov cannot know what a later one meant, and
 * guessing at a governance file is how a migration destroys a repository.
 */
export function check(artifact, obj, file) {
  const current = SCHEMA[artifact];
  if (current == null) throw new DocGovError(`unknown artifact "${artifact}"`);
  if (obj == null || typeof obj !== 'object') return obj;

  // A file written before versions were enforced simply has no version. Treat it as 1,
  // which is what it is — this must never reject a repository that already adopted DocGov.
  const found = obj.version == null ? 1 : obj.version;
  if (!Number.isInteger(found) || found < 1) {
    throw new DocGovError(`${file}: version must be a positive integer, found ${JSON.stringify(obj.version)}`);
  }
  if (found > current) {
    throw new DocGovError(
      `${file} was written by a newer DocGov (${LABELS[artifact]} version ${found}, this build understands ${current}). `
      + 'Upgrade DocGov rather than letting an older build reinterpret it.');
  }
  return found === current ? obj : migrate(artifact, obj, found, file);
}

/**
 * Upgrade an older artifact in memory. Nothing is rewritten on disk here: the next command
 * that saves the file writes the current version, so an upgrade is never a surprise edit.
 *
 * There are no migrations yet because nothing has reached version 2. When the first one
 * lands, add a case, and add a test that loads a real version-1 file.
 */
export function migrate(artifact, obj, from, file) {
  throw new DocGovError(
    `${file}: ${LABELS[artifact]} is version ${from} and this build expects ${SCHEMA[artifact]}, `
    + 'but no migration exists for it. This is a DocGov bug — please report the versions above.');
}
