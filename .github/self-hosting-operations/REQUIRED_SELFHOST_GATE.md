# Required self-host gate

[English](REQUIRED_SELFHOST_GATE.md) | [日本語](REQUIRED_SELFHOST_GATE_ja.md)

Virune is validating the **Required Shadow candidate** for the canonical `required-selfhost` promotion stage. The stable check name is `Required self-host gate`, but a passing check does **not** promote the repository to that blocking stage and does not change the production compiler default. Every emitted summary remains `productionEligible: false` and `promotionEligible: false`.

The source of truth is `.github/self-hosting/promotion-policy-v1.json`. The `required-selfhost` stage requires at least **14 consecutive successful runs over 14 observation days plus manual approval**. Automatic promotion is forbidden. The later `required-compiler` stage remains separate, so general `packages/compiler/src/**` changes are not yet in the Required Shadow scope unless they touch self-host-specific paths.

The workflow runs on every pull request to `main` so the check name is always present. `scripts/classify-ci-changes.mjs` exposes a dedicated `selfhost_required_gate_required` decision. Unrelated changes emit an explicit `omitted` summary and pass without running the expensive bootstrap proof; empty or invalid classifications fail safe.

For Stage 3 self-host-impacting changes, the exact pull-request head must satisfy all of the following:

1. `run-selfhost-release-gate.mjs` passes pinned Seed verification, the Stage 1 → Stage 2 transition record, exact Stage 2 == Stage 3 fixed point, dependency-offline clean bootstrap, Legacy rollback, and cross-step generation binding.
2. A second clean bootstrap runs under the perturbed environment profile on an independent runner.
3. `compare-selfhost-clean-bootstrap-evidence.mjs` proves baseline and perturbed runs agree on repository commit, lockfile, Seed, Stage 1/2/3, and candidate artifact digests.
4. `run-selfhost-required-gate.mjs` binds release-core and cross-runner evidence to the same compiler generation and exact pull-request commit, while explicitly reporting that observation history/manual approval are still outstanding.

The canonical promotion policy requires current evidence names such as `fixed-seed-verification`, `stage1-stage2-transition`, `stage2-stage3-fixed-point`, `environment-perturbation`, `independent-runner-reproducibility`, `cross-evidence-generation-binding`, `exact-head-evidence-binding`, and `legacy-rollback`. The obsolete Stage 1 == Stage 2 equality model is rejected.

Nightly fixed-point evidence must still be inspected as an actual artifact before the Nightly acceptance criterion is closed. A generic successful Nightly workflow is not sufficient because the existing self-host Nightly lane is non-blocking. Likewise, do not configure this candidate as a repository-required status solely because one pull request passes it; the 14-run/14-day history and manual approval remain separate promotion conditions.

If an upstream evidence job fails, the summary job records a fail-closed result instead of falling back to an older or unrelated proof. Do not bypass this check by adding workflow path filters or by treating CI success alone as stage promotion.
