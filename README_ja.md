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

言語としての厳密な動作は[`spec/`](spec/README_ja.md)を参照してください。Viruneの開発へ参加する場合は[`CONTRIBUTING_ja.md`](CONTRIBUTING_ja.md)から始めてください。リポジトリ構成、変更の進め方、テストの選び方もそちらにまとめています。

## クイックスタート

`virune init`で作成したプロジェクトには、利用するViruneのバージョンに対応したREADMEとセットアップ手順が含まれます。リポジトリを取得済みの場合は、ルート`package.json`の`engines`が要求するNode.jsを使用し、次を実行します。

```bash
npm run bootstrap
npm run build
npm run virune -- --version
```

## 運営

Viruneは現在、[`@yaona807`](https://github.com/yaona807)がメンテナンスしています。現在、運営委員会や投票制度は設けていません。変更や提案は原則としてIssueやPull Requestを通じて公開して進め、プロジェクトの最終判断はメンテナーが行います。セキュリティ問題は[`SECURITY_ja.md`](SECURITY_ja.md)に従って報告してください。

## リリース

公開済みの成果物は[GitHub Releases](https://github.com/yaona807/virune/releases)で確認できます。GitHub Releasesはstable、prerelease、nightlyのすべてで公式かつ変更しない配布経路として維持します。リリースの可否はリポジトリ内の機械可読ポリシーとCIで判定し、READMEには個別バージョンの手順を重複して持ちません。

## ライセンス

Viruneは[Apache License 2.0](LICENSE)で公開しています。第三者ソフトウェアについては[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)を参照してください。
