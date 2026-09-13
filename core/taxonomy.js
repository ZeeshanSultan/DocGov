/**
 * The default documentation taxonomy: authority tiers, document classes, their
 * canonical locations in both layout profiles, size limits, required sections,
 * and quality thresholds.
 *
 * Everything here is data and every field is overridable by .docgov/config.yaml
 * or by a policy pack (V3). Nothing in the engine hardcodes a document class.
 */

/** PRD §5 authority model. Lower rank wins a contradiction. */
export const AUTHORITY = {
  constitution:      { rank: 0, tier: 0, label: 'CONSTITUTION' },
  canonical:         { rank: 1, tier: 1, label: 'CANONICAL' },
  requirements:      { rank: 2, tier: 2, label: 'REQUIREMENTS' },
  decision:          { rank: 2, tier: 2, label: 'DECISION' },
  'machine-contract':{ rank: 3, tier: 3, label: 'CONTRACT' },
  implementation:    { rank: 4, tier: 4, label: 'CODE' },
  generated:         { rank: 5, tier: 5, label: 'GENERATED' },
  audience:          { rank: 6, tier: 6, label: 'AUDIENCE' },
  historical:        { rank: 7, tier: 7, label: 'HISTORICAL' },
};

export const VISIBILITY = ['public', 'internal', 'confidential', 'generated-public', 'generated-internal'];
export const STATUS = ['draft', 'active', 'deprecated', 'superseded', 'archived'];

/**
 * Statuses that mean "this document is no longer what to follow". A superseded document is
 * usually still *true about the past*, which is exactly what makes it dangerous: nothing in
 * its prose says it has been replaced, so it reads as current to anyone — and to any agent —
 * that finds it. It stays in the repository as a record and stays out of anything that
 * answers "what is true now".
 */
export const HISTORICAL_STATUS = new Set(['superseded', 'deprecated', 'archived']);

/** Is this document still the one to follow? */
export function isCurrent(doc) {
  return !HISTORICAL_STATUS.has(doc?.status);
}
export const MODES = ['solo', 'team', 'enterprise', 'open-source'];

/** PRD §8 relationship edges. `inverse` powers reverse traversal in the graph. */
export const RELATIONSHIPS = {
  depends_on:    { inverse: 'depended_on_by' },
  defines:       { inverse: 'defined_by' },
  implements:    { inverse: 'implemented_by' },
  derived_from:  { inverse: 'derives' },
  supersedes:    { inverse: 'superseded_by' },
  references:    { inverse: 'referenced_by' },
  validated_by:  { inverse: 'validates' },
  generated_from:{ inverse: 'generates' },
  exposes:       { inverse: 'exposed_by' },
  documents:     { inverse: 'documented_by' },
  // A README that restates an architecture document, and a public document written from an
  // internal one, are both derivations — the source moving ahead of them is a real finding,
  // and one nothing could express before.
  summarizes:       { inverse: 'summarized_by' },
  public_version_of:{ inverse: 'has_public_version' },
};

/**
 * Edges where one document is written *from* another. When the source moves and the
 * derivative does not, the derivative is not merely unverified — it is describing something
 * that has changed underneath it.
 */
export const DERIVATION_RELS = ['derived_from', 'generated_from', 'summarizes', 'public_version_of'];

/** PRD §11 audience lenses. Files in lenses/ hold the reviewer prompts. */
export const LENSES = ['readme', 'developer', 'architecture', 'security', 'user', 'agent', 'operations'];

/**
 * Document classes.
 *  full    — path prefix in the numbered taxonomy (PRD §6)
 *  compact — path in the small-project layout (PRD §6, second listing)
 *  soft/hard — line limits (PRD §13)
 *  quality — advisory score threshold (PRD §20)
 *  sections — required template headings, deterministic gate (PRD §21)
 */
export const TYPES = {
  'constitution.product': {
    label: 'Product Constitution', authority: 'constitution', lens: 'architecture',
    full: 'docs/00-canonical/PRODUCT.md', compact: 'docs/PRODUCT.md', singleton: true,
    soft: 400, hard: 700, quality: 90, visibility: 'internal', template: 'tier0/product',
    sections: ['Purpose', 'Scope', 'Users', 'Invariants', 'Non-goals'],
  },
  'constitution.principles': {
    label: 'Principles', authority: 'constitution', lens: 'architecture',
    full: 'docs/00-canonical/PRINCIPLES.md', compact: 'docs/PRINCIPLES.md', singleton: true,
    soft: 300, hard: 500, quality: 85, visibility: 'internal', template: 'tier0/principles',
    sections: ['Principles', 'Trade-offs', 'Applying these'],
  },
  'constitution.invariants': {
    label: 'Invariants', authority: 'constitution', lens: 'architecture',
    full: 'docs/00-canonical/INVARIANTS.md', compact: 'docs/INVARIANTS.md', singleton: true,
    soft: 400, hard: 800, quality: 95, visibility: 'internal', template: 'tier0/invariants',
    sections: ['Invariants'],
  },
  'constitution.glossary': {
    label: 'Glossary', authority: 'constitution', lens: 'developer',
    full: 'docs/00-canonical/GLOSSARY.md', compact: 'docs/GLOSSARY.md', singleton: true,
    soft: 400, hard: 800, quality: 85, visibility: 'internal', template: 'tier0/glossary',
    sections: ['Terms'],
  },
  'constitution.domains': {
    label: 'Domain Map', authority: 'constitution', lens: 'architecture',
    full: 'docs/00-canonical/DOMAINS.md', compact: 'docs/DOMAINS.md', singleton: true,
    soft: 300, hard: 600, quality: 90, visibility: 'internal', template: 'tier0/domains',
    sections: ['Domains', 'Ownership', 'Boundaries'],
  },

  'product.vision': {
    label: 'Product Vision', authority: 'requirements', lens: 'architecture',
    full: 'docs/01-product/vision/', compact: 'docs/product/', soft: 400, hard: 700,
    quality: 85, visibility: 'internal', template: 'tier2/vision',
    sections: ['Context', 'Vision', 'Success looks like', 'Non-goals'],
  },
  'product.prd': {
    label: 'PRD', authority: 'requirements', lens: 'developer',
    full: 'docs/01-product/requirements/', compact: 'docs/product/', soft: 800, hard: 1200,
    quality: 90, visibility: 'internal', template: 'tier2/prd',
    sections: ['Context', 'Problem', 'Goals', 'Non-goals', 'Personas', 'Requirements',
      'Functional requirements', 'Non-functional requirements', 'Security considerations',
      'Edge cases', 'Dependencies', 'Acceptance criteria', 'Open questions'],
  },
  'product.feature': {
    label: 'Feature Spec', authority: 'requirements', lens: 'developer',
    full: 'docs/01-product/features/', compact: 'docs/product/', soft: 500, hard: 900,
    quality: 85, visibility: 'internal', template: 'tier2/feature',
    sections: ['Summary', 'Behaviour', 'Requirements', 'Edge cases', 'Acceptance criteria'],
  },
  'product.persona': {
    label: 'Persona', authority: 'requirements', lens: 'user',
    full: 'docs/01-product/personas/', compact: 'docs/product/', soft: 200, hard: 400,
    quality: 80, visibility: 'internal', template: 'tier2/persona',
    sections: ['Who', 'Goals', 'Frustrations', 'Context of use'],
  },
  'product.roadmap': {
    label: 'Roadmap', authority: 'requirements', lens: 'user',
    full: 'docs/01-product/roadmap/', compact: 'docs/product/', soft: 300, hard: 500,
    quality: 75, visibility: 'internal', template: 'tier2/roadmap',
    sections: ['Now', 'Next', 'Later', 'Not planned'],
  },

  'design.ux': {
    label: 'UX Specification', authority: 'requirements', lens: 'user',
    full: 'docs/02-design/ux/', compact: 'docs/design/', soft: 700, hard: 1000,
    quality: 85, visibility: 'internal', template: 'tier2/ux',
    sections: ['Context', 'Users and tasks', 'Flows', 'States', 'Copy', 'Accessibility', 'Open questions'],
  },
  'design.flow': {
    label: 'User Flow', authority: 'requirements', lens: 'user',
    full: 'docs/02-design/flows/', compact: 'docs/design/', soft: 300, hard: 500,
    quality: 80, visibility: 'internal', template: 'tier2/flow',
    sections: ['Entry points', 'Steps', 'Failure paths', 'Exit states'],
  },
  'design.accessibility': {
    label: 'Accessibility Spec', authority: 'requirements', lens: 'user',
    full: 'docs/02-design/accessibility/', compact: 'docs/design/', soft: 400, hard: 700,
    quality: 85, visibility: 'internal', template: 'tier2/accessibility',
    sections: ['Target level', 'Requirements', 'Known gaps', 'Testing'],
  },

  'architecture.overview': {
    label: 'Architecture Overview', authority: 'canonical', lens: 'architecture',
    full: 'docs/03-architecture/overview/', compact: 'docs/architecture.md', soft: 400, hard: 700,
    quality: 90, visibility: 'internal', template: 'tier2/arch-overview',
    sections: ['Purpose', 'Context', 'Components', 'Data flows', 'Key decisions', 'Where to go next'],
  },
  'architecture.domain': {
    label: 'Canonical Domain Spec', authority: 'canonical', lens: 'architecture',
    full: 'docs/03-architecture/domains/', compact: 'docs/architecture/', soft: 700, hard: 1000,
    quality: 90, visibility: 'internal', template: 'tier2/domain',
    sections: ['Purpose', 'Boundaries', 'Model', 'Invariants', 'Interfaces',
      'Failure modes', 'Dependencies', 'Open questions'],
  },
  'architecture.component': {
    label: 'Component Spec', authority: 'canonical', lens: 'architecture',
    full: 'docs/03-architecture/components/', compact: 'docs/architecture/', soft: 500, hard: 800,
    quality: 85, visibility: 'internal', template: 'tier2/component',
    sections: ['Responsibility', 'Interfaces', 'Dependencies', 'Failure modes'],
  },
  'architecture.data': {
    label: 'Data Model', authority: 'canonical', lens: 'architecture',
    full: 'docs/03-architecture/data/', compact: 'docs/architecture/', soft: 600, hard: 1000,
    quality: 85, visibility: 'internal', template: 'tier2/data-model',
    sections: ['Entities', 'Relationships', 'Lifecycle', 'Retention', 'Migrations'],
  },
  'architecture.integration': {
    label: 'Integration Spec', authority: 'canonical', lens: 'architecture',
    full: 'docs/03-architecture/integrations/', compact: 'docs/architecture/', soft: 500, hard: 800,
    quality: 85, visibility: 'internal', template: 'tier2/integration',
    sections: ['Counterparty', 'Contract', 'Auth', 'Failure modes', 'Rate limits'],
  },
  'architecture.trd': {
    label: 'TRD', authority: 'requirements', lens: 'developer',
    full: 'docs/03-architecture/components/', compact: 'docs/architecture/', soft: 1000, hard: 1500,
    quality: 90, visibility: 'internal', template: 'tier2/trd',
    sections: ['Context', 'Requirements mapping', 'Existing architecture', 'Proposed architecture',
      'Components', 'Data model', 'Interfaces', 'State transitions', 'Failure handling', 'Security',
      'Performance', 'Observability', 'Migration', 'Testing', 'Rollout', 'Rollback', 'Open questions'],
  },
  'architecture.assessment': {
    label: 'Technical Assessment', authority: 'decision', lens: 'architecture',
    full: 'docs/03-architecture/overview/', compact: 'docs/', soft: 600, hard: 1000,
    quality: 85, visibility: 'internal', template: 'tier2/assessment',
    sections: ['Verdict', 'Findings', 'Risks'],
  },
  'architecture.adr': {
    label: 'ADR', authority: 'decision', lens: 'architecture',
    full: 'docs/03-architecture/adr/', compact: 'docs/adr/', soft: 200, hard: 350,
    quality: 90, visibility: 'internal', template: 'tier2/adr', idPattern: '^adr-\\d{3,4}-',
    sections: ['Status', 'Context', 'Decision', 'Alternatives', 'Consequences', 'Security implications'],
  },

  'security.architecture': {
    label: 'Security Architecture', authority: 'canonical', lens: 'security',
    full: 'docs/04-security/architecture/', compact: 'docs/security.md', soft: 700, hard: 1000,
    quality: 95, visibility: 'internal', template: 'tier2/security-arch',
    sections: ['Scope', 'Trust boundaries', 'Identity', 'Authorization', 'Secrets',
      'Data protection', 'Assumptions'],
  },
  'security.threat-model': {
    label: 'Threat Model', authority: 'canonical', lens: 'security',
    full: 'docs/04-security/threat-models/', compact: 'docs/security/', soft: 700, hard: 1000,
    quality: 95, visibility: 'internal', template: 'tier2/threat-model',
    sections: ['Scope', 'Assets', 'Actors', 'Trust boundaries', 'Entry points', 'Data flows',
      'Threats', 'Controls', 'Residual risks', 'Assumptions'],
  },
  'security.authorization': {
    label: 'Authorization Model', authority: 'canonical', lens: 'security',
    full: 'docs/04-security/authorization/', compact: 'docs/security/', soft: 500, hard: 800,
    quality: 95, visibility: 'internal', template: 'tier2/authorization',
    sections: ['Subjects', 'Resources', 'Actions', 'Rules', 'Escalation paths'],
  },
  'security.data-classification': {
    label: 'Data Classification', authority: 'canonical', lens: 'security',
    full: 'docs/04-security/data-classification/', compact: 'docs/security/', soft: 400, hard: 700,
    quality: 95, visibility: 'internal', template: 'tier2/data-classification',
    sections: ['Classes', 'Handling rules', 'Storage', 'Retention'],
  },
  'security.public-model': {
    label: 'Public Security Model', authority: 'audience', lens: 'security',
    full: 'SECURITY.md', compact: 'SECURITY.md', singleton: true, soft: 200, hard: 400,
    quality: 90, visibility: 'public', template: 'tier6/security-public',
    sections: ['Reporting a vulnerability', 'Supported versions', 'What we protect', 'Scope'],
  },

  'engineering.development': {
    label: 'Development Guide', authority: 'audience', lens: 'developer',
    full: 'docs/05-engineering/development/', compact: 'docs/development.md', soft: 500, hard: 800,
    quality: 85, visibility: 'internal', template: 'tier6/development',
    sections: ['Prerequisites', 'Setup', 'Running', 'Testing', 'Troubleshooting'],
  },
  'engineering.testing': {
    label: 'Testing Strategy', authority: 'canonical', lens: 'developer',
    full: 'docs/05-engineering/testing/', compact: 'docs/engineering/', soft: 500, hard: 800,
    quality: 85, visibility: 'internal', template: 'tier2/testing',
    sections: ['Levels', 'What we test', 'What we do not test', 'Tooling', 'Gates'],
  },
  'engineering.conventions': {
    label: 'Conventions', authority: 'canonical', lens: 'developer',
    full: 'docs/05-engineering/conventions/', compact: 'docs/engineering/', soft: 400, hard: 700,
    quality: 80, visibility: 'internal', template: 'tier2/conventions',
    sections: ['Naming', 'Structure', 'Style', 'Review expectations'],
  },
  'engineering.dependencies': {
    label: 'Dependency Policy', authority: 'canonical', lens: 'developer',
    full: 'docs/05-engineering/dependencies/', compact: 'docs/engineering/', soft: 300, hard: 600,
    quality: 80, visibility: 'internal', template: 'tier2/dependencies',
    sections: ['Policy', 'Approved', 'Prohibited', 'Review process'],
  },

  'operations.deployment': {
    label: 'Deployment Guide', authority: 'canonical', lens: 'operations',
    full: 'docs/06-operations/deployment/', compact: 'docs/operations/', soft: 500, hard: 800,
    quality: 90, visibility: 'internal', template: 'tier2/deployment',
    sections: ['Environments', 'Pipeline', 'Promotion', 'Rollback', 'Verification'],
  },
  'operations.infrastructure': {
    label: 'Infrastructure', authority: 'canonical', lens: 'operations',
    full: 'docs/06-operations/infrastructure/', compact: 'docs/operations/', soft: 600, hard: 1000,
    quality: 85, visibility: 'internal', template: 'tier2/infrastructure',
    sections: ['Topology', 'Components', 'Scaling', 'Cost', 'Access'],
  },
  'operations.configuration': {
    label: 'Configuration Reference', authority: 'generated', lens: 'operations',
    full: 'docs/06-operations/configuration/', compact: 'docs/operations/', soft: 600, hard: 1200,
    quality: 80, visibility: 'internal', template: 'tier3/configuration',
    // Same reasoning as user.reference: a configuration reference is frequently hand-written.
    sections: ['Settings'],
  },
  'operations.observability': {
    label: 'Observability', authority: 'canonical', lens: 'operations',
    full: 'docs/06-operations/observability/', compact: 'docs/operations/', soft: 500, hard: 800,
    quality: 85, visibility: 'internal', template: 'tier2/observability',
    sections: ['Signals', 'Dashboards', 'Alerts', 'SLOs', 'On-call'],
  },
  'operations.runbook': {
    label: 'Runbook', authority: 'audience', lens: 'operations',
    full: 'docs/06-operations/runbooks/', compact: 'docs/operations/runbooks/', soft: 400, hard: 700,
    quality: 90, visibility: 'internal', template: 'ops/runbook',
    sections: ['Purpose', 'Trigger', 'Preconditions', 'Diagnostics', 'Procedure',
      'Validation', 'Rollback', 'Escalation'],
  },
  'operations.disaster-recovery': {
    label: 'Disaster Recovery', authority: 'canonical', lens: 'operations',
    full: 'docs/06-operations/disaster-recovery/', compact: 'docs/operations/', soft: 500, hard: 800,
    quality: 95, visibility: 'internal', template: 'ops/disaster-recovery',
    sections: ['Scenarios', 'RPO and RTO', 'Backups', 'Restore procedure', 'Testing'],
  },

  'release.notes': {
    label: 'Release Notes', authority: 'historical', lens: 'user',
    full: 'docs/07-release/releases/', compact: 'CHANGELOG.md', soft: 400, hard: 1500,
    quality: 75, visibility: 'public', template: 'tier7/release-notes',
    sections: ['Highlights', 'Changes', 'Breaking changes', 'Upgrade notes'],
  },
  'release.changelog': {
    label: 'Changelog', authority: 'historical', lens: 'user',
    full: 'CHANGELOG.md', compact: 'CHANGELOG.md', singleton: true, soft: 500, hard: 2000,
    quality: 75, visibility: 'public', template: 'tier6/changelog',
    // Keep a Changelog structures a changelog by release, not by fixed sections. DocGov
    // adopts that convention rather than competing with it, so the structural gate here is
    // location and size, not section names.
    sections: [],
  },
  'release.migration': {
    label: 'Migration Guide', authority: 'audience', lens: 'user',
    full: 'docs/07-release/migrations/', compact: 'docs/release/', soft: 500, hard: 800,
    quality: 90, visibility: 'public', template: 'tier7/migration',
    sections: ['Who this affects', 'What changed', 'Steps', 'Verification', 'Rollback'],
  },
  'release.deprecation': {
    label: 'Deprecation Notice', authority: 'historical', lens: 'user',
    full: 'docs/07-release/deprecations/', compact: 'docs/release/', soft: 200, hard: 400,
    quality: 85, visibility: 'public', template: 'tier7/deprecation',
    sections: ['What is deprecated', 'Why', 'Timeline', 'Replacement', 'Migration'],
  },

  'user.readme': {
    label: 'README', authority: 'audience', lens: 'readme',
    full: 'README.md', compact: 'README.md', singleton: true, soft: 300, hard: 500,
    quality: 85, visibility: 'public', template: 'tier6/readme',
    sections: ['Install', 'Usage'],
  },
  'user.getting-started': {
    label: 'Getting Started', authority: 'audience', lens: 'user',
    full: 'docs/08-user/getting-started/', compact: 'docs/user-guide.md', soft: 400, hard: 700,
    quality: 90, visibility: 'public', template: 'tier6/getting-started',
    sections: ['Before you start', 'Install', 'First task', 'What next'],
  },
  'user.guide': {
    label: 'User Guide', authority: 'audience', lens: 'user',
    full: 'docs/08-user/guides/', compact: 'docs/user/', soft: 700, hard: 1000,
    quality: 85, visibility: 'public', template: 'tier6/guide',
    sections: ['Goal', 'Steps', 'Verification', 'Related'],
  },
  'user.admin-guide': {
    label: 'Administrator Guide', authority: 'audience', lens: 'operations',
    full: 'docs/08-user/guides/', compact: 'docs/user/', soft: 700, hard: 1000,
    quality: 85, visibility: 'public', template: 'tier6/admin-guide',
    sections: ['Audience', 'Setup', 'Operations', 'Security', 'Troubleshooting'],
  },
  'user.tutorial': {
    label: 'Tutorial', authority: 'audience', lens: 'user',
    full: 'docs/08-user/guides/', compact: 'docs/user/', soft: 500, hard: 800,
    quality: 85, visibility: 'public', template: 'tier6/tutorial',
    sections: ['What you will build', 'Prerequisites', 'Steps', 'What you learned'],
  },
  'user.troubleshooting': {
    label: 'Troubleshooting', authority: 'audience', lens: 'user',
    full: 'docs/08-user/troubleshooting/', compact: 'docs/user/', soft: 600, hard: 1000,
    quality: 80, visibility: 'public', template: 'tier6/troubleshooting',
    sections: ['Symptoms'],
  },
  'user.faq': {
    label: 'FAQ', authority: 'audience', lens: 'user',
    full: 'docs/08-user/faq/', compact: 'docs/user/', soft: 400, hard: 800,
    quality: 75, visibility: 'public', template: 'tier6/faq',
    sections: ['Questions'],
  },
  'user.reference': {
    label: 'Reference', authority: 'generated', lens: 'developer',
    full: 'docs/08-user/reference/', compact: 'docs/reference/', soft: 1000, hard: 3000,
    quality: 80, visibility: 'public', template: 'tier3/reference',
    // Deliberately not `generated: true`. A reference is as often hand-written (a CLI
    // command reference, a glossary) as generated from a schema, and marking the class
    // generated made `create` stamp generation.mode: generated, which the generated-edit
    // check then blocked — so the class could not be used for the hand-written case at all.
    // Generation is a property of a document, not of its class: declare
    // `generation.mode: generated` in frontmatter, or put it under a generated path, which
    // is the stronger guard and the one that actually enforces.
    sections: [],
  },

  'governance.contributing': {
    label: 'Contributing Guide', authority: 'audience', lens: 'developer',
    full: 'CONTRIBUTING.md', compact: 'CONTRIBUTING.md', singleton: true, soft: 400, hard: 700,
    quality: 85, visibility: 'public', template: 'tier6/contributing',
    sections: ['Before you start', 'Development setup', 'Submitting changes', 'Review process'],
  },
  'governance.code-of-conduct': {
    label: 'Code of Conduct', authority: 'audience', lens: 'user',
    full: 'CODE_OF_CONDUCT.md', compact: 'CODE_OF_CONDUCT.md', singleton: true, soft: 200, hard: 400,
    quality: 80, visibility: 'public', template: 'tier6/code-of-conduct',
    sections: ['What is expected', 'What is not acceptable', 'Scope', 'Reporting'],
  },
  'governance.attribution': {
    // NOTICE, THIRD-PARTY-NOTICES, ATTRIBUTIONS, CREDITS. Attribution files satisfy the
    // notice requirement of the licences a project redistributes under, so they ship at
    // the root where distributions and licence-compliance tooling look for them, and the
    // exact filename varies by ecosystem. Left unclassified they were proposed for a move
    // into docs/10-internal/ — which would both hide them and mark a public legal notice
    // internal.
    label: 'Third-Party Notices', authority: 'audience', lens: 'developer',
    full: 'THIRD-PARTY-NOTICES.md', compact: 'THIRD-PARTY-NOTICES.md', anchored: true,
    soft: 500, hard: 5000, quality: 60, visibility: 'public',
    template: 'tier6/attribution',
    sections: [],
  },
  'governance.support': {
    label: 'Support Policy', authority: 'audience', lens: 'user',
    full: 'SUPPORT.md', compact: 'SUPPORT.md', singleton: true, soft: 200, hard: 400,
    quality: 80, visibility: 'public', template: 'tier6/support',
    sections: ['Where to get help', 'Response expectations', 'What is out of scope'],
  },
  'governance.lifecycle': {
    label: 'Lifecycle Policy', authority: 'canonical', lens: 'developer',
    full: 'docs/09-governance/lifecycle/', compact: 'docs/governance/', soft: 300, hard: 600,
    quality: 85, visibility: 'public', template: 'tier2/lifecycle',
    sections: ['Versioning', 'Support windows', 'Deprecation policy'],
  },
  'governance.policy': {
    label: 'Policy', authority: 'canonical', lens: 'developer',
    full: 'docs/09-governance/policies/', compact: 'docs/governance/', soft: 400, hard: 700,
    quality: 85, visibility: 'internal', template: 'tier2/policy',
    sections: ['Scope', 'Policy', 'Enforcement', 'Exceptions'],
  },

  'contract.openapi': {
    label: 'OpenAPI Contract', authority: 'machine-contract', lens: 'developer',
    full: 'openapi/', compact: 'openapi/', soft: 0, hard: 0, quality: 0,
    visibility: 'internal', machine: true, extensions: ['.yaml', '.yml', '.json'], sections: [],
  },
  'contract.schema': {
    label: 'Schema', authority: 'machine-contract', lens: 'developer',
    full: 'schemas/', compact: 'schemas/', soft: 0, hard: 0, quality: 0,
    visibility: 'internal', machine: true, extensions: ['.json', '.yaml', '.proto', '.graphql'], sections: [],
  },

  'docs.index': {
    label: 'Index', authority: 'audience', lens: 'developer',
    // An index belongs to its directory, wherever that is, so it has no canonical
    // location and `wrong-location` never fires on it.
    full: 'docs/', compact: 'docs/', anywhere: true,
    soft: 200, hard: 400, quality: 75, visibility: 'internal', sections: [],
  },
  'note.internal': {
    label: 'Internal Note', authority: 'historical', lens: 'developer',
    full: 'docs/10-internal/', compact: 'docs/internal/', soft: 400, hard: 1000,
    quality: 70, visibility: 'confidential', template: 'tier7/note',
    sections: [],
  },
  'archive.document': {
    label: 'Archived Document', authority: 'historical', lens: 'developer',
    full: 'docs/99-archive/', compact: 'docs/archive/', soft: 0, hard: 0, quality: 0,
    visibility: 'internal', frozen: true, sections: [],
  },
  'agent.instructions': {
    // Not one file: CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules and
    // .github/copilot-instructions.md are each read by a different harness, from a path
    // that harness hard-codes. Treating the class as a singleton at CLAUDE.md gave every
    // one of them CLAUDE.md as its destination, which is a collision, not a move.
    label: 'Agent Instructions', authority: 'canonical', lens: 'agent',
    full: 'CLAUDE.md', compact: 'CLAUDE.md', anchored: true, soft: 300, hard: 500, quality: 85,
    visibility: 'internal', template: 'tier2/agent-instructions',
    sections: [],
  },
  unknown: {
    label: 'Unclassified', authority: 'historical', lens: 'developer',
    full: 'docs/10-internal/', compact: 'docs/internal/', soft: 400, hard: 800,
    quality: 0, visibility: 'internal', sections: [],
  },
};

/** Namespaces created by `docgov setup --layout full` (PRD §6: may stay empty). */
export const FULL_NAMESPACES = [
  'docs/00-canonical', 'docs/01-product/vision', 'docs/01-product/requirements',
  'docs/01-product/features', 'docs/01-product/personas', 'docs/01-product/roadmap',
  'docs/02-design/ux', 'docs/02-design/ui', 'docs/02-design/flows', 'docs/02-design/accessibility',
  'docs/03-architecture/overview', 'docs/03-architecture/domains', 'docs/03-architecture/components',
  'docs/03-architecture/data', 'docs/03-architecture/integrations', 'docs/03-architecture/adr',
  'docs/04-security/architecture', 'docs/04-security/threat-models', 'docs/04-security/authorization',
  'docs/04-security/data-classification', 'docs/04-security/security-testing',
  'docs/05-engineering/development', 'docs/05-engineering/testing', 'docs/05-engineering/conventions',
  'docs/05-engineering/dependencies',
  'docs/06-operations/deployment', 'docs/06-operations/infrastructure', 'docs/06-operations/configuration',
  'docs/06-operations/observability', 'docs/06-operations/runbooks', 'docs/06-operations/disaster-recovery',
  'docs/07-release/releases', 'docs/07-release/migrations', 'docs/07-release/deprecations',
  'docs/08-user/getting-started', 'docs/08-user/guides', 'docs/08-user/reference',
  'docs/08-user/troubleshooting', 'docs/08-user/faq',
  'docs/09-governance/contribution', 'docs/09-governance/support', 'docs/09-governance/lifecycle',
  'docs/09-governance/policies',
  'docs/10-internal', 'docs/11-external', 'docs/90-generated', 'docs/99-archive',
];

export const COMPACT_NAMESPACES = ['docs', 'docs/adr'];

/** Paths that must only ever contain documents of a given visibility (PRD §10). */
export const VISIBILITY_PATHS = [
  { glob: 'docs/10-internal/**', require: ['internal', 'confidential'] },
  { glob: 'docs/internal/**', require: ['internal', 'confidential'] },
  { glob: 'docs/11-external/**', require: ['public', 'generated-public'] },
  { glob: 'docs/public/**', require: ['public', 'generated-public'] },
  { glob: 'docs/04-security/threat-models/**', require: ['internal', 'confidential'] },
];

/** Generated trees: manual edits are denied, not warned (FEASIBILITY §3.2). */
export const GENERATED_PATHS = ['docs/90-generated/**', 'docs/generated/**'];

export function authorityOf(type) { return (TYPES[type] || TYPES.unknown).authority; }
export function tierOf(type) { return AUTHORITY[authorityOf(type)].tier; }
export function typeDef(type) { return TYPES[type] || TYPES.unknown; }
export function typeIds() { return Object.keys(TYPES); }

/** Can `a` legitimately contradict `b`? Only if it is at least as authoritative. */
export function mayContradict(aType, bType) {
  return AUTHORITY[authorityOf(aType)].rank <= AUTHORITY[authorityOf(bType)].rank;
}
