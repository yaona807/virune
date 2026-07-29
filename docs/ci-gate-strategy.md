# CI gate strategy

[日本語](ci-gate-strategy_ja.md)

## Goals

Virune separates immediate pull-request validation, required reproducibility verification, long-running Nightly suites, and explicit release rehearsal. The design preserves the supported operating-system and Node.js matrix while avoiding repeated metadata validation, TypeScript builds, semantic fuzzing, and reproducible release builds for the same pull-request commit.

Workflow and required-check names are kept stable when responsibilities move. In particular, `CI`, `Release artifacts`, `Reproducible release required check`, and `Reproducible release artifacts` remain unchanged so repository rulesets do not lose their existing check contexts.

## Pull-request responsibilities

### Change classification

The `classify` job computes the changed path set from the pull-request base and head commits.

A change is documentation-only only when every changed path is one of:

- root project Markdown files such as `README.md`, `CONTRIBUTING.md`, and `SECURITY.md`;
- Markdown files below `docs/`.

An empty change set, workflow change, package metadata change, dependency change, source change, generated baseline change, or non-Markdown documentation asset always selects the full gate.

Push and manual CI runs always select the full gate.

### Metadata and policy

The Ubuntu 24.04 / Node.js 24 `metadata` job is the only PR job that runs `npm run verify:metadata`. It validates runtime requirements, registry configuration, workflow policy, CI policy, TypeScript API boundaries, documentation, release metadata, public API and ABI snapshots, release gates, and language grammar.

Documentation-only pull requests additionally build and execute the documentation examples. Other jobs are skipped for this path.

### Canonical build

For a full gate, the Ubuntu 24.04 / Node.js 24 `build` job starts in parallel with metadata validation. It performs the repository's only PR project-reference build and type check, then packages the generated `dist` trees into a short-lived artifact.

The core-test, compiler-quality, semantic-fuzz, compatibility, and browser jobs start as soon as this artifact is available. They do not wait for each other, so artifact reuse removes duplicate builds without serializing the supported platform matrix or the longest platform-independent suites.

### Platform-independent gates

The canonical build is consumed by Ubuntu 24.04 / Node.js 24 jobs that run concurrently:

- `verify` owns the complete unit and integration suite excluding the browser runtime;
- `quality` owns the TypeScript binding corpus, bounded fuzz and semantic differential fuzz smoke suites, language-server and VS Code tests, conformance, formatter checks, and source-clone smoke tests;
- `semantic-fuzz` runs four bounded semantic differential fuzz shards for pull requests, with two minutes assigned to each shard.

The pull-request semantic-fuzz job executes `scripts/semantic-fuzz-long.mjs` against the canonical compiled-output artifact. It does not rebuild the repository independently. Regression artifacts and CI timing evidence are uploaded per shard.

### Platform-sensitive compatibility

Windows Server 2022, Windows Server 2025, macOS 14, and Ubuntu Node.js 26 download the compiled-output artifact produced by the canonical build job. They still run `npm ci` locally so native and platform-specific dependencies are installed for the target runner.

Compatibility jobs execute only tests whose behavior may depend on the operating system, filesystem, path handling, process creation, Node.js version, VS Code host, or CLI execution:

- platform smoke tests;
- language-server and VS Code tests;
- conformance path smoke;
- clone and process smoke.

They do not repeat metadata validation, type checking, the complete unit suite, binding corpus, fuzzing, or formatter validation.

### Browser and release artifacts

The browser job restores the canonical build and executes emitted ESM in Chromium in parallel with core, quality, semantic-fuzz, and compatibility testing.

The `Release artifacts` job runs only after metadata, build, core tests, compiler quality, pull-request semantic fuzz, compatibility, and browser jobs succeed. On push or manual CI runs, the PR-only semantic-fuzz job is skipped and the release-artifacts dependency accepts that intentional skip. Release packaging performs a clean production build and smoke verification rather than trusting a PR build artifact for publishing decisions.

## Required reproducible-release check

`Reproducible release required check` remains an independent pull-request workflow because its workflow and job names may be referenced by the repository ruleset. For non-documentation changes it executes `npm run verify:reproducible-release`; documentation-only changes retain the same required check context but short-circuit after classification.

The required check is the only automatic pull-request workflow that performs the expensive independent double build. Release dry runs no longer start automatically for the same pull-request commit, so reproducibility is not calculated twice.

## Release dry run

`Release dry run` is an explicit `workflow_dispatch` rehearsal. It executes the complete stable release gate without publishing, including quality verification, release packaging, reproducibility verification, installed VSIX smoke testing, and matching Nightly evidence.

Making the rehearsal explicit prevents ordinary pull requests from launching a second production release path while retaining the full pre-release verification capability. Run it against the intended release ref before publishing or after changing release policy, packaging, signing, or repair behavior.

## Nightly responsibility

`Nightly quality suites` runs only for its schedule, a relevant push to `main`, or manual dispatch. It no longer starts for pull requests.

Nightly owns:

- four 15-minute crash-fuzz shards;
- the full binding corpus;
- four 15-minute semantic differential fuzz shards;
- an independent reproducible release build.

Pull requests receive the shorter four-shard semantic fuzz gate in `CI`. This keeps immediate feedback explicit while reserving the longer campaigns for main-branch and scheduled validation.

A Nightly failure must not be hidden by unconditional retries. Reproduction evidence should be retained and promoted to a regression test before the underlying issue is considered resolved.

## Artifact and cache safety

The compiled-output artifact is scoped to the current workflow run and named with the commit SHA. Downstream jobs use `actions/download-artifact` without a cross-run identifier, so they cannot consume artifacts from a different pull request or earlier run.

The artifact contains only repository-produced `dist` directories. It does not include `node_modules`, credentials, caches, package-manager state, or release candidates.

Each runner performs `npm ci` from the checked-in lockfile. The npm cache is an installation download cache only and is never treated as build output or release evidence.

Release packaging always rebuilds from source after a clean checkout and install.

## Observability and reproduction

Every wrapped CI command writes a JSON timing record containing the command, duration, exit status, operating system, Node.js version, and local reproduction command. The job summary lists commands from slowest to fastest.

On failure, streamed stdout and stderr are retained under `.cache/ci-failures/` and uploaded with timing evidence. The local reproduction command is also emitted as a GitHub annotation.

Representative commands:

```bash
npm run verify:metadata
npm run check
npm run test:core:built -- --failure-output-only
npm run test:binding-corpus:built
node scripts/semantic-fuzz-long.mjs
npm run test:platform-smoke:built
npm run test:vscode:built
npm run test:conformance:built
npm run smoke:clone:built
npm run verify:reproducible-release
npm run release:gate
```
