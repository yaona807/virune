# Self-hosting promotion policy

[English](self-hosting-promotion-policy.md) | [日本語](self-hosting-promotion-policy_ja.md)

`selfhost/promotion-policy.v1.json` is the machine-readable policy for promoting self-host checks from non-blocking observation to required gates and, eventually, a manually approved production default.

## Safety invariants

The policy is fail-closed and fixes the following invariants:

- the production compiler default remains `legacy` in policy v1;
- the fixed Seed is never updated automatically;
- no policy stage can switch production automatically;
- the Legacy compiler must be retained for at least one release cycle;
- each promotion depends on completion of the preceding stage;
- all required compatibility, bootstrap, runtime, ABI, performance, clean-bootstrap, and rollback signals must be successful;
- required-gate and production stages require minimum nightly history and observation days;
- internal opt-in and production-default eligibility require explicit manual approval.

## Stages

1. `non_blocking_pr`: format, build, unit, and differential smoke observation on pull requests.
2. `nightly_shadow`: full non-blocking shadow evidence collected by Nightly.
3. `required_selfhost`: required only for self-host-related paths after 14 consecutive Nightly successes over at least 7 days.
4. `required_compiler`: expands required coverage to compiler paths after 30 successes over at least 14 days.
5. `internal_opt_in`: enables a manually approved internal opt-in route without changing the production default.
6. `production_default`: becomes manually eligible only after 60 successes over at least 30 days and every required signal passes.

Eligibility is not an execution instruction. The evaluator always returns `automatic: false`; external tooling must treat an eligible decision as permission to request a separate, reviewed transition.

## Evidence

The evaluator consumes explicit evidence:

- completed promotion targets;
- named boolean signals;
- consecutive successful Nightly count;
- observation-day count;
- manual approval state.

Missing signals are failures. Unknown or malformed policy fields are rejected. Stage and signal lists are ordered and unique so the JSON policy remains deterministic and reviewable.

## Current boundary

This policy does not modify workflows, branch protection, compiler selection, the production default, the fixed Seed, the stable Compiler API, Runtime ABI, Interop ABI, grammar, or public standard library.
