/**
 * Path predicates, in one place because drift and impact were each carrying their own
 * copy and they drifted apart — which is how `bin/docgov` became invisible to the drift
 * engine that governs it.
 *
 * The important distinction here:
 *
 *   `isMappable` gates a **graph lookup**. The question is "does some document claim this
 *   path?", and the graph is the authority on that, not a file-extension list. Filtering by
 *   extension first silently discarded every extensionless executable, shell script,
 *   Dockerfile, Makefile and config file a document had explicitly mapped.
 *
 *   `CODE_RE` gates a **heuristic** — "did behaviour probably change?" — where a list of
 *   known source extensions is exactly the right tool and a false negative costs nothing.
 */

export const MD_RE = /\.mdx?$/i;

export const CONTRACT_RE =
  /\.(proto|graphql|gql)$|openapi.*\.(ya?ml|json)$|schema\.prisma$|(^|\/)schemas?\/.*\.json$/;

export const TEST_RE = /(^|\/)(test|tests|spec|__tests__)\/|\.(test|spec)\./;

/** Known source extensions, plus scripts and infrastructure-as-code. Heuristic use only. */
export const CODE_RE = new RegExp(
  '\\.(' + [
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'rb', 'java', 'kt', 'kts',
    'swift', 'cs', 'php', 'ex', 'exs', 'erl', 'scala', 'clj', 'dart', 'lua', 'pl', 'r',
    'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'mm', 'sql', 'vue', 'svelte', 'astro',
    'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'tf', 'hcl',
  ].join('|') + ')$',
);

/** Files that are conventionally executable or build logic despite having no extension. */
const EXTENSIONLESS_CODE =
  /(^|\/)(bin|sbin|scripts?|hooks|cmd)\/[^/.]+$|(^|\/)(Dockerfile|Makefile|Rakefile|Gemfile|Brewfile|Procfile|Justfile|CMakeLists\.txt)$/i;

/** Does this path look like code for the purposes of the behaviour heuristic? */
export function isCode(p) {
  return CODE_RE.test(p) || EXTENSIONLESS_CODE.test(p);
}

/**
 * Can this path be mapped to a document by the graph?
 *
 * Deliberately broad. If a document declares `documents: ["assets/schema.png"]` then that
 * image is something the document claims, and a change to it is something a reviewer should
 * see. Only markdown (which is the documentation, not the thing documented) and DocGov's own
 * state are excluded.
 */
export function isMappable(p) {
  return !MD_RE.test(p) && !p.startsWith('.docgov/');
}
