# Virune v1.0.0 stable release

[English](release-1.0.0.md) | [日本語](release-1.0.0_ja.md)

This document tracks Issue #64 and the promotion of the publicly verified `v1.0.0-rc.2` candidate to the first stable Virune release.

## Release identity

- Version: `1.0.0`
- Git tag: `v1.0.0`
- Release type: stable GitHub Release
- CLI asset: `virune-1.0.0.tgz`
- VSIX asset: `virune-vscode-1.0.0.vsix`
- Promotion source: publicly verified `v1.0.0-rc.2`

## Promotion basis

The `v1.0.0-rc.2` publication and public verification completed successfully. Its immutable release assets passed CLI installation, generated-project dependency installation, `check`, `build`, and `start`, clean-profile VSIX installation and Language Server activation, SHA-256 manifest verification, CycloneDX SBOM verification, and provenance attestation verification.

Stable promotion additionally requires that no unresolved P0 or P1 release defect exists at promotion time.

## Required validation

The stable preparation pull request must pass all required checks, including:

- canonical build, tests, formatter, conformance, and compatibility checks
- exact-commit Nightly quality evidence
- stable release dry run
- release package and VSIX smoke tests
- independent reproducible release builds
- CodeQL and dependency review or the blocking complete locked-dependency audit
- browser conformance and performance regression checks

The stable release gate accepts Nightly evidence only when the successful run is within the configured age limit and its `head_sha` exactly matches the release commit.

## Publication procedure

1. Merge the reviewed preparation pull request into `main`.
2. Run Nightly quality suites for the exact merged `main` commit.
3. Confirm the stable Release dry run succeeds for that exact commit.
4. Create the immutable `v1.0.0` tag on the reviewed commit.
5. Allow the production `Release` workflow to build, attest, and publish the assets.
6. Run public CLI, generated-project, integrity, provenance, SBOM, and VSIX verification.
7. Record the publication and public-verification evidence before closing Issue #64.

## Public installation

After publication, install the stable CLI from the immutable release asset:

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
virune --version
```

Expected version output:

```text
virune 1.0.0
```

## Execution results

Publication and public-verification evidence will be recorded after the production workflow and public verification complete. The immutable RC1 and RC2 releases remain unchanged.
