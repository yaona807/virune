# Release channels

[English](release-channels.md) | [日本語](release-channels_ja.md)

Virune uses three npm distribution channels.

| Channel | npm tag | Purpose | Compatibility |
|---|---|---|---|
| stable | `latest` | Production-ready language and Runtime ABI releases | Semantic Versioning for documented stable APIs |
| next | `next` | Alpha, beta, and release-candidate feedback | Breaking changes may occur between prereleases |
| nightly | `nightly` | Automated development snapshots | No compatibility guarantee |

A stable release requires all gates in `docs/stable-release-gate.md`. Runtime ABI imports continue to use versioned paths such as `@virune/runtime/v2/index.js` independently of the npm channel.
