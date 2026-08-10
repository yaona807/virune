# Virune feature showcase

[English](README.md) | [日本語](README_ja.md)

このディレクトリは、Virune 1.0の公開surfaceを実際のapplicationとして組み合わせる、実行可能なtask-oriented showcaseです。Nodeとbrowserを別projectに分け、platform設定とJavaScript境界を明示しています。

## Showcaseで示すもの

Node projectでは、小さなdirectory applicationを通して次を組み合わせます。

- multi-module named import
- `newtype`、`record`、`enum`、`Option`、`Result`によるdomain modeling
- executable boundaryでの明示的な`Console` effect
- `await`と`parallel try`によるasync処理
- `defer`による決定的cleanup
- `List`、`Map`、`Set` collection
- `test.include`から検出されるVirune-native test
- checked-inされた決定的public API snapshot
- generated safe binding、compiled TypeScript adapter、隔離されたaudited unsafe FFIという3段階のJavaScript interop

Browser projectでは公開browser targetを使用し、repository-wide source checkとの互換性を維持した`@jsExport` JavaScript境界を提供します。生成物をChromiumで継続実行する検証は、専用quality gateであるIssue #81の責務です。

## 構成

```text
feature-showcase/
├── node/
│   ├── virune.json
│   ├── virune.api.json
│   ├── types/
│   │   └── node-os-showcase.d.ts
│   └── src/
│       ├── domain.virune
│       ├── collections.virune
│       ├── workflow.virune
│       ├── main.virune
│       ├── showcase.spec.virune
│       ├── ffi/
│       │   ├── node-os.virune
│       │   └── unsafe-hostname.virune
│       └── interop/
│           └── read-file.interop.ts
└── browser/
    ├── virune.json
    └── src/main.virune
```

## Repositoryから検証する

先にrepositoryのtoolchainをbuildし、公開Virune commandを実行します。

```bash
npm run virune -- fmt --check examples/feature-showcase/node
npm run virune -- check examples/feature-showcase/node
npm run virune -- test examples/feature-showcase/node
npm run virune -- api examples/feature-showcase/node \
  --out examples/feature-showcase/node/virune.api.json --check
npm run virune -- build examples/feature-showcase/node
npm run virune -- run examples/feature-showcase/node -- Alice Bob

npm run virune -- fmt --check examples/feature-showcase/browser
npm run virune -- check examples/feature-showcase/browser
npm run virune -- build examples/feature-showcase/browser
```

checked-in safe bindingはローカルのdeclaration fixtureから公開CLIで再生成できます。

```bash
npm run virune -- bind \
  examples/feature-showcase/node/types/node-os-showcase.d.ts \
  --module node:os \
  --out examples/feature-showcase/node/src/ffi/node-os.virune
```

TypeScript adapterは公開Interop ABI commandで検証します。

```bash
npm run virune -- interop check examples/feature-showcase/node
```

## JavaScript境界モデル

`src/ffi/node-os.virune`は**generated safe binding**の例です。TypeScript declarationを意図的に完全表現可能な最小surfaceへ限定しているため、生成されたVirune facadeは`Result<_, JsError>`を返し、明示的な`JavaScript` effectを持ちます。

`src/interop/read-file.interop.ts`は**TypeScript adapter**の例です。Nodeのcallback形式`readFile`はTypeScript内部に閉じ、adapterがInterop ABIで検証可能なmonomorphicかつcallback-freeの`Promise<string>` surfaceだけを公開します。

`src/ffi/unsafe-hostname.virune`は**unsafe FFI**の例です。rawな`unsafe extern`は`src/ffi/`配下の`unsafe module`内に隔離し、通常のVirune codeからはraw JavaScript symbolではなく、監査済みのnative-shaped facadeだけが見える構成です。安全制約を緩めるのではなく、trust boundaryそのものを明示する例です。

## Public API snapshot

`node/virune.api.json`は`virune api`で生成し、repositoryへcommitしています。公開Virune declarationだけを決定的なmodule/declaration順で記録し、source APIとsnapshotがずれると`--check`が失敗します。

## Scope boundary

Showcase全体は公開済みVirune 1.0 surfaceだけを使用します。Compiler/Runtime semantics、JavaScript Interop ABI、root package script、CI workflowは変更しません。

Virune 1.0ではnominal constructionは宣言module内に閉じ、exported signatureからimport済みnominal typeを再公開しません。Showcase都合でこの境界を緩めず、公開契約として見える形を維持します。

Node/browser/binding/API driftの継続的な強制はIssue #81で扱います。このdirectoryが、そのquality gateで実行するcanonical sourceです。
