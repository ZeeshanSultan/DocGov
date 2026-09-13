import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { walk, exists, read, matchAny, matchGlob, toPosix } from './util.js';
import { Document } from './document.js';
import { TYPES } from './taxonomy.js';
import { classify } from './classify.js';

/** Repository signals DocGov reads to infer what documentation *should* exist (PRD §16). */
const STACK_PROBES = [
  { id: 'kubernetes', files: ['k8s/**', 'kubernetes/**', '**/*.deployment.yaml', 'helm/**', 'charts/**'], expects: ['operations.deployment', 'operations.infrastructure'] },
  { id: 'terraform', files: ['**/*.tf', 'terraform/**', 'infra/**/*.tf'], expects: ['operations.infrastructure', 'operations.disaster-recovery'] },
  { id: 'docker', files: ['Dockerfile', '**/Dockerfile', 'docker-compose*.yml', 'compose.yaml'], expects: ['operations.deployment', 'engineering.development'] },
  { id: 'openapi', files: ['openapi/**', '**/openapi.{yaml,yml,json}', '**/swagger.{yaml,yml,json}', 'api/**/*.{yaml,yml}'], expects: ['user.reference', 'architecture.integration'] },
  { id: 'graphql', files: ['**/*.graphql', '**/schema.gql'], expects: ['user.reference'] },
  { id: 'protobuf', files: ['**/*.proto'], expects: ['user.reference', 'architecture.integration'] },
  { id: 'db-migrations', files: ['migrations/**', 'db/migrate/**', '**/migrations/*.sql', 'prisma/schema.prisma', 'alembic/**'], expects: ['architecture.data', 'release.migration'] },
  { id: 'prometheus', files: ['**/prometheus*.y*ml', '**/grafana/**', '**/*dashboard*.json'], expects: ['operations.observability'] },
  { id: 'ci', files: ['.github/workflows/**', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci/**'], expects: ['operations.deployment', 'engineering.testing'] },
  { id: 'tests', files: ['test/**', 'tests/**', '**/*.test.*', '**/*_test.go', '**/*_spec.rb', 'spec/**'], expects: ['engineering.testing'] },
  { id: 'auth', files: ['**/auth/**', '**/authentication/**', '**/session*.{ts,js,py,go,rb}'], expects: ['security.architecture', 'security.authorization', 'security.threat-model'] },
  { id: 'iac-secrets', files: ['**/*.env.example', '**/secrets*.y*ml', '**/vault/**'], expects: ['security.data-classification', 'operations.configuration'] },
  { id: 'mobile', files: ['ios/**', 'android/**', '**/*.xcodeproj/**', 'pubspec.yaml'], expects: ['operations.deployment', 'user.getting-started'] },
  { id: 'monorepo', files: ['pnpm-workspace.yaml', 'turbo.json', 'lerna.json', 'nx.json', 'Cargo.toml'], expects: ['engineering.conventions', 'architecture.overview'] },
];

const MANIFESTS = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt',
  'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'mix.exs', 'Package.swift'];

const AGENT_INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules', '.windsurfrules',
  '.claude/rules', '.github/copilot-instructions.md'];

const MD = /\.mdx?$/i;

/**
 * Full repository sweep. One filesystem walk, everything derived from it.
 * @param {string} root
 * @param {object} cfg
 */
export function inventory(root, cfg) {
  const all = walk(root);
  const include = cfg.documentation.include || ['**/*.md'];
  const exclude = cfg.documentation.exclude || [];

  const mdPaths = all.filter((p) => MD.test(p) && matchAny(p, include) && !matchAny(p, exclude));
  const registrations = cfg.documentation?.registrations || {};
  const documents = mdPaths.map((p) => new Document(root, p, undefined, registrations[p]));

  const contracts = [];
  for (const glob of (cfg.contracts?.openapi || [])) {
    for (const p of all) if (matchGlob(p, glob)) contracts.push({ path: p, kind: 'openapi' });
  }
  for (const p of all) {
    if (/\.proto$/.test(p)) contracts.push({ path: p, kind: 'protobuf' });
    else if (/\.graphql$|\.gql$/.test(p)) contracts.push({ path: p, kind: 'graphql' });
    else if (/(^|\/)schemas?\/.*\.json$/.test(p)) contracts.push({ path: p, kind: 'json-schema' });
    else if (/prisma\/schema\.prisma$/.test(p)) contracts.push({ path: p, kind: 'prisma' });
  }

  const stack = [];
  for (const probe of STACK_PROBES) {
    const hits = all.filter((p) => matchAny(p, probe.files));
    if (hits.length) stack.push({ id: probe.id, evidence: hits.slice(0, 4), count: hits.length, expects: probe.expects });
  }

  const manifests = MANIFESTS.filter((m) => exists(path.join(root, m)));
  const agentInstructions = AGENT_INSTRUCTION_FILES.filter((f) => exists(path.join(root, f)));

  const codePaths = all.filter((p) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|cs|php|ex|scala|c|cc|cpp|h|hpp)$/.test(p));

  return {
    root, all, documents, contracts, stack, manifests, agentInstructions, codePaths,
    counts: {
      files: all.length, documents: documents.length, contracts: contracts.length,
      code: codePaths.length, markdownLines: documents.reduce((a, d) => a + d.lines, 0),
    },
  };
}

/**
 * Documentation the repository's stack implies but which no document covers (PRD §16).
 *
 * Uses the *inferred* class, not only the declared one: before `docgov review` runs nothing is
 * annotated, and reporting an existing README as a missing README would make the first
 * health score anyone ever sees wrong.
 */
export function coverageGaps(inv) {
  const present = new Set();
  for (const d of inv.documents) {
    if (d.type !== 'unknown') { present.add(d.type); continue; }
    const c = classify(d);
    if (c.type !== 'unknown' && !c.needsReview) present.add(c.type);
  }
  const gaps = [];
  const seen = new Set();
  for (const s of inv.stack) {
    for (const type of s.expects) {
      if (present.has(type) || seen.has(type)) continue;
      seen.add(type);
      gaps.push({ type, label: (TYPES[type] || {}).label || type, because: s.id, evidence: s.evidence[0] });
    }
  }
  // Baseline documents every repository should have regardless of stack.
  for (const type of ['user.readme', 'architecture.overview', 'engineering.development']) {
    if (!present.has(type) && !seen.has(type)) {
      seen.add(type);
      gaps.push({ type, label: TYPES[type].label, because: 'baseline', evidence: null });
    }
  }
  return gaps;
}

/** Detected third-party capabilities DocGov should delegate to (PRD §17). */
export function capabilities(root, pluginNames = []) {
  const hasBin = (bin) => {
    try { execFileSync('/bin/sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }); return true; }
    catch { return false; }
  };
  return discoverCapabilities(root, hasBin, pluginNames);
}

/**
 * Capability registry. Normalizes whatever is installed into capability names so
 * skills ask "who can draw a diagram?" rather than "is mermaid-skill installed?".
 * @param {string} root
 * @param {(bin:string)=>boolean} hasBin
 * @param {string[]} [pluginNames]
 */
export function discoverCapabilities(root, hasBin, pluginNames = []) {
  const caps = {};
  const add = (cap, provider) => { (caps[cap] ||= []).push(provider); };

  const bins = [
    ['lychee', 'links.external'], ['markdownlint-cli2', 'markdown.style'], ['markdownlint', 'markdown.style'],
    ['vale', 'prose.style'], ['spectral', 'openapi.lint'], ['redocly', 'openapi.lint'],
    ['oasdiff', 'openapi.diff'], ['gh', 'github'], ['git', 'git'], ['jq', 'json'],
    ['mmdc', 'diagram.mermaid'], ['plantuml', 'diagram.plantuml'], ['typedoc', 'reference.typescript'],
    ['sphinx-build', 'reference.python'], ['cargo', 'reference.rust'], ['openapi-generator', 'reference.openapi'],
  ];
  for (const [bin, cap] of bins) if (hasBin(bin)) add(cap, `bin:${bin}`);

  const configProbes = [
    ['.vale.ini', 'prose.style', 'vale'], ['.markdownlint.json', 'markdown.style', 'markdownlint'],
    ['.markdownlint-cli2.jsonc', 'markdown.style', 'markdownlint'],
    ['.spectral.yaml', 'openapi.lint', 'spectral'], ['lychee.toml', 'links.external', 'lychee'],
    ['mkdocs.yml', 'site.mkdocs', 'mkdocs'], ['docusaurus.config.js', 'site.docusaurus', 'docusaurus'],
    ['docs/.vitepress/config.ts', 'site.vitepress', 'vitepress'], ['mint.json', 'site.mintlify', 'mintlify'],
  ];
  for (const [f, cap, provider] of configProbes) if (exists(path.join(root, f))) add(cap, `config:${provider}`);

  // Claude Code surface: MCP servers and skills visible from the repo.
  const mcpFile = path.join(root, '.mcp.json');
  if (exists(mcpFile)) {
    try {
      const servers = Object.keys(JSON.parse(read(mcpFile)).mcpServers || {});
      for (const s of servers) add('mcp', `mcp:${s}`);
    } catch { /* malformed .mcp.json is the user's problem, not a DocGov failure */ }
  }
  for (const dir of [path.join(root, '.claude', 'skills'), path.join(root, '.claude', 'agents')]) {
    if (!exists(dir)) continue;
    for (const name of walk(dir, { maxDepth: 1, includeDirs: true })) {
      if (!name.includes('/')) add(dir.endsWith('agents') ? 'agent' : 'skill', `local:${name}`);
    }
  }
  for (const p of pluginNames) add('plugin', `plugin:${p}`);

  return caps;
}
