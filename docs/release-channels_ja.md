# リリースチャンネル

[English](release-channels.md) | [日本語](release-channels_ja.md)

Viruneは、バージョン付きのGitHub Releasesから配布します。成果物はnpm互換tarballとVS Code VSIXですが、Viruneパッケージをnpm Registryへ公開せず、npm Registryのdist-tagも使用しません。

| チャンネル | バージョンとGit tag | GitHub Release成果物 | 互換性 |
|---|---|---|---|
| stable | `X.Y.Z` / `vX.Y.Z` | production向けのCLI、内部パッケージ、manifest、checksum、VSIX | 文書化されたstable APIとバージョン付きABIをSemantic Versioningで管理 |
| next | `X.Y.Z-alpha.N`、`-beta.N`、`-rc.N` / 対応する`v*` tag | stable公開前のfeedback用prerelease成果物 | prerelease間で破壊的変更があり得る |
| nightly | `X.Y.Z-nightly.YYYYMMDD.N` / snapshot公開時の対応する`v*` tag | 自動生成する開発snapshot | 互換性保証なし |

インストールコマンドでは、具体的なGitHub tagとasset名を指定します。

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
```

stable releaseには[`stable-release-gate_ja.md`](stable-release-gate_ja.md)の全条件を要求します。Runtime ABI importは配布チャンネルとは独立して、`@virune/runtime/v2/index.js`のようなバージョン付きpathを使用します。
