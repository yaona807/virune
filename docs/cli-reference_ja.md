# Virune CLIリファレンス

[English](cli-reference.md) | [日本語](cli-reference_ja.md)

リポジトリ内のCLIは`npm run build`後に使用できます。

```bash
npm run virune -- <command>
```

公開npm packageをinstallした後の同等commandは`virune <command>`です。

## 共通動作

- 成功時の終了codeは`0`です。
- 入力、compile、entry point、test、formatの失敗は終了code`1`です。
- Command usageの誤りは終了code`2`です。
- 診断はsource locationを含む安定したcompiler形式で出力します。
- `virune.json`で有効にした場合、生成programはSource Mapを使用します。

## `virune init`

```text
virune init [path]
```

`virune.json`と`src/main.virune`を含む新規projectを作成します。

```bash
npm run virune -- init playground/hello
```

## `virune check`

```text
virune check [path] [--diagnostic-format=json]
```

JavaScriptを出力せず、parse、bind、型検査を実行します。

```bash
npm run virune -- check playground/hello
npm run virune -- check playground/hello --diagnostic-format=json
```

JSON modeはeditorやautomationとの連携を想定します。

## `virune build`

```text
virune build [path]
```

Projectを検査し、設定された`outDir`へES2022 ESMを出力します。

```bash
npm run virune -- build playground/hello
```

## `virune run`

```text
virune run [path] [-- program arguments...]
```

Projectをbuildし、実行可能な`main` contractを検証して生成entry moduleを実行します。

```bash
npm run virune -- run playground/hello
npm run virune -- run playground/hello -- Alice Bob
```

任意の`--` separatorは、`main(args: List<String>)`へ引数を渡す前に除去します。

許可されるentry signatureは[`../spec/entry-point_ja.md`](../spec/entry-point_ja.md)を参照してください。

## `virune test`

```text
virune test [path]
```

Projectをbuildし、生成したVirune test宣言をNode.js test runnerで実行します。

```bash
npm run virune -- test playground/hello
```

Testがないprojectは成功し、Virune testが見つからないことを表示します。

## `virune fmt`

```text
virune fmt [--check] [path...]
```

`.virune`ファイルを再帰的にformatします。

```bash
npm run virune -- fmt playground/hello
npm run virune -- fmt --check playground/hello
```

`--check`はファイルを書き換えず、canonical formatと異なる場合に失敗します。

## `virune clean`

```text
virune clean [path]
```

設定済みoutput directoryを削除します。

```bash
npm run virune -- clean playground/hello
```

## `virune bind`

```text
virune bind <package-or-d.ts> [--out path] [--module specifier]
```

TypeScript declaration fileまたはinstall済みpackageから、保守的なVirune FFI declarationを生成します。

```bash
npm run virune -- bind example-package \
  --out src/ffi/example.virune

npm run virune -- bind ./types/example.d.ts \
  --module example-package \
  --out src/ffi/example.virune
```

未対応または安全に変換できないTypeScript型は、診断付きで`Unknown`になります。生成bindingはreview可能なsourceであり、自動的に信頼してはいけません。

## `virune interop`

```text
virune interop check [path]
virune interop build [path]
virune interop init <module> [--out path]
```

`*.interop.ts` AdapterのInterop ABIを検査し、build時は型検査済みESMとABI metadataを生成します。`init`は複雑なTypeScript API用Adapterの雛形を作成します。

## `virune api`

```text
virune api [path] [--out path] [--check]
```

Projectのpublic Virune APIを決定的なsnapshotとして出力するか、既存snapshotと現在のAPIを比較します。

```bash
npm run virune -- api . --out api/virune.api
npm run virune -- api . --out api/virune.api --check
```

## `virune explain`

```text
virune explain <diagnostic-code>
```

安定した診断codeの説明を表示します。

```bash
npm run virune -- explain L4010
```

## `virune version`

```text
virune version
virune --version
virune -v
```

CLI versionを表示します。

## リポジトリ保守command

以下はVirune source repository固有のcommandです。

| Command | 用途 |
|---|---|
| `npm run bootstrap` | 公開npm registryからlockfileに従って依存をinstall |
| `npm run build` | 全TypeScript workspaceをbuild |
| `npm run example` | Root exampleをbuildして実行 |
| `npm test` | 単体・統合testを実行 |
| `npm run test:conformance` | 厳密な言語適合fixtureを実行 |
| `npm run fmt:check` | 同梱exampleをVirune formatterで検査 |
| `npm run spec:check` | 規範rule mappingとgrammar整合性を検査 |
| `npm run verify` | リポジトリ全体のrelease gateを実行 |
| `npm run pack:virune` | ローカルnpm package tarballを生成 |
