# Virune v1.0.0-rc.1 release rehearsal

[English](release-rehearsal-1.0.0-rc.1.md) | [日本語](release-rehearsal-1.0.0-rc.1_ja.md)

This document is the execution record for Issue #35. The release candidate is published from the reviewed `release-candidate/v1.0.0-rc.1` branch through the production `Release` workflow.

## Candidate identity

- Version: `1.0.0-rc.1`
- Git tag: `v1.0.0-rc.1`
- Release type: GitHub prerelease
- CLI asset: `virune-1.0.0-rc.1.tgz`
- VSIX asset: `virune-vscode-1.0.0-rc.1.vsix`

## Public installation

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0-rc.1/virune-1.0.0-rc.1.tgz
virune --version
```

Expected version output:

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

The generated `package.json` must reference only assets under the `v1.0.0-rc.1` GitHub Release.

## Integrity and provenance

From a directory containing the downloaded release assets:

```bash
sha256sum --check SHA256SUMS
gh attestation verify virune-1.0.0-rc.1.tgz --repo yaona807/virune
gh attestation verify SBOM.cdx.json --repo yaona807/virune
```

Confirm that `RELEASE-MANIFEST.json` uses schema version 2, lists every asset, and records the same SHA-256 and byte length as the downloaded files. Confirm that `SBOM.cdx.json` is CycloneDX 1.6 and identifies version `1.0.0-rc.1`.

## VS Code validation

Use a clean VS Code profile and install `virune-vscode-1.0.0-rc.1.vsix`. Confirm extension activation, Language Server startup, diagnostics, completion, hover, navigation, formatting, rename, and code actions.

## Failure and rollback rehearsal

- A second normal publication attempt for `v1.0.0-rc.1` must fail because release assets are immutable.
- Partial or incorrect publication must not be repaired by rerunning the normal workflow.
- Byte-for-byte repair uses only the manually confirmed `release-repair` workflow, with identical asset names and retained before/after digest evidence.
- A semantic or asset-set correction uses a new version such as `v1.0.0-rc.2`.

## Stable promotion decision

Promotion to `v1.0.0` requires all checks above to pass, no unresolved P0 release defect, a successful recent Nightly run, and a recorded review of rollback and repair evidence. RC assets remain immutable and are not renamed into the stable release.

## Execution results

The publication workflow run, release URL, downloaded-asset verification, clean-install result, VSIX result, and promotion decision are recorded here after the candidate is published.
