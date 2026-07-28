# Virune v1.0.0-rc.2 release rehearsal

[English](release-rehearsal-1.0.0-rc.2.md) | [日本語](release-rehearsal-1.0.0-rc.2_ja.md)

This document tracks Issue #61. The release candidate is prepared from the reviewed `main` commit and published through the production `Release` workflow from `release-candidate/v1.0.0-rc.2`.

## Candidate identity

- Version: `1.0.0-rc.2`
- Git tag: `v1.0.0-rc.2`
- Release type: GitHub prerelease
- CLI asset: `virune-1.0.0-rc.2.tgz`
- VSIX asset: `virune-vscode-1.0.0-rc.2.vsix`

## Changes validated since rc.1

- stable diagnostic codes and schema-versioned JSON diagnostics
- Compiler API and LSP diagnostic alignment
- Chevrotain 13 and normalized diagnostic span invariants
- complete locked-dependency audit and GitHub Dependency Review
- security workflow and least-privilege hardening

## Required validation

The preparation pull request must pass all required checks, the current Nightly suites, release dry run, reproducible build, package and VSIX smoke tests, CodeQL, and Dependency Review.

After publication, install the CLI from the immutable release asset:

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0-rc.2/virune-1.0.0-rc.2.tgz
virune --version
```

The public verification must confirm:

- `virune --version` reports `1.0.0-rc.2`
- `virune init` generates dependencies that reference only `v1.0.0-rc.2` assets
- generated-project dependency installation, `check`, `build`, and `start`
- clean-profile VSIX installation and Language Server activation
- `SHA256SUMS`, `RELEASE-MANIFEST.json`, CycloneDX SBOM, and provenance attestations
- published assets remain immutable

## Stable promotion decision

Stable `v1.0.0` remains a separate reviewed decision. Promotion requires successful public verification of this candidate and no unresolved P0 or P1 release defect.

## Execution results

Publication and public-verification evidence will be recorded after the production workflow completes.
