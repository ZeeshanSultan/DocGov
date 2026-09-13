# <System or change name> — Technical Requirements

## Context

<!-- Why this document exists and what it implements. Link the PRD; do not restate it. -->

## Requirements mapping

<!-- Each PRD requirement id → where in this document it is addressed. This table is how a reviewer checks coverage. -->

## Existing architecture

<!-- What is there now, honestly, including the parts you wish were different. Link the canonical domain documents. -->

## Proposed architecture

<!-- What it becomes. Boundaries, responsibilities, what moves. -->

## Components

<!-- Each component: what it owns, what it depends on, what it exposes. -->

## Data model

<!-- Entities, relationships, lifecycle. Reference the migration or schema; do not copy it. -->

## Interfaces

<!-- APIs, events, queues. Point at the machine contract. The contract is authoritative; this section is orientation. -->

## State transitions

<!-- Legal states and the transitions between them. Which transitions are irreversible. -->

## Failure handling

<!--
Each failure mode: how it is detected, what degrades, what the user sees, what recovers
automatically and what needs a human. A TRD without this section is a design sketch.
-->

## Security

<!-- Trust boundaries, authorization checkpoints, secret handling, data classification. Link the threat model. -->

## Performance

<!-- Expected load, measured baseline, target, and where the first bottleneck will be. -->

## Observability

<!-- What signals prove this is working, which dashboard shows them, which alert fires when it stops. -->

## Migration

<!-- How existing data and clients move across. Backfill, dual-write, cutover. What is reversible and where that stops. -->

## Testing

<!-- What is covered at which level, and what is deliberately not covered and why. -->

## Rollout

<!-- Order, gates, flag strategy, blast radius at each stage. -->

## Rollback

<!-- How to undo at each stage, and the point of no return. If there is no rollback, say so here, in bold. -->

## Open questions

<!-- Unresolved, each with an owner. -->
