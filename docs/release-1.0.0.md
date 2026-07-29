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
5. Allow the production release path to build, attest, and publish the assets.
6. Run public CLI, generated-project, integrity, provenance, SBOM, and VSIX verification.
7. Record the publication and public-verification evidence before closing Issue #64.

## Public installation

Install the stable CLI from the immutable release asset:

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
virune --version
```

Expected version output:

```text
virune 1.0.0
```

## Execution results

Publication completed successfully on 2026-07-29.

- Reviewed release commit: `dcaf89b2f557fde38cdfd9bceb7d23af3ba8ed51`
- Immutable tag: `v1.0.0`, resolving exactly to the reviewed commit
- Stable GitHub Release: `https://github.com/yaona807/virune/releases/tag/v1.0.0`
- Production publication run: `30417133795`
- The stable release gate, release-evidence upload, build-provenance attestation, CycloneDX SBOM attestation, immutable tag creation, and GitHub Release publication all passed.

Public verification run `30417979118` completed successfully against the published assets.

- The complete required asset set was downloaded from the public GitHub Release.
- `SHA256SUMS`, release manifest schema v2, and CycloneDX 1.6 SBOM integrity passed.
- Public CLI installation returned `virune 1.0.0`.
- A generated project installed only immutable `v1.0.0` release dependencies and passed `check`, `build`, and `start`.
- Provenance and CycloneDX attestations passed for the public assets.
- The public VSIX passed clean installation, activation, Language Server startup, and uninstall verification.
- Verification artifact digest: `sha256:0cc2fb2324ccc7461c1b4d2ed042a6e51b74df4464869ab5ab4b11cfb6a21035`
- Machine-readable evidence: `.github/release-verification/v1.0.0.json`

The temporary one-shot publication and stable-verification workflows are removed after recording this evidence. The standard reusable Release, repair, dry-run, and prerelease public-verification workflows remain unchanged. The immutable RC1 and RC2 releases remain unchanged.
