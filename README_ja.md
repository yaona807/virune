<p align="center">
  <img src="assets/virune-logo.svg" alt="Virune" width="520">
</p>

<h1 align="center">Virune</h1>

<p align="center">
  JavaScriptのエコシステムを活かしながら、<br>
  より単純で予測しやすいコードを書くための静的型付きプログラミング言語です。
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

## なぜViruneを作っているのか

JavaScriptとTypeScriptの大きな魅力の一つは、これまで積み上げられてきたエコシステムをそのまま利用できることです。Viruneも、この資産を捨てて別の世界を作ることは目指していません。

一方で、JavaScriptには`null`と`undefined`、動的な外部の値、例外、Promiseなど、実装するときに考えることが多くあります。

TypeScriptは、JavaScriptとの互換性を保ちながら、こうした値を型で安全に扱えるようにしてくれます。ただし、JavaScriptの実行モデルそのものがなくなるわけではありません。

Viruneでは、**JavaScriptとの接続に必要な複雑さは境界で正しく扱い、通常のコードには必要以上に広げない**ことを重視しています。

さらに、値の型だけではなく、失敗、副作用、非同期処理の扱いなども、できるだけコードから分かるようにします。

JavaScriptの資産を活かしながら、普段書くコードはできるだけ単純にする。これがViruneの基本的な考え方です。

## TypeScriptで考えてみる

例えば、ユーザー情報と注文一覧をAPIから取得して、ユーザー名と注文数を表示する処理を考えます。

以下では、`loadUser`と`loadOrders`は既存のAPIクライアント関数で、通信に失敗した場合はPromiseがrejectするものとします。

```typescript
type User = {
  name: string;
  nickname?: string | null;
};

type Order = {
  id: string;
};

async function showDashboard(userId: string): Promise<void> {
  const [user, orders] = await Promise.all([
    loadUser(userId),
    loadOrders(userId),
  ]);

  const displayName = user.nickname ?? user.name;

  console.log(`${displayName}: ${orders.length} orders`);
}
```

これは普通のTypeScriptです。短く書けますし、このままで十分な場面も多くあります。

ただ、上記のコードをもう少し詳しく見ると、いくつかの情報は関数宣言だけでは分かりません。

### 値がない状態

上記の`nickname`は、読み出す側では`string`だけでなく、`null`やプロパティが存在しないことによる`undefined`も考慮します。

TypeScriptはこれらを型として追跡できます。ただ、アプリケーション側で知りたいことが単純に「ニックネームがあるか、ないか」であれば、通常のコードまで`null`と`undefined`の違いを持ち続けなくてもよい場合があります。

### どのように失敗するか

上記の`showDashboard`は、型だけを見ると`(userId: string) => Promise<void>`です。

非同期処理であることは分かりますが、`loadUser`や`loadOrders`がどのように失敗するかは、この型には現れません。TypeScriptでもResult型を導入したり、独自のエラー設計を行ったりできます。

Viruneでは、回復可能な失敗を`Result<T, E>`として通常の言語機能に含めています。

### 何に作用するか

上記の`showDashboard`は、ネットワークを利用し、最後に標準出力へ書き込みます。ただし、そのことは関数の型には現れません。

Viruneでは、こうした副作用を`uses`として関数宣言に含めます。

### 並行処理を誰が管理するか

上記では`Promise.all()`を使って2つの処理を並行して実行しています。

いずれかがrejectすると`Promise.all()`もrejectしますが、開始済みのもう一方の処理を自動的に止めるわけではありません。キャンセルまで行う場合は、`AbortController`などを組み合わせて設計します。

Viruneでは、並行して開始した処理の寿命や失敗時の扱いも、構造化並行処理として言語とランタイム側で決めています。

## 同じ処理をViruneで書く

上記と同じ処理をViruneで表すと、以下のようになります。

ここでは`loadUser`と`loadOrders`が、どちらも`DashboardError`を使う非同期処理として定義されているものとします。

```virune
record User {
    name: String
    nickname: String?
}

record Order {
    id: String
}

enum DashboardError {
    UserLoadFailed
    OrderLoadFailed
}

async fn showDashboard(
    userId: String
) -> Result<Unit, DashboardError> uses Network, Task, Console {
    let values = await (parallel try {
        user: loadUser(userId)
        orders: loadOrders(userId)
    })?

    let displayName = match values.user.nickname {
        Some(nickname) => nickname
        None => values.user.name
    }

    Console.print("{displayName}: {List.length(values.orders)} orders")
    return Ok(Unit)
}
```

上記のTypeScriptと同じような処理ですが、Viruneでは処理について知っておきたい情報が宣言にも残ります。

### 値の不在は`Option`で扱う

以下の`nickname: String?`は`Option<String>`の短い表記です。

通常のVirune値は`null`や`undefined`になりません。値がある場合は`Some`、ない場合は`None`として扱います。

### 失敗は`Result`に現れる

以下の戻り値を見ると、この処理が`DashboardError`として失敗する可能性があることが分かります。

```virune
-> Result<Unit, DashboardError>
```

`?`を使うと、その失敗を呼び出し元へ伝播できます。

### 副作用は`uses`に現れる

以下を見ると、この関数がネットワーク、非同期タスク、標準出力を利用することが分かります。

```virune
uses Network, Task, Console
```

実装を最後まで読まなくても、どの種類の副作用を持つか確認できます。

### 並行処理の寿命も決まっている

以下では、2つの処理を並行して開始します。

```virune
parallel try {
    user: loadUser(userId)
    orders: loadOrders(userId)
}
```

片方が`Err`になった場合は兄弟の処理へキャンセルを通知し、開始したすべての子処理が終了してから親の処理を続けます。通常のViruneコードでは、親から切り離されたタスクは作りません。

TypeScriptではできない、という話ではありません。TypeScriptではライブラリやプロジェクト設計に任せられていることの一部を、Viruneでは言語の共通ルールとして扱っています。

## JavaScriptとの境界

Viruneは、JavaScriptのエコシステムから切り離された言語ではありません。

型情報から安全に扱えるJavaScript APIは、`import js`を使って読み込めます。

```virune
import js { nanoid } from "nanoid"
```

一方で、JavaScriptから来た値を何でもViruneの値として信用するわけではありません。

TypeScriptの`any`を安全な型として扱ったり、`unknown`を都合のよい型へ変換したりはしません。安全に型を確定できない値は`Unknown`として残し、必要に応じて明示的に変換します。

複雑なTypeScript APIはAdapterを使って、JavaScript側の複雑さとVirune側のコードを分けます。`null`や`undefined`も、境界で必要な違いを扱ったうえで、通常のVirune値としてそのまま持ち込みません。

外部ライブラリの実装が型宣言どおりに動くことまでViruneが保証するわけではありません。境界で検証できるものと、依存先を信頼する部分は分けて扱います。

**JavaScriptの複雑さを無視するのではなく、境界で扱う場所をはっきりさせる。** Viruneではこの考え方を重視しています。

## 言語を必要以上に大きくしない

Viruneは、機能が増えるほど良い言語になるとは考えていません。

既存の小さな機能を組み合わせることで同じことを十分に表現できるなら、そのためだけの新しい構文や仕組みは増やさない方針です。

例えば、Virune 1.0にはクラスや継承がありません。データは`record`や`enum`、意味を区別したい値は`newtype`として表現します。

```virune
newtype UserId = Int

record User {
    id: UserId
    name: String
}

enum UserState {
    Active
    Suspended
}
```

再利用したい振る舞いは、通常の関数や、関数を持つ`record`を組み合わせて表現できます。

```virune
record Encoder<T> {
    encode: fn(T) -> String
}

fn serialize<T>(value: T, encoder: Encoder<T>) -> String {
    return encoder.encode(value)
}
```

高度なことをできなくするためではありません。

**高度なことができても、言語そのものはできるだけ単純な状態に保つ。** 既存の仕組みの組み合わせで十分なら、新しい概念を増やさないこともViruneの設計方針の一つです。

## クイックスタート

Virune 1.0.0はNode.js 24以降で利用できます。現在の安定版CLIは、GitHub Releasesの公開済みパッケージからインストールできます。

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
virune --version
```

インストールできたら、以下のコマンドで新しいプロジェクトを作成して実行します。

```bash
virune init hello-virune
cd hello-virune
virune run
```

JavaScriptを生成せずに型やプロジェクト構成を確認する場合は、以下を実行します。

```bash
virune check
```

ES2022のJavaScriptとして出力する場合は、以下を実行します。

```bash
virune build
```

`check`、`run`、`build`はパスを省略すると現在のディレクトリを対象にします。

## 主な機能

Virune 1.0では、以下のような機能を利用できます。

- 静的型付けと型推論
- `record`、`enum`、`newtype`
- `Option`と`Result`
- 網羅的なパターンマッチ
- `uses`による副作用の明示
- `async` / `await`
- `parallel` / `parallel try`による構造化並行処理
- `defer`による後始末
- ジェネリック
- JavaScriptとの相互運用
- ES2022 ESMへの出力
- CLI、Language Server、VS Code拡張、フォーマッター

## 現在の状況

Virune 1.0では、言語の基本機能、コンパイラー、ランタイム、標準ライブラリ、CLI、エディタ連携、JavaScript相互運用の基盤を提供しています。

現在は、実際のJavaScript / TypeScriptライブラリをViruneからより自然に利用できる範囲を広げています。

安定した機能と実験中の機能は分けて扱っています。互換性の考え方については[互換性方針](COMPATIBILITY_ja.md)を参照してください。

## ドキュメント

- [言語仕様](spec/README_ja.md)
- [互換性方針](COMPATIBILITY_ja.md)
- [開発に参加する](CONTRIBUTING_ja.md)
- [セキュリティポリシー](SECURITY_ja.md)

## 開発に参加する

IssueやPull Requestは歓迎しています。開発環境の準備、テスト、言語仕様やAPI / ABIを変更するときの注意点については[CONTRIBUTING_ja.md](CONTRIBUTING_ja.md)を参照してください。

## 運営

Viruneは現在、[`@yaona807`](https://github.com/yaona807)がメンテナンスしています。運営委員会や投票制度は設けていません。

変更や提案は原則としてIssueやPull Requestを通じて公開して進め、最終判断はメンテナーが行います。セキュリティ上の問題は[SECURITY_ja.md](SECURITY_ja.md)に従って報告してください。

## リリース

公開済みの安定版、プレリリース、Nightly版は[GitHub Releases](https://github.com/yaona807/virune/releases)で確認できます。

GitHub Releasesは公式な配布先として扱い、公開済みの成果物は後から別の内容へ差し替えません。リリースできるかどうかは、リポジトリ内の機械可読なポリシーとCIで検証します。

## ライセンス

Viruneは[Apache License 2.0](LICENSE)で公開しています。第三者ソフトウェアについては[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を参照してください。
