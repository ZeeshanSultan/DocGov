# <System> — Threat Model

> This document names risks that are not yet fixed. It must stay `visibility: internal`.
> The public counterpart is a separate document (`security.public-model`), not a redaction.

## Scope

<!-- What this covers and, just as importantly, what it does not. Out-of-scope components need their own model or an explicit statement that they are trusted. -->

## Assets

<!-- What is worth protecting, in priority order, and why. Data, availability, integrity, reputation. -->

## Actors

<!--
Each actor with capability and motive. Include the unglamorous ones: a legitimate user
exceeding their authorization, a compromised dependency, an employee with production access,
an automated agent acting on an injected instruction.
-->

## Trust boundaries

<!-- Where trust changes. For each: what crosses it, what is validated there, and by what. -->

## Entry points

<!-- Every way input enters: endpoints, queues, webhooks, file uploads, CLI, admin interfaces, agent tool calls. -->

## Data flows

<!-- How data moves between boundaries, in what form, with what protection at each hop. -->

## Threats

<!--
Each threat: the asset, the actor, the entry point, the mechanism, and the likelihood. Give
each an id so controls and residual risks can cite it.
-->

## Controls

<!-- What stops each threat, with a link to the implementation. A control with no threat is a checklist item; a threat with no control belongs under residual risks. -->

## Residual risks

<!-- What remains after the controls. Who accepted it, when, and under what condition it needs revisiting. An empty section here almost always means the analysis stopped early. -->

## Assumptions

<!-- What must be true for this model to hold. When one of these breaks, this list tells you what else just broke. -->
