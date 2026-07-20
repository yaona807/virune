# Release channel

[English](release-channels.md) | [日本語](release-channels_ja.md)

Viruneは3つのnpm distribution channelを使用します。

| Channel | npm tag | 用途 | 互換性 |
|---|---|---|---|
| stable | `latest` | production利用可能な言語・Runtime ABI release | 文書化したstable APIをSemantic Versioningで管理 |
| next | `next` | alpha、beta、release candidateのfeedback収集 | prerelease間で破壊的変更があり得る |
| nightly | `nightly` | 自動生成する開発snapshot | 互換性保証なし |

stable releaseには`docs/stable-release-gate_ja.md`の全条件を要求します。Runtime ABI importはnpm channelとは独立して、`@virune/runtime/v2/index.js`のようなversion付きpathを使用します。
