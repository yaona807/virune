# Virune Project Governance

日本語: [GOVERNANCE_ja.md](GOVERNANCE_ja.md)

## Current governance model

Virune is currently a public open-source project with one project maintainer, [`@yaona807`](https://github.com/yaona807). This document describes the governance that actually exists today. It does not create a steering committee, voting body, foundation, or additional maintainer role by implication.

The public repository is the source of truth for current code, public specifications, repository-owned policy, Issues, Pull Requests, and review evidence. [CONTRIBUTING.md](CONTRIBUTING.md) is the canonical contributor-workflow policy and [SECURITY.md](SECURITY.md) is the canonical security-reporting policy.

Private notes, automation coordination, or maintainer-only working state do not create requirements for external contributors or merge eligibility unless the applicable requirement is represented in the repository or another publicly referenced canonical project artifact.

## Maintainer responsibility and authority

The current project maintainer is responsible for:

- triaging Issues and Pull Requests;
- maintaining the public project roadmap and work-item boundaries;
- reviewing and merging changes;
- maintaining repository settings and required validation;
- making release and distribution decisions;
- coordinating security response under the security policy;
- moderating project-controlled community spaces under the [Code of Conduct](CODE_OF_CONDUCT.md);
- keeping public project policy aligned with actual project behavior.

Maintainer authority is not permission to bypass Virune's documented correctness, safety, compatibility, determinism, reproducibility, review, or release boundaries. Unknown or unresolved states must not be declared safe or complete merely because the maintainer prefers a change.

## Decision classes

### Routine implementation decisions

Ordinary fixes, features, tests, refactors, documentation changes, and CI improvements follow [CONTRIBUTING.md](CONTRIBUTING.md): use an appropriate Issue, keep the Pull Request to one logical change, validate the behavior, perform adversarial review, and use current exact-head formal CI evidence before merge.

### Public contract changes

A change that affects the Language Specification, Compiler API, Runtime ABI, Interop ABI, public standard library, externally consumed machine-readable output, compatibility promises, or another reviewed public contract requires an explicit Issue or proposal describing the affected boundary and migration/compatibility impact.

Such a change must not be justified solely by implementation convenience, Self-hosting convenience, or the desire to make CI pass. It requires the relevant tests and public documentation, compatibility and safety analysis, adversarial review to zero actionable findings, current exact-head formal CI, and final exact-head review before merge.

### Security decisions

Security-sensitive investigation may remain private while disclosure would increase risk. The process, supported-version boundary, remediation requirements, and eventual public disclosure record follow [SECURITY.md](SECURITY.md). Confidential handling does not permit required security, release, or regression validation to be silently weakened.

### Release decisions

A release is an explicit maintainer decision after the repository's applicable release, security, compatibility, and reproducibility gates are satisfied. CI success alone is not authority to publish when a release-specific policy or observation requirement remains unresolved.

### Governance decisions

Changes to contributor obligations, maintainer authority, moderation authority, merge policy, release authority, or this governance model require an explicit governance Issue and a reviewable repository change. Public Markdown governance documents are maintained in English and Japanese together.

## How decisions are made

Virune does not currently use majority voting or a formal consensus committee. Contributors are encouraged to present evidence, alternatives, compatibility impact, and concrete objections in the relevant Issue or Pull Request. The maintainer makes the final project decision based on the documented project principles and reviewed evidence, and significant rationale should remain visible in the public work item when it is safe to publish.

A disagreement is not resolved by narrowing Acceptance Criteria after the fact, weakening a gate, or treating an unknown state as successful. When evidence is insufficient, the decision remains unresolved or the change remains unmerged.

## Adding or changing maintainers

There is no automatic maintainer promotion based on contribution count, employment, sponsorship, or time in the project. Virune currently has no additional maintainer team to which authority can be delegated.

If another maintainer is added in the future, the project must first document the real authority being granted, including review/merge scope, release authority, security access, moderation responsibility, and repository administration as applicable. Required permissions should be no broader than the role needs.

Virune also does not currently claim an independent moderation body for reports concerning the sole maintainer; that limitation is documented in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Any future independent moderation process must identify the actual responsible parties and authority before the project claims that process exists.

## Emergency and continuity boundaries

A security incident, compromised credential, infrastructure failure, or maintainer unavailability may justify pausing merge, publication, or release activity. It does not justify bypassing required safety or provenance checks.

No automatic transfer of the official Virune project identity or administrative assets is defined today. The broader continuity work is tracked by [Issue #248](https://github.com/yaona807/virune/issues/248). Apache-2.0 continues to permit lawful forks according to the license, but a fork does not become an official Virune release merely by continuing development.

## Changing this document

Governance changes should describe the problem being solved, the authority or obligation being changed, compatibility and safety implications, and the intended transition for existing work. Update [GOVERNANCE.md](GOVERNANCE.md) and [GOVERNANCE_ja.md](GOVERNANCE_ja.md) in the same Pull Request.
