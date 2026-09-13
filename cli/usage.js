/**
 * The only help text in the product. It is the first thing most people read and the last
 * thing anyone remembers to update, so it lives on its own where a missing command is
 * visible rather than buried at the bottom of a thousand lines.
 */
import path from 'node:path';
import * as judge from '../core/judgements.js';
import { EXIT, write, read } from '../core/util.js';
import { json } from './output.js';
import { packageVersion } from './context.js';

export function usage() {
  console.log(`docgov ${packageVersion()} — your AI writes docs faster than anyone can check them. DocGov checks them.

Start here
  setup [--mode M] [--layout full|compact]   turn DocGov on in this repo
        [--rules]                            regenerate .claude/rules/documentation.md only
  review                                     look at the docs you already have, write a fix plan
  fix [--dry-run] [--include split,..] [--skip ID,..]  run that plan on a branch; reverts itself if it breaks

Every day
  create <type> "<name>" [--domain D]        new doc, right place, right template, wired up
                                             --check asks who owns the topic, writes nothing
  check [--changed] [--base REF] [--all]     the checks that can block you; exit 1 blocks, 2 needs a look
  affected [--base REF] [paths...]           which docs your change affects
  checklist [--pr]                           those docs as a checklist; --pr prints the PR comment
  find "<query>"                             search your docs, best source first
  whatis [--path P]                          what is this document, and where does it belong
  brief <topic> [--explain]                  everything an agent must know about an area, and
                                             nothing else; --explain says how it chose

When something is off
  stale [--base REF]                         docs the code moved out from under
  health                                     score your docs out of 100, and what is missing
  inspect <stale|contradictions|quality>     build a review packet for an agent to read
  tag [--apply] [--path P]                   add missing frontmatter
  rules [--for paths]                        the rules your docs declare, and the code they govern
  ignore <ID> --reason "..." [--expires D]   record a deliberate exception
  judge --file <f.json> [--agent N]          record what a model concluded (never blocks)
  publish [--target DIR]                     what is safe to publish, and what would leak

Plumbing
  types [filter]        registry [--rebuild]        graph [--dot] [--save]        tools
  hook <pre-tool|pre-write|post-write|session-start|pre-code-edit|stop>
  doctor                is any of this actually working?
  version               help

Every command takes --json.
Exit codes: 0 fine · 1 blocked · 2 needs a look · 3 config error.`);
  return EXIT.OK;
}
