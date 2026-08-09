# Required self-host gate

[English](REQUIRED_SELFHOST_GATE.md) | [日本語](REQUIRED_SELFHOST_GATE_ja.md)

The self-hosting promotion path is currently in **Required Shadow**. The stable check name is `Required self-host gate`, but this phase does not change the production compiler default and every emitted summary remains `productionEligible: false`.

The workflow runs on every pull request to `main` so the check name is always present. `scripts/classify-ci-changes.mjs` decides whether a change can affect self-hosting. Unrelated changes emit an explicit `omitted` summary and pass without running the expensive bootstrap proof.

For self-host-impacting changes the gate requires all of the following on the exact pull-request head:

1. `run-selfhost-release-gate.mjs` passes the pinned Seed verification, fixed-Seed Stage 2/3 fixed point, clean dependency-offline bootstrap, Legacy rollback, and cross-step generation binding.
2. A second clean bootstrap runs under the perturbed environment profile on an independent runner.
3. `compare-selfhost-clean-bootstrap-evidence.mjs` proves the baseline and perturbed runs agree on repository commit, lockfile, Seed, Stage 1/2/3 and candidate artifact digests.
4. `run-selfhost-required-gate.mjs` binds the release-core and cross-runner evidence to the same compiler generation and exact pull-request commit.

The machine-readable policy is `.github/selfhost-required-gate.json`. It intentionally keeps `nightlyShadowAccepted`, `compilerWideRequired`, and `productionDefaultAllowed` false. Those values must not be enabled from CI success alone. Nightly fixed-point evidence must be inspected separately, the required scope must then be expanded deliberately, and the internal opt-in path must remain rollback-safe before any production-default proposal.

If an upstream evidence job fails, the summary job records a fail-closed result instead of falling back to an older or unrelated proof. Do not bypass this check by changing its name, adding path filters to the workflow, or treating a generic Nightly workflow success as self-host promotion evidence.
