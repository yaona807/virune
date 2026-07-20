# クローンしたViruneを試す

[English](getting-started-from-clone.md) | [日本語](getting-started-from-clone_ja.md)

## 必要環境

- Node.js 24以上
- npm
- Git

## セットアップ

公開されたViruneリポジトリをcloneまたはdownloadし、root directoryで次を実行します。

```bash
npm run bootstrap
npm run build
npm run virune -- --version
```

`npm run bootstrap`は公開npmレジストリを明示して`npm ci`を実行します。通常の`npm ci`を利用する場合は次でも同じです。

```bash
npm ci --registry=https://registry.npmjs.org/ --replace-registry-host=never
```

## 同梱サンプル

```bash
npm run example
npm run virune -- run examples/user-directory -- Alice Bob
```

## 新規プロジェクト

```bash
npm run virune -- init playground/hello
npm run virune -- check playground/hello
npm run virune -- build playground/hello
npm run virune -- run playground/hello
```

引数を渡す場合：

```bash
npm run virune -- run playground/hello -- Alice Bob
```

## 全検証

```bash
npm run verify
```

## npmが別レジストリへ接続する場合

```bash
npm config get registry
npm config get replace-registry-host
env | grep -i '^npm_config_' || true
```

リポジトリでは次を利用するのが確実です。

```bash
npm run bootstrap
```

## 次に読むもの

- [言語ガイド](language-guide_ja.md)
- [標準ライブラリリファレンス](standard-library_ja.md)
- [CLIリファレンス](cli-reference_ja.md)
- 厳密な言語動作を確認する場合は[規範仕様](../spec/README_ja.md)

## Node.jsベースライン

ViruneはNode.js 24以上を必須とします。リポジトリには`.nvmrc`と`.node-version`を含み、完全な品質ゲートの前に`npm run node:check`で実行環境を検証します。
