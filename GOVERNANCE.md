# Virune Project Governance

日本語: [GOVERNANCE_ja.md](GOVERNANCE_ja.md)

## Current governance model

Virune is currently a public open-source project maintained by one project maintainer, [`@yaona807`](https://github.com/yaona807). This document describes the governance that exists today. It does not imply a steering committee, voting body, foundation, or additional maintainer role.

The public repository is authoritative for current code, public specifications, repository-owned policy, Issues, Pull Requests, and review records. [CONTRIBUTING.md](CONTRIBUTING.md) defines the contributor workflow. [SECURITY.md](SECURITY.md) defines the security-reporting process.

Private notes, internal automation coordination, and maintainer-only working state do not by themselves impose obligations on external contributors or affect merge eligibility. Any such requirement must be documented in the repository or in another authoritative project document that is publicly referenced.

## Maintainer responsibilities and authority

The current project maintainer is responsible for:

- triaging and prioritizing Issues and Pull Requests;
- maintaining the public roadmap and work-item scope;
- reviewing and merging changes;
- maintaining repository settings and required validation;
- making release and distribution decisions;
- coordinating security response under the security policy;
- moderating project-controlled community spaces under the [Code of Conduct](CODE_OF_CONDUCT.md);
- keeping public project policy aligned with actual project operation.

These responsibilities do not allow the maintainer to bypass Virune's documented requirements for correctness, safety, compatibility, determinism, reproducibility, review, or release. An unknown or unresolved state must not be treated as safe or complete merely because the maintainer wants a change to proceed.

## Decision classes

### Routine implementation changes

Routine bug fixes, features, tests, refactors, documentation changes, and CI improvements follow [CONTRIBUTING.md](CONTRIBUTING.md). Use an appropriate Issue, keep each Pull Request to one logical change, validate the change, perform adversarial review, and verify formal CI against the current PR head before merge.

### Public contract changes

A change that affects the Language Specification, Compiler API, Runtime ABI, Interop ABI, public standard library, externally consumed machine-readable output, compatibility guarantees, or another reviewed public contract requires an explicit Issue or proposal. That work item must describe the affected surface and the migration or compatibility impact.

Such a change must not be justified solely by implementation convenience, Self-hosting convenience, or the desire to make CI pass. Before merge, it requires the relevant tests and public documentation, compatibility and safety analysis, adversarial review to zero actionable findings, formal CI against the current PR head, and final exact-head review.

### Security decisions

Security-sensitive investigations may remain private while disclosure would increase risk. The reporting and response process, supported versions, remediation requirements, and eventual public disclosure record follow [SECURITY.md](SECURITY.md). Private handling does not allow required security, release, or regression validation to be weakened.

### Release decisions

A release is an explicit maintainer decision made only after the repository's applicable release, security, compatibility, and reproducibility gates are satisfied. A passing CI run is not enough to publish while a release-specific policy or observation requirement remains unresolved.

### Governance decisions

Changes to contributor obligations, maintainer authority, moderation authority, merge policy, release authority, or this governance model require an explicit governance Issue and a reviewable repository change. Public Markdown governance documents are maintained in English and Japanese together.

## How decisions are made

Virune does not currently use majority voting or a formal consensus committee. Contributors are encouraged to present evidence, alternatives, compatibility impact, and concrete objections in the relevant Issue or Pull Request. The maintainer makes the final decision based on the documented project principles and reviewed evidence. Significant rationale should remain visible in the public work item when it is safe to publish.

A disagreement must not be treated as resolved by narrowing Acceptance Criteria after the fact, weakening a gate, or treating an unknown state as successful. If the evidence is insufficient, the decision remains unresolved or the change remains unmerged.

## Adding or changing maintainers

There is no automatic maintainer promotion based on contribution count, employment, sponsorship, or time in the project. Virune currently has no additional maintainer team to which authority can be delegated.

If another maintainer is added in the future, the project must first document the authority actually being granted. As applicable, this includes review and merge scope, release authority, security access, moderation responsibility, and repository administration. Permissions must be no broader than the role requires.

Virune also does not currently claim that an independent body exists to review reports concerning the sole maintainer. This limitation is documented in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). If an independent moderation process is introduced in the future, the project must identify the actual responsible parties and their authority before claiming that the process exists.

## Emergencies and continuity

A security incident, compromised credential, infrastructure failure, or maintainer unavailability may require merge, publication, or release activity to pause. It does not justify skipping required safety or provenance checks.

Virune does not currently define an automatic transfer process for the official project identity or administrative assets. Broader continuity work is tracked in [Issue #248](https://github.com/yaona807/virune/issues/248). Apache-2.0 permits forks in accordance with the license, but a fork does not become an official Virune release merely because development continues there.

## Changing this document

A governance change should describe the problem being solved, the authority or obligation being changed, its compatibility and safety implications, and how existing work should transition. Update [GOVERNANCE.md](GOVERNANCE.md) and [GOVERNANCE_ja.md](GOVERNANCE_ja.md) in the same Pull Request.
