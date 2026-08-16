# Release channels

[English](release-channels.md) | [日本語](release-channels_ja.md)

Virune `v1.0.0` is distributed through versioned GitHub Releases and will not be retro-published to the npm Registry. The planned first stable npm Registry release is `v1.1.0`. npm publication remains disabled until the release-specific publication, ownership, Trusted Publishing, clean-install, and public-verification gates are implemented and pass.

GitHub Releases remain an official immutable distribution channel for stable, prerelease, and nightly releases.

**npm Registry policy:** `v1.0.0` is not retro-published; first stable is `v1.1.0`; stable uses `latest`; prerelease uses `next`; nightly is not published to npm.

| Channel | Version and Git tag | GitHub Release assets | npm Registry policy | Compatibility |
|---|---|---|---|---|
| stable | `X.Y.Z` / `vX.Y.Z` | Production-ready CLI, internal packages, manifests, checksums, SBOM, attestations, and VSIX | Beginning with the first approved stable Registry release (`v1.1.0`), publish the official package set under `latest` only after all npm publication gates pass | Semantic Versioning for documented stable APIs and versioned ABIs |
| next | `X.Y.Z-alpha.N`, `-beta.N`, or `-rc.N` / matching `v*` tag | Prerelease assets for feedback before a stable release | Approved prereleases for a Registry-enabled release line use `next`; they must not move `latest` | Breaking changes may occur between prereleases |
| nightly | `X.Y.Z-nightly.YYYYMMDD.N` / matching `v*` tag when snapshots are published | Automated development snapshots | Not published to the npm Registry under the current policy | No compatibility guarantee |

The current `v1.0.0` install command continues to point at its immutable GitHub tag and asset name:

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
```

After the first stable npm Registry release is actually published and its public verification gate passes, the canonical short CLI install path becomes:

```bash
npm install --global virune
```

Do not use that short command as evidence that a release is available before public Registry verification succeeds. The repository publication plan remains fail-closed while `publicationReady` is false.

## Release candidate publication

A release-candidate commit must use one identical prerelease version in the root manifest, every workspace manifest, and every internal Virune dependency. After the preparation pull request is merged, create a branch named `release-candidate/vX.Y.Z-rc.N` from the reviewed commit. The production `Release` workflow verifies that the branch name matches the manifest version, executes the complete stable release gate, creates the matching immutable Git tag, generates provenance and SBOM attestations, and publishes the GitHub Release as a prerelease.

The release-candidate branch route rejects stable versions. Normal stable GitHub publication continues to use an existing `vX.Y.Z` tag. Neither route may overwrite an existing Release. Exceptional byte replacement remains isolated in the audited `release-repair` workflow.

When npm publication is enabled in a later implementation slice, prerelease publication must use `next` and stable publication must use `latest`. npm packages and GitHub Release assets for the same version must be derived from the same reviewed release identity; npm publication from a different source head is not an accepted recovery path.

Promote an RC to stable only after public-URL CLI installation, generated-project `check`/`build`/`run`, clean-profile VSIX validation, checksum verification, SBOM inspection, provenance verification, and rollback review have all passed. Once npm publication is enabled, the corresponding public Registry verification also becomes part of release completion. Promotion uses a new stable-version commit and tag; RC assets are never renamed or mutated.

A stable release requires all gates in [`stable-release-gate.md`](stable-release-gate.md). Runtime ABI imports continue to use versioned paths such as `@virune/runtime/v2/index.js` independently of the distribution channel.
