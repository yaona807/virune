# CI gate strategy

[日本語版](ci-gate-strategy_ja.md)

Virune separates pull-request validation, reproducibility verification, Nightly validation, and pre-release verification. The goal is to validate normal changes thoroughly while routing documentation-only changes and long-running checks through the appropriate paths.

When CI responsibilities move, the names `CI`, `Release artifacts`, `Reproducible release required check`, and `Reproducible release artifacts` must remain stable. Repository rulesets may depend on these identifiers.

A successful CI result is evidence for the pull-request head commit that was actually tested. If the head changes, an older successful run must not be used as evidence for the new head.

## Pull-request validation

### Selecting the validation path

CI classifies whether a pull request contains documentation-only changes. This document does not maintain a fixed list of qualifying paths.

The documentation path is used only when the change can be classified safely as documentation-only. If any non-documentation change is present, or the classification cannot be made safely, the full validation path is used.

Pushes to `main` and manually dispatched CI runs also use the full validation path.

### Documentation-only changes

Documentation-only changes validate metadata and policy, then build, validate, and execute documentation examples. The remaining expensive jobs may be skipped.

Skipping those jobs must not remove required checks or change the identifiers used by repository rulesets.

### Normal changes

For a normal pull request, metadata is validated on Ubuntu 24.04 / Node.js 24, and the canonical build and type check are performed once. The generated `dist` output is shared by validation jobs within the same workflow run.

The main validation areas include:

- unit and integration tests;
- compiler quality, TypeScript bindings, the Language Server, VS Code, conformance, and formatter checks;
- fuzz testing that generates many inputs automatically to find crashes or inconsistent results;
- four pull-request shards that look for semantic differences between execution paths, two minutes per shard;
- compatibility checks on Windows Server 2022 / 2025, macOS 14, and Node.js 26;
- browser validation in Chromium;
- the self-hosting full-language inventory when required by the changed paths.

Checks that require operating-system-specific or native dependencies still run `npm ci` from the committed lockfile on the target environment. Built Virune output is shared, but native dependencies are not copied across platforms.

`Release artifacts` runs only after the required validation has succeeded. The pull-request-only semantic-difference test is intentionally absent on push and manual CI runs, and that intentional skip is accepted.

Publishing decisions do not trust a pull-request build artifact. Release artifacts are rebuilt and verified from a clean environment.

## Required reproducibility check

`Reproducible release required check` is an independent required pull-request check. For normal changes it runs:

```bash
npm run verify:reproducible-release
```

For documentation-only changes, the workflow may short-circuit after validating the change classification instead of performing the double build. The required identifiers `Reproducible release required check` and `Reproducible release artifacts` must still remain unchanged.

## Nightly

`Nightly quality suites` runs on its schedule, for relevant pushes to `main`, or when dispatched manually. It does not run for pull requests.

Nightly performs:

- four 15-minute shards that generate inputs to look for crashes;
- the full TypeScript binding test corpus;
- four 15-minute shards that look for inconsistent results between execution paths;
- an independent reproducible release build.

A Nightly failure must not be hidden by retrying without first understanding the cause. Retain reproduction evidence, and add the necessary regression coverage before considering the underlying problem resolved.

## Pre-release verification

`Release dry run` is a manually dispatched workflow that verifies the stable release path without publishing. It covers quality validation, release packaging, reproducibility, the installed VSIX, and the required Nightly evidence.

Run it before publishing, and after changing release policy, packaging, signing, or repair behavior.

### Procedure

1. Open **Actions** in the Virune GitHub repository.
2. Select **Release dry run**, then open **Run workflow**.
3. When using the GitHub UI, select the branch containing the release candidate.
4. Start **Run workflow**.
5. Confirm that `Stable release gate` succeeds.
6. Under the run's Artifacts, inspect `stable-release-dry-run-<commit SHA>`. It contains release evidence, reproducibility evidence, and candidate artifacts.

To run against a tag or another ref that is not selectable in the UI, use GitHub CLI (`gh`). This requires `gh` to be installed and authenticated to GitHub, with permission to run Actions for the repository.

```bash
gh workflow run "Release dry run" --ref <ref>
```

If the run fails, do not proceed to publishing. Inspect the failed validation and its evidence first.

## Artifact and cache safety

Shared CI build artifacts are scoped to the current workflow run. They must not be taken from a different pull request or an earlier run.

The shared build artifact contains only repository-produced `dist` output. It must not include `node_modules`, credentials, caches, package-manager state, or release candidates.

Each environment runs `npm ci` from the committed lockfile. The npm cache is only an installation download cache and is never treated as build output or release evidence.

Release packaging always rebuilds from source after a clean checkout and dependency installation.

## Investigating CI failures

Wrapped CI commands record the command, duration, exit status, operating system, Node.js version, and local reproduction command as JSON. On failure, stdout and stderr are retained under `.cache/ci-failures/`.

Use this sequence when investigating a failure:

1. Confirm that the pull request's current head commit matches the commit tested by the failed workflow run.
2. Open the failed job and step, then inspect the log and the reproduction command shown in the GitHub annotation.
3. Download CI evidence when needed and inspect `.cache/ci-failures/` and `.cache/ci-timings/`.
4. Run the reproduction command from the repository root. For failures that depend on the operating system or Node.js version, also reproduce them in the relevant environment.
5. If the repository or implementation is responsible, fix it and validate the new head. Re-run the same head only when the failure is confirmed to come from external infrastructure such as GitHub Actions or a runner.

Do not treat a successful run for an older head, or an unexplained retry, as evidence for the current change.
