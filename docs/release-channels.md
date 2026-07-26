# Release channels

[English](release-channels.md) | [日本語](release-channels_ja.md)

Virune is distributed through versioned GitHub Releases. The release assets are npm-compatible tarballs and a VS Code VSIX, but Virune packages are not published to the npm Registry and do not use npm Registry dist-tags.

| Channel | Version and Git tag | GitHub Release assets | Compatibility |
|---|---|---|---|
| stable | `X.Y.Z` / `vX.Y.Z` | Production-ready CLI, internal packages, manifests, checksums, SBOM, attestations, and VSIX | Semantic Versioning for documented stable APIs and versioned ABIs |
| next | `X.Y.Z-alpha.N`, `-beta.N`, or `-rc.N` / matching `v*` tag | Prerelease assets for feedback before a stable release | Breaking changes may occur between prereleases |
| nightly | `X.Y.Z-nightly.YYYYMMDD.N` / matching `v*` tag when snapshots are published | Automated development snapshots | No compatibility guarantee |

Install commands always point at a concrete GitHub tag and asset name, for example:

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
```

## Release candidate publication

A release-candidate commit must use one identical prerelease version in the root manifest, every workspace manifest, and every internal Virune dependency. After the preparation pull request is merged, create a branch named `release-candidate/vX.Y.Z-rc.N` from the reviewed commit. The production `Release` workflow verifies that the branch name matches the manifest version, executes the complete stable release gate, creates the matching immutable Git tag, generates provenance and SBOM attestations, and publishes the GitHub Release as a prerelease.

The release-candidate branch route rejects stable versions. Normal stable publication continues to use an existing `vX.Y.Z` tag. Neither route may overwrite an existing Release. Exceptional byte replacement remains isolated in the audited `release-repair` workflow.

Promote an RC to stable only after public-URL CLI installation, generated-project `check`/`build`/`run`, clean-profile VSIX validation, checksum verification, SBOM inspection, provenance verification, and rollback review have all passed. Promotion uses a new stable-version commit and tag; RC assets are never renamed or mutated.

A stable release requires all gates in [`stable-release-gate.md`](stable-release-gate.md). Runtime ABI imports continue to use versioned paths such as `@virune/runtime/v2/index.js` independently of the distribution channel.
