# Contributing to Virune

Thank you for contributing to Virune. This document defines the repository-level workflow for issues, branches, pull requests, validation, and review.

## Principles

Prioritize correctness, safety, compatibility, determinism, reproducibility, maintainability, performance, then implementation speed.

Do not weaken language semantics, safety boundaries, tests, quality/security/compatibility/reproducibility gates, or public API/ABI contracts merely to make implementation or CI easier. Treat unknown or unresolved states conservatively; do not upgrade them to safe or successful without evidence.

Repository-owned configuration, scripts, and CI are canonical for formatting and validation. Check existing commands before adding a new validation path.

## Issues

Implementation changes should normally be linked to an issue. Distinguish tracking issues from implementation issues.

Include the following when relevant:

- Background / Problem
- Goal
- Scope
- Acceptance Criteria
- Non-goals
- Architecture / invariants
- Dependencies
- Compatibility / safety boundaries

A merged PR does not by itself mean an issue is complete. Close an issue when its Acceptance Criteria are satisfied on current `main`. If Nightly, release, observation-period, or other post-merge evidence is required, keep the issue open until that evidence exists.

Use `Refs #...` by default in PRs. Use `Closes #...` only when merging the PR itself satisfies all Acceptance Criteria.

### Label taxonomy

Labels are organizational metadata only. They must not determine safety, required CI, or merge eligibility.

**Type** — normally exactly one:

`type:bug`, `type:feature`, `type:refactor`, `type:test`, `type:ci`, `type:docs`, `type:security`, `type:chore`

**Area** — zero or more as needed:

`area:compiler`, `area:selfhost`, `area:interop`, `area:runtime`, `area:stdlib`, `area:cli`, `area:dx`, `area:release`, `area:governance`

**Priority** — optional, at most one:

`priority:p0` through `priority:p3`

**Workflow** — exceptional states only:

`workflow:validation-only`, `workflow:superseded`, `workflow:blocked`

Backlog issues may remain unassigned. Assign the person who is currently accountable for the work. Assignees are ownership metadata, not concurrency locks.

## Branches

Start independent work from current `main`.

Prefer branch names that identify the purpose and, when practical, the issue, for example:

- `feat/326-interop-provider-facts`
- `fix/349-selfhost-propagation`
- `docs/269-contributor-workflow`

Stacked PRs are exceptional. Prefer stack depth 1 and do not exceed 2.

After a parent PR is squash-merged, prefer reconstructing a child cleanly from current `main` when history repair would be noisy. Do not create ancestry-repair-only PRs as normal workflow, and do not force-update an old or superseded branch merely to make it appear current.

## Pull requests

Keep each PR to one logical, reviewable change. Prefer Conventional Commit-style titles such as `feat(interop): ...`, `fix(selfhost): ...`, `test(selfhost): ...`, `ci(selfhost): ...`, or `docs(governance): ...`.

Document, as relevant:

- Summary / Scope
- Related issue
- Exact base / current head when evidence depends on them
- Changed boundaries
- Non-goals / invariants
- Validation
- Compatibility / safety impact
- Stack or superseded relationship

For safety-sensitive changes, state both what changed and what intentionally did not change.

Use Draft PRs while implementation is incomplete, dependencies are pending, formal validation has not completed, the PR is validation-only, or design review is still required.

A validation-only PR must be explicitly identified and must not be merged. Close it after the required evidence is captured. A superseded PR must identify its replacement and must not be merged.

Squash merge is the default merge method.

## Tests and validation

Behavior changes require tests. Bug fixes should include a regression test when practical.

Choose cases appropriate to the change, including positive/negative, malformed, stale, partial, unknown, boundary, cleanup/rollback, determinism, and compatibility cases.

Review the tests themselves: assertions must be strong enough to detect a wrong implementation, and tests must not simply encode the same misunderstanding as the implementation.

Prefer existing repository-owned commands. Relevant commands are defined in `package.json`, including general verification and focused Self-hosting inventory, differential, reconstruction, bootstrap, and rollback checks.

## CI evidence

Formal CI evidence belongs to the exact PR head SHA. After the head changes, do not use success from an older head as evidence for the new head.

Before merge, verify as applicable:

- required formal checks succeed on the current head
- required checks are not unexpectedly missing or skipped
- unresolved review threads are zero
- the PR is conflict-free
- issue/PR-specific gates are satisfied
- the final adversarial review passes

Classify CI failures before acting:

- **Repository / implementation failure:** fix the cause and validate the new head. Do not blindly rerun the same head until it turns green.
- **Infrastructure failure:** a same-head rerun is acceptable only when evidence shows the repository change is not the cause.

If a diagnostic is repeatedly useful, make it a repository-owned command or workflow instead of relying on temporary validation infrastructure.

## Adversarial review

Design, implementation, PR readiness, and merge decisions require adversarial review. The purpose is to find ways the change can fail, not to defend the implementation.

Repeat this cycle:

1. Re-check requirements, Acceptance Criteria, and invariants.
2. Review the current implementation/diff adversarially.
3. List actionable findings.
4. If any finding exists, fix it.
5. Run focused validation as needed.
6. Review the changed state again from the beginning.
7. Continue until a complete review pass finds zero new actionable findings.

An actionable finding is a concrete issue affecting correctness, safety, specification compliance, compatibility, determinism, reproducibility, failure handling, security boundaries, test validity, maintainability, scope integrity, documentation, or recovery.

Do not manufacture style-only findings after the review reaches zero actionable findings.

At minimum, challenge:

- narrow interpretations of Acceptance Criteria
- happy-path-only behavior
- malformed, stale, partial, duplicate, or out-of-order inputs
- unknown-to-safe promotion and fail-open behavior
- Language Specification, Compiler API, Runtime ABI, Interop ABI, and target compatibility
- nondeterminism from locale, time, randomness, paths, filesystem ordering, or concurrency ordering
- weak tests or tests that share the implementation's assumptions
- weakened required checks or skip paths
- stale CI/evidence
- unrelated refactors or temporary workarounds
- cleanup, rollback, and retry after partial failure

If source, tests, configuration, workflows, artifact contracts, the relevant base, or the relevant specification changes, reset the zero-finding result and review again.

## Final exact-head review

After the adversarial review reaches zero actionable findings, run the required formal CI on the current exact head. Then perform a final adversarial review covering the exact head identity, formal CI, final diff, unexpected files, review threads, Acceptance Criteria, evidence, remaining TODO/temporary paths, and superseded relationships.

If the final review finds any actionable issue, do not merge. Fix it, rerun the required formal CI for the new head, and repeat the final review.

Completion requires zero actionable findings on the final exact head; CI green alone is not sufficient.

## Self-hosting guardrail

Self-hosting convenience must not change Virune's language semantics or safety model. Follow the current canonical Self-hosting issue/policy.

Do not add grammar/keywords, relax unsafe rules, add compiler-only language features, add Self-host-only public stdlib APIs, break public API/ABI contracts, or weaken quality/reproducibility gates merely to make Self-hosting easier.

Prefer, in order:

1. redesign using existing language features
2. internal algorithm improvements
3. data-only contract improvements
4. leaving responsibility on the Host side
5. a separate language proposal only when the capability is independently justified for general users
