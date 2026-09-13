import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { typeDef } from './taxonomy.js';
import { read, exists } from './util.js';

/**
 * Lenses: the standard a document is judged against, chosen by what the document is.
 *
 * One prompt used to do two unrelated jobs against one generic standard. Both halves of that
 * were wrong.
 *
 * **The two jobs are not the same question.** "Does this read like a README" is a quality
 * judgement: a false positive wastes somebody's afternoon arguing about prose, so the bar for
 * raising it should be high. "Might this leak a credential" is a security question: a false
 * positive costs ten seconds of looking, and a false negative publishes a secret. They want
 * opposite tolerances, so they cannot share a prompt, a severity or a switch.
 *
 * **One standard cannot judge every class.** A README optimises for a stranger getting
 * running in five minutes; an ADR for whether the reasoning survives the author leaving; a
 * runbook for being executable at three in the morning by someone who did not write it; an
 * API reference for precision. Told to "review this document", a model applies whichever of
 * those it happens to think of, and its finding is unfalsifiable because the standard was
 * never stated.
 *
 * So the deterministic half picks the lens — it knows the class, and that is not a judgement
 * call — and the model applies the lens it was handed. That is the same division as
 * everywhere else in the engine, and it is what makes a lens finding answerable: the standard
 * is written down, in `lenses/`, and the reader can disagree with it.
 */

const LENS_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'lenses');

/** Every lens that ships, and the one question each exists to ask. */
export const LENSES = {
  readme: 'Can a stranger tell what this is and get it running in five minutes?',
  developer: 'Can someone build against this without reading the source?',
  architecture: 'Are the boundaries, trade-offs and consequences legible to whoever inherits this?',
  user: 'Can the intended reader complete the task without already knowing the answer?',
  operations: 'Could someone who did not write this execute it under pressure at 3am?',
  security: 'Is the threat model stated, and does the document avoid becoming an attack guide?',
  agent: 'Could another agent act on this and get it right, with nothing else to go on?',
};

/**
 * Which lens applies to a document, and is it switched on here?
 *
 * @returns {{lens:string|null, question:string|null, enabled:boolean, text:string|null}}
 */
export function lensFor(cfg, type) {
  const lens = typeDef(type)?.lens || null;
  if (!lens || !LENSES[lens]) return { lens: null, question: null, enabled: false, text: null };
  return {
    lens,
    question: LENSES[lens],
    enabled: isEnabled(cfg, 'audience', lens),
    text: lensText(lens),
  };
}

/** The lens document itself, so what the model is asked to apply is a thing people can read. */
export function lensText(lens) {
  const file = path.join(LENS_DIR, `${lens}.md`);
  return exists(file) ? read(file) : null;
}

/**
 * Is a review switched on?
 *
 * `review` is either half — `audience` or `leak` — and the two are configured separately
 * because they are different questions with opposite false-positive tolerances. Audience
 * review can also be turned off per lens, for a team that wants its runbooks judged and does
 * not want opinions about its READMEs.
 *
 *   review:
 *     audience: true          # or a list of lenses: [operations, security]
 *     leak: true
 *
 * Both default on. A tool that quietly reviews less than the user thinks is worse than one
 * that reviews more.
 */
export function isEnabled(cfg, kind, lens = null) {
  const setting = cfg?.review?.[kind];
  if (setting === false) return false;
  if (Array.isArray(setting)) return lens == null ? setting.length > 0 : setting.includes(lens);
  return true;
}

/** Every lens currently in force, for `docgov doctor` and the rules file to report. */
export function enabledLenses(cfg) {
  return Object.keys(LENSES).filter((l) => isEnabled(cfg, 'audience', l));
}
