# Virune v1.0.0-rc.2 release rehearsal

[English](release-rehearsal-1.0.0-rc.2.md) | [日本語](release-rehearsal-1.0.0-rc.2_ja.md)

This document is the execution record for Issue #61. The release candidate was prepared from the reviewed `main` commit and published through the production `Release` workflow from `release-candidate/v1.0.0-rc.2`.

## Candidate identity

- Version: `1.0.0-rc.2`
- Git tag: `v1.0.0-rc.2`
- Tag commit: `3a6698ed9003f1d9e3324736cb2c100b6aa0609a`
- Release type: GitHub prerelease
- Release URL: `https://github.com/yaona807/virune/releases/tag/v1.0.0-rc.2`
- Published at: `2026-07-28T14:56:36Z`
- CLI asset: `virune-1.0.0-rc.2.tgz`
- VSIX asset: `virune-vscode-1.0.0-rc.2.vsix`

## Changes validated since rc.1

- stable diagnostic codes and schema-versioned JSON diagnostics
- Compiler API and LSP diagnostic alignment
- Chevrotain 13 and normalized diagnostic span invariants
- complete locked-dependency audit and GitHub Dependency Review
- security workflow and least-privilege hardening

## Public installation

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0-rc.2/virune-1.0.0-rc.2.tgz
virune --version
```

Verified version output:

```text
virune 1.0.0-rc.2
```

The generated project referenced only `v1.0.0-rc.2` assets. Dependency installation, `check`, `build`, and `start` all passed.

## Integrity, provenance, and VS Code validation

The public verification downloaded all 15 published assets and confirmed their byte lengths and SHA-256 digests against `RELEASE-MANIFEST.json` schema version 2. The CycloneDX 1.6 SBOM contained 382 components. Provenance and CycloneDX attestations passed.

The published `virune-vscode-1.0.0-rc.2.vsix` passed clean-profile installation, activation, Language Server startup, and uninstall.

The machine-readable public verification record is retained at `.github/release-verification/v1.0.0-rc.2.json` on `release-verification/v1.0.0-rc.2`.

## Execution results

| Check | Result | Evidence |
| --- | --- | --- |
| Preparation pull request | Passed and squash-merged | PR #62 / commit `3a6698ed9003f1d9e3324736cb2c100b6aa0609a` |
| CI | Passed | run `338` |
| Nightly quality suites | Passed | run `60` |
| Release dry run | Passed | run `182` |
| CodeQL | Passed | run `159` |
| Dependency Review and ruleset compatibility context | Passed | run `142` |
| Browser conformance | Passed | run `148` |
| VSIX smoke | Passed | run `144` |
| Performance | Passed | run `197` |
| TypeScript 7 prototype | Passed | run `79` |
| Production prerelease publication | Passed | release `v1.0.0-rc.2` |
| Public CLI and generated-project verification | Passed | `.github/release-verification/v1.0.0-rc.2.json` |
| Public VSIX verification | Passed | `.github/release-verification/v1.0.0-rc.2.json` |
| Provenance and CycloneDX attestations | Passed | `.github/release-verification/v1.0.0-rc.2.json` |

## Stable promotion decision

The technical release-candidate cycle is complete. Stable `v1.0.0` remains a separate reviewed decision and requires no unresolved P0 or P1 release defect at promotion time. RC2 assets remain immutable and are not renamed or modified for the stable release.
