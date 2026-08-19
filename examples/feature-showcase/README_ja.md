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
- generated safe binding、compiled TypeScript adapter、隔離されたaudited unsafe FFI source fixtureという3段階のJavaScript interop

Browser projectでは公開browser targetを使用し、repository-wide source checkとの互換性を維持した`@jsExport` JavaScript境界を提供します。feature-showcase quality gateはこのprojectをbuildし、checked artifactをChromiumで実行します。同じgateを関連PR、Nightly schedule、再利用可能なstable-release preflightで使用します。

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
│       │   └── unsafe-hostname.virune.example
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

repository toolchainをbuildした後は、repository-owned gate runnerでplatform-independentなshowcase検証一式を1 processから実行できます。

```bash
node scripts/verify-feature-showcase.mjs
```

このrunnerはNode/browserのformat/check/build、Node test/API/run、safe-binding drift、TypeScript adapter、project-scoped unsafe FFI fixtureを検証します。実Chromium実行はbrowser install/executionをplatform-independent処理と重複させないため、別workflow jobとして実行します。

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

`src/ffi/unsafe-hostname.virune.example`は**unsafe FFI source fixture**です。Viruneのunsafe境界として正しい構文を保持し、rawな`unsafe extern`を`unsafe module`内に閉じ、呼び出し側には監査済みnative-shaped facadeだけを見せます。`.example` suffixは意図的です。repository-wide root checkは検出したすべての`.virune`をrepository source root基準で判定するため、nested projectの`src/ffi/`はroot-level unsafe path規則を同時には満たせません。このfixtureを非discoverableにすることで安全規則を緩和せず維持します。showcase gateはNode projectをtemporary project rootへcopyし、このfixtureを`src/ffi/unsafe-hostname.virune`としてstageして、通常の公開`virune check`経路で検証します。

## Public API snapshot

`node/virune.api.json`は`virune api`で生成し、repositoryへcommitしています。compile対象の公開Virune declarationだけを決定的なmodule/declaration順で記録し、source APIとsnapshotがずれると`--check`が失敗します。

## Scope boundary

Showcase全体は公開済みVirune 1.0 surfaceだけを使用します。quality gateはvalidation automationだけを追加し、Compiler/Runtime semantics、JavaScript Interop ABI、Language Specification、public stdlib behaviorは変更しません。

Virune 1.0ではnominal constructionは宣言module内に閉じ、exported signatureからimport済みnominal typeを再公開しません。Showcase都合でこの境界を緩めず、公開契約として見える形を維持します。

`.github/workflows/feature-showcase.yml`をNode/browser/binding/API/unsafe-FFI driftのcanonical continuous gateとします。再利用可能な`workflow_call` entry pointもstable-release preflight境界として使い、release時にも別実装ではなく同じshowcase contractを検証します。
