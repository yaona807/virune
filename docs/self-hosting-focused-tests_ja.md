# セルフホストFocused Test

`selfhost:focused`は、コンパイル済みのセルフホストCompiler Testを1件だけ、Repository既存のUnit Test Runner経由で実行する。生成Compilerの回帰Testを1件実行するためだけに作られていたTemporary workflowやDiagnostic-only Pull Requestを置き換える恒久Commandである。

## コマンド

```bash
npm run selfhost:focused -- --case=expected-list-literals
npm run selfhost:focused:built -- --case=generic-json-type-arguments
npm run selfhost:focused:built -- --list
```

`selfhost:focused`はRepositoryを先にBuildする。`selfhost:focused:built`は既存Buildを再利用する。`--list`は選択可能なCase IDを決定的な順序で表示する。

## 選択境界

Case IDは`packages/compiler/dist/test/selfhost-<case>.test.js`という名前のコンパイル済みFileだけへ対応する。IDには小文字、数字、単一Hyphenだけを使用できる。Path、Glob、正規表現、Node.js Option、Test name patternは受け付けない。

Full-language InventoryはFocused Caseに含めない。次の専用Commandを使用する。

```bash
npm run selfhost:inventory
```

未知または曖昧なCaseはChild Processを起動する前に失敗し、利用可能なCase IDを表示する。

## 実行モデル

Focused Commandは、Repository相対のコンパイル済みTest Pathを1件だけ指定して`scripts/run-unit-tests.mjs`へ実行を委譲する。Node.js TestのIsolation、Timeout、失敗出力、Exit statusは既存Runnerを正本とする。Focused Commandは第2のTest Runnerを実装せず、Shellも起動しない。

専用のGitHub Actions Jobは追加しない。このCommandは通常のPull Request Gateを実行する前の、LocalおよびAgentによるFocused Validationに使用する。
