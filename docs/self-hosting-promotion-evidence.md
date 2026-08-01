# Self-host promotion evidence evaluation

[English](self-hosting-promotion-evidence.md) | [日本語](self-hosting-promotion-evidence_ja.md)

The promotion evidence evaluator applies the checked-in self-host promotion policy to one exact compiler candidate. It is a pure TypeScript Host component: it returns a deterministic decision record and never changes a workflow, branch protection rule, compiler default, release channel, or repository state.

## Inputs

The evaluator accepts three data-only inputs:

1. the versioned promotion policy;
2. a requested promotion stage ID;
3. a candidate-bound evidence observation.

The observation contains:

- one 40- or 64-character candidate SHA;
- consecutive successful-run and observation-day counts;
- unexplained differential count;
- manual-approval, rollback-evidence, and stable-release-cycle values;
- evidence items with ID, passed／failed status, candidate SHA, source, and completion timestamp.

Every evidence item is bound to the same candidate SHA. Evidence from another commit is stale and cannot be reused.

## Fail-closed evaluation

Promotion is blocked when any of the following occurs:

- malformed policy, stage, requirement, observation, or evidence data;
- unknown or duplicate stage IDs;
- duplicate evidence IDs;
- missing required evidence;
- failed evidence, including evidence not required by the selected stage;
- evidence bound to another candidate SHA;
- insufficient consecutive successful runs or observation days;
- unexplained differentials above the policy maximum;
- missing required manual approval or rollback evidence;
- insufficient stable release cycles.

Reasons are returned in deterministic evaluation order. Required evidence is checked in policy order, and thresholds are checked in a fixed order.

## Decision values

The result has one of three decisions:

- `blocked`: at least one fail-closed reason exists;
- `manual`: evidence is eligible, but the policy or stage requires human promotion;
- `automatic`: evidence is eligible and both the global policy and stage permit automatic promotion.

The current checked-in policy has `automaticPromotionAllowed: false`, so an otherwise eligible candidate returns `manual`. The evaluator does not perform that manual action.

## Candidate and threshold reporting

The result includes:

- normalized lowercase candidate SHA;
- eligibility and decision;
- missing, failed, and stale evidence IDs;
- actual and required successful runs and observation days;
- actual and maximum unexplained differentials;
- actual and required stable release cycles;
- structured reason codes, paths, and messages.

Identical policy, stage, and observation inputs produce an identical result.

## Boundaries

This component does not:

- modify `.github/self-hosting/promotion-policy-v1.json`;
- enable nightly, required, or production workflows;
- collect evidence from GitHub or another external system;
- approve, merge, release, or switch compiler implementations;
- change the grammar, Compiler API, Runtime ABI, Interop ABI, or public standard library.

Evidence collection, persistence, signature or attestation verification, and promotion execution remain separate Host responsibilities and require their own reviewed changes.
