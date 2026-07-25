# CI gate strategy

[日本語](ci-gate-strategy_ja.md)

## Goals

Virune's pull-request CI separates platform-independent validation from platform-sensitive smoke tests. The design preserves the supported operating-system and Node.js matrix while avoiding repeated metadata validation, TypeScript builds, unit suites, fuzzing, conformance, and formatter checks on every runner.

## Pull-request responsibilities

### Change classification

The `classify` job computes the changed path set from the pull-request base and head commits.

A change is documentation-only only when every changed path is one of:

- root project Markdown files such as `README.md`, `CONTRIBUTING.md`, and `SECURITY.md`;
- Markdown files below `docs/`.

An empty change set, workflow change, package metadata change, dependency change, source change, generated baseline change, or non-Markdown documentation asset always selects the full gate.

Push and manual runs always select the full gate.

### Metadata and policy

The Ubuntu 24.04 / Node.js 24 `metadata` job is the only PR job that runs `npm run verify:metadata`. It validates runtime requirements, registry configuration, workflow policy, CI policy, TypeScript API boundaries, documentation, release metadata, public API and ABI snapshots, release gates, and language grammar.

Documentation-only pull requests additionally build and execute the documentation examples. Other jobs are skipped for this path.

### Canonical build

For a full gate, the Ubuntu 24.04 / Node.js 24 `build` job starts in parallel with metadata validation. It performs the repository's only PR project-reference build and type check, then packages the generated `dist` trees into a short-lived artifact.

The core-test, compatibility, and browser jobs start as soon as this artifact is available. They do not wait for each other, so artifact reuse removes duplicate builds without serializing the supported platform matrix behind the full core suite.

### Platform-independent core

The Ubuntu 24.04 / Node.js 24 `verify` job restores the canonical build and owns:

- unit and integration tests excluding the browser runtime;
- TypeScript binding corpus;
- fuzz and semantic differential fuzz smoke suites;
- language-server and VS Code tests;
- conformance and formatter checks;
- source-clone smoke tests.

### Platform-sensitive compatibility

Windows Server 2022, Windows Server 2025, macOS 14, and Ubuntu Node.js 26 download the compiled-output artifact produced by the canonical build job. They still run `npm ci` locally so native and platform-specific dependencies are installed for the target runner.

Compatibility jobs execute only tests whose behavior may depend on the operating system, filesystem, path handling, process creation, Node.js version, VS Code host, or CLI execution:

- platform smoke tests;
- language-server and VS Code tests;
- conformance path smoke;
- clone and process smoke.

They do not repeat metadata validation, type checking, the complete unit suite, binding corpus, fuzzing, or formatter validation.

### Browser and release

The browser job restores the canonical build and executes emitted ESM in Chromium in parallel with core and compatibility testing.

The release-artifacts job runs only after metadata, build, core, compatibility, and browser jobs succeed. It performs a clean production release build and release smoke verification rather than trusting a PR build artifact for publishing decisions.

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
npm run test:platform-smoke:built
npm run test:vscode:built
npm run test:conformance:built
npm run smoke:clone:built
```

## Nightly responsibility

Pull-request CI uses bounded fuzz smoke suites and the complete supported platform matrix. Nightly workflows remain responsible for long-duration fuzzing, mutation campaigns, repeated performance sampling, ecosystem drift checks, and other expensive checks that are not required for immediate pull-request feedback.

A Nightly failure must not be hidden by unconditional retries. Reproduction evidence should be retained and promoted to a regression test before the underlying issue is considered resolved.
