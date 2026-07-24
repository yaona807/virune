# Release channels

[English](release-channels.md) | [日本語](release-channels_ja.md)

Virune is distributed through versioned GitHub Releases. The release assets are npm-compatible tarballs and a VS Code VSIX, but Virune packages are not published to the npm Registry and do not use npm Registry dist-tags.

| Channel | Version and Git tag | GitHub Release assets | Compatibility |
|---|---|---|---|
| stable | `X.Y.Z` / `vX.Y.Z` | Production-ready CLI, internal packages, manifests, checksums, and VSIX | Semantic Versioning for documented stable APIs and versioned ABIs |
| next | `X.Y.Z-alpha.N`, `-beta.N`, or `-rc.N` / matching `v*` tag | Prerelease assets for feedback before a stable release | Breaking changes may occur between prereleases |
| nightly | `X.Y.Z-nightly.YYYYMMDD.N` / matching `v*` tag when snapshots are published | Automated development snapshots | No compatibility guarantee |

Install commands always point at a concrete GitHub tag and asset name, for example:

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
```

A stable release requires all gates in [`stable-release-gate.md`](stable-release-gate.md). Runtime ABI imports continue to use versioned paths such as `@virune/runtime/v2/index.js` independently of the distribution channel.
