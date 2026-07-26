# Virune v1.0.0-rc.1 release rehearsal

[English](release-rehearsal-1.0.0-rc.1.md) | [日本語](release-rehearsal-1.0.0-rc.1_ja.md)

This document is the execution record for Issue #35. The release candidate was published from the reviewed `release-candidate/v1.0.0-rc.1` branch through the production `Release` workflow.

## Candidate identity

- Version: `1.0.0-rc.1`
- Git tag: `v1.0.0-rc.1`
- Tag commit: `1d346528485155c545a6cf2e4a24252e791674d5`
- Release type: GitHub prerelease
- Release URL: `https://github.com/yaona807/virune/releases/tag/v1.0.0-rc.1`
- CLI asset: `virune-1.0.0-rc.1.tgz`
- VSIX asset: `virune-vscode-1.0.0-rc.1.vsix`

## Public installation

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0-rc.1/virune-1.0.0-rc.1.tgz
virune --version
```

Verified version output:

```text
virune 1.0.0-rc.1
```

## Generated project validation

```bash
virune init virune-rc-smoke
cd virune-rc-smoke
npm install
npm run check
npm run build
npm run start
```

The generated `package.json` referenced only assets under the `v1.0.0-rc.1` GitHub Release. Dependency installation, `check`, `build`, and `start` all passed.

## Integrity and provenance

The public verification workflow downloaded every published asset and validated:

- `SHA256SUMS` against the downloaded bytes
- `RELEASE-MANIFEST.json` schema version 2, version identity, file set, byte lengths, and SHA-256 values
- CycloneDX 1.6 SBOM identity and manifest digest
- GitHub build provenance attestations for every release asset
- the CycloneDX attestation for `SBOM.cdx.json`

The recorded SBOM contains 382 components. The machine-readable evidence is retained at `.github/release-verification/v1.0.0-rc.1.json` on the dedicated verification branch.

## VS Code validation

The published `virune-vscode-1.0.0-rc.1.vsix` was installed into a clean VS Code profile under Xvfb. Extension installation, activation, Language Server startup, and uninstall all passed.

## Failure and rollback rehearsal

A second normal publication attempt was executed through the production `Release` workflow after all release gates, packaging, provenance, and SBOM attestation steps passed. The final publication step rejected the existing release with:

```text
Release v1.0.0-rc.1 already exists; release assets are immutable.
```

This confirms that normal reruns cannot replace published assets. Byte-for-byte repair remains restricted to the manually confirmed `release-repair` workflow. Semantic or asset-set changes require a new version such as `v1.0.0-rc.2`.

## Execution results

| Check | Result | Evidence |
| --- | --- | --- |
| Production RC publication | Passed | Release workflow run `30198292259` |
| Public asset and CLI verification | Passed | Public release verification run `30202064774` |
| Public VSIX clean-profile verification | Passed | Public release verification run `30202064774` |
| Provenance and CycloneDX attestations | Passed | Public release verification run `30202064774` |
| Machine-readable verification record | Passed | `.github/release-verification/v1.0.0-rc.1.json` |
| Immutable normal rerun | Passed by expected rejection | Release workflow run `30202190907` |

## Stable promotion decision

The technical release-candidate rehearsal is complete: publication, public installation, generated-project execution, asset integrity, SBOM, attestations, VSIX activation, and immutable-rerun behavior all passed. No stable `v1.0.0` release was created as part of this issue. Stable promotion remains a separate decision and must use a newly reviewed stable-version commit and tag.
