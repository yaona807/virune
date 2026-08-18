# Contributing to Virune

日本語: [CONTRIBUTING_ja.md](CONTRIBUTING_ja.md)

Thank you for contributing to Virune. This document defines the repository-level workflow for issues, branches, pull requests, validation, review, and contribution rights.

## Principles

Prioritize correctness, safety, compatibility, determinism, reproducibility, maintainability, performance, then implementation speed.

Do not weaken language semantics, safety boundaries, tests, quality/security/compatibility/reproducibility gates, or public API/ABI contracts merely to make implementation or CI easier. Treat unknown or unresolved states conservatively; do not upgrade them to safe or successful without evidence.

Repository-owned configuration, scripts, and CI are canonical for formatting and validation. Check existing commands before adding a new validation path.

## Project policies

Contributors are also expected to follow the repository's public project policies:

- [Code of Conduct](CODE_OF_CONDUCT.md) for community behavior and the current moderation boundary;
- [Project Governance](GOVERNANCE.md) for maintainer authority and project decision-making;
- [Security Policy](SECURITY.md) for vulnerability reporting and security response.

These documents have distinct responsibilities. Do not treat private maintainer notes or automation-only working state as contributor requirements unless the applicable requirement is represented in a public canonical project artifact.

## Security reports

Do not disclose suspected security vulnerabilities in public issues, discussions, pull requests, or other public channels. Follow [`SECURITY.md`](SECURITY.md) for private vulnerability reporting and the fail-closed fallback procedure when GitHub private vulnerability reporting is unavailable.

## Contributor rights and licensing

Virune's current project-owned repository snapshot is distributed under the [Apache License 2.0](LICENSE). Unless you explicitly state otherwise, a Contribution that you intentionally submit for inclusion in Virune is submitted under the terms and conditions of Apache License 2.0, without additional terms or conditions, consistent with Section 5 of that license. If this guide conflicts with the license text, the license text controls.

By submitting a Contribution, you are responsible for ensuring that you have the rights and authorization necessary to submit it. Do not submit material that you do not have permission to contribute, including code or content copied from an employer, another project, a private source, or any other third party when the applicable terms do not permit the submission.

When a Contribution includes or is derived from third-party code, data, documentation, generated material, or other content, identify the source and applicable license or permission when that information is material to review. Do not remove required copyright, attribution, license, or notice information. Unknown or unresolved provenance or licensing must not be treated as project-owned Apache-2.0 material; raise it in the issue or pull request so it can be resolved before merge.

Using code generation or AI-assisted development does not, by itself, require a special disclosure. The person submitting the Contribution remains responsible for its correctness, safety, provenance, licensing, and compliance with this repository's review and validation requirements. Do not rely on a tool's output as evidence that material is safe to submit or compatible with the project's license.

Virune records project attribution in [`NOTICE`](NOTICE). Contributors retain whatever copyright they hold in their original contributions; submitting a Contribution under the terms above does not transfer copyright ownership to the project. Do not add or rewrite project-wide copyright or attribution notices without a separately reviewed governance reason.

Virune does not currently require a Contributor License Agreement (CLA), Developer Certificate of Origin (DCO), or `Signed-off-by` line. These mechanisms may be reconsidered only if a concrete future requirement independently justifies them; they are not implied by ordinary contribution acceptance today.

Acceptance of a Contribution does not represent or guarantee that the project will be able to relicense that Contribution under different terms in the future.

## Issues

Implementation changes should normally be linked to an issue. Distinguish Tracking Issues from Implementation Issues explicitly.

### Work item role

Every development work-item Issue must contain a Markdown heading named `Work item role` followed by exactly one explicit role value:

- `Implementation` — one concrete work item whose explicit observable completion criteria can determine whether that work is complete. A Change proposal normally uses its Acceptance Criteria; a Bug report uses the required Expected behavior as the baseline criterion and may add further acceptance criteria.
- `Tracking` — a parent or coordination item that groups or sequences separate implementation work and is not sufficient as the sole implementation reference for a normal implementation PR.

The public Bug report and Change proposal Issue Forms provide these two values as a required selection. Manually authored project Issues use the same heading and value contract. GitHub Issue Forms and manually authored Issues may use different Markdown heading levels; the heading name and the single role value are the semantic contract.

Do not infer a missing or malformed work-item role from the Issue title, labels, author, paths, branch name, recency, or surrounding prose. Resolve the role explicitly during triage instead.

Include the following when relevant:

- Background / Problem
- Goal
- Scope
- Acceptance Criteria or equivalent explicit observable completion criteria
- Non-goals
- Architecture / invariants
- Dependencies
- Compatibility / safety boundaries

A merged PR does not by itself mean an issue is complete. For normal implementation work, use plain `Refs #...` references rather than `Closes`, `Fixes`, `Resolves`, or a GitHub closing relationship. Merge the reviewed PR, verify the Issue's explicit observable completion criteria on current `main`, update the completion evidence when appropriate, and then close the Issue explicitly. If Nightly, release, observation-period, or other post-merge evidence is required, keep the Issue open until that evidence exists.

A normal implementation PR must reference an `Implementation` Issue. It may also reference one or more `Tracking` parents separately; a Tracking Issue does not replace the implementation work item.

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

Backlog or otherwise unstarted Issues may remain unassigned. Once implementation work actually starts, assign the person who is currently accountable for carrying that work forward. Assignees are ownership metadata, not concurrency locks and not safety or merge-eligibility evidence.

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
- Implementation Issue, using plain `Refs #...`
- Tracking / parent Issues, separately when applicable
- Changed boundaries
- Non-goals / invariants
- Validation
- Compatibility / safety impact
- Stack or superseded relationship

GitHub is authoritative for the mutable current PR base and head identity. Do not maintain manually copied `current base` or `current head` fields in the PR body as if they were live state. When formal CI, an artifact, or another evidence item applies to one immutable commit, identify that exact SHA alongside the evidence. If the PR head changes, evidence from an older head is stale and must not be presented as evidence for the new head.

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
