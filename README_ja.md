<p align="center">
  <img src="assets/virune-logo.svg" alt="Virune" width="520">
</p>

<h1 align="center">Virune</h1>

<p align="center">
  JavaScriptエコシステムを対象とした静的型付きプログラミング言語です。
</p>

<p align="center">
  <a href="https://github.com/yaona807/virune/actions/workflows/ci.yml"><img src="https://github.com/yaona807/virune/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/yaona807/virune/releases"><img src="https://img.shields.io/github/v/release/yaona807/virune?display_name=tag&sort=semver" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/yaona807/virune" alt="License"></a>
</p>

<p align="center">
  <a href="spec/README_ja.md">言語仕様</a> ·
  <a href="CONTRIBUTING_ja.md">開発に参加する</a> ·
  <a href="COMPATIBILITY_ja.md">互換性方針</a> ·
  <a href="SECURITY_ja.md">セキュリティ</a> ·
  <a href="README.md">English</a>
</p>

## このリポジトリについて

このリポジトリは、Viruneそのものを開発・保守するための正本です。コンパイラー、Runtime、標準ライブラリ、CLI、エディタ連携、セルフホスティング実装、テスト、CI、規範仕様を管理します。

言語としての厳密な動作は[`spec/`](spec/README_ja.md)を参照してください。Viruneの開発へ参加する場合は[`CONTRIBUTING_ja.md`](CONTRIBUTING_ja.md)から始めてください。

## ソースから動かす

必要なNode.jsのバージョンは`package.json`の`engines`を正本とします。現在の環境で次を実行します。

```bash
# リポジトリを取得済みの場合
npm run bootstrap
npm run build
npm run virune -- --version
```

初めて変更する場合の手順、テストの選び方、Pull Requestの条件は[`CONTRIBUTING_ja.md`](CONTRIBUTING_ja.md)にまとめています。

## 主なディレクトリ

| パス | 役割 |
|---|---|
| `packages/compiler` | Lexer、Parser、型検査、プロジェクト処理、コード生成、Compiler API |
| `packages/runtime` | 生成コードが利用するRuntime |
| `packages/stdlib` | 標準ライブラリ |
| `packages/js-interop` | JavaScript／TypeScript連携 |
| `packages/cli` | `virune` CLI |
| `packages/language-server` | Language Server |
| `packages/vscode` | VS Code拡張 |
| `spec` | 規範的な言語仕様とRuntime ABI |
| `conformance` | 仕様への適合を確認するテストデータ |
| `integration` | 複数コンポーネントをまたぐ統合テスト |
| `selfhost` | Viruneで実装したセルフホスト用コンパイラー |
| `scripts` | ビルド、検証、Release、CIで使うリポジトリ管理スクリプト |

## Release

公開済みの成果物は[GitHub Releases](https://github.com/yaona807/virune/releases)で確認できます。Releaseの可否はリポジトリ内の機械可読ポリシーとCIで判定し、READMEには個別バージョンの手順を重複して持ちません。

## ライセンス

Viruneは[Apache License 2.0](LICENSE)で公開しています。第三者ソフトウェアについては[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)を参照してください。
