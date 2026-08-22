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
  <a href="CONTRIBUTING_ja.md">コントリビューションガイド</a> ·
  <a href="COMPATIBILITY_ja.md">互換性方針</a> ·
  <a href="SECURITY_ja.md">セキュリティポリシー</a> ·
  <a href="README.md">English</a>
</p>

## なぜViruneを作っているのか

JavaScriptとTypeScriptの大きな魅力の一つは、これまで積み上げられてきたエコシステムをそのまま利用できることです。Viruneも、この資産を捨てて別の世界を作ることは目指していません。

一方で、JavaScriptには`null`と`undefined`、動的な外部の値、例外、Promiseなど、実装するときに考えることが多くあります。TypeScriptは、JavaScriptとの互換性を保ちながら、多くの値やAPIを静的な型で扱えるようにしてくれます。ただし、JavaScriptの実行モデルそのものがなくなるわけではありません。

Viruneでは、**JavaScriptとの接続に必要な複雑さは境界で正しく扱い、通常のコードには必要以上に広げない**ことを重視しています。さらに、失敗、副作用、非同期処理の扱いなども、できるだけコードから分かるようにします。

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

declare function loadUser(userId: string): Promise<User>;
declare function loadOrders(userId: string): Promise<Order[]>;

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

ただ、上記のコードでは次のような部分を別途考える必要があります。

- `nickname`を読み出す側では、`string`だけでなく`null`やプロパティが存在しないことによる`undefined`も扱います。
- `showDashboard`の型からは、`loadUser`や`loadOrders`がどのように失敗するかは分かりません。TypeScriptでもResult型などを導入して表現できます。
- ネットワークやログ出力を使うことは、関数の型には現れません。
- `Promise.all()`は、いずれかがrejectすると全体もrejectしますが、開始済みの他の処理を自動的に止めるわけではありません。キャンセルまで行う場合は`AbortController`などを組み合わせて設計します。

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
    let values = (await parallel try {
        user: loadUser(userId),
        orders: loadOrders(userId),
    })?

    let displayName = match values.user.nickname {
        Some(nickname) => nickname
        None => values.user.name
    }

    Console.print("{displayName}: {List.length(values.orders)} orders")
    return Ok(Unit)
}
```

上記のコードでは、値の不在を`Option`、回復可能な失敗を`Result`、利用する副作用を`uses`として表しています。

`parallel try`で開始した処理は親のスコープに属します。片方が`Err`になった場合は兄弟の処理へキャンセルを通知し、開始したすべての子処理が終了してから親の処理を続けます。

TypeScriptではできない、という話ではありません。TypeScriptではライブラリやプロジェクト設計に任せられていることの一部を、Viruneでは言語の共通ルールとして扱っています。

## JavaScriptとの境界

ViruneはJavaScriptのエコシステムから切り離された言語ではありません。対応する型宣言を安全に解釈できる範囲では、JavaScript APIを`import js`で読み込めます。

```virune
import js { nanoid } from "nanoid"
```

ただし、JavaScriptから来た値を何でもViruneの値として信用するわけではありません。

通常の`import js`では、TypeScriptの`any`を安全な型として通さず、`unknown`も都合のよい型へ狭めません。安全に型を確定できない値は`Unknown`として残し、必要に応じて明示的に変換します。`null`や`undefined`を含む値も、境界で必要な違いを扱ったうえで、明示的にVirune側の型へ変換します。

複雑なTypeScript APIはTypeScript側のAdapterへ分離できます。また、外部ライブラリの実装が型宣言どおりに動くことまでViruneが保証するわけではありません。

**JavaScriptの複雑さを無視するのではなく、境界で扱う場所をはっきりさせる。** これもViruneの設計方針です。

## 言語をできるだけシンプルに保つ

Viruneは、機能が多いほど良い言語になるとは考えていません。

既存の小さな機能を組み合わせることで同じことを明確に表現できるなら、そのためだけの新しい構文や仕組みは増やさない方針です。

例えば、Virune 1.0にはクラスや継承がありません。データは`record`や`enum`、意味を区別したい値は`newtype`として表現し、再利用したい振る舞いは関数や関数を持つ`record`を組み合わせます。

複雑なことができない言語にしたいわけではありません。**高度な処理が必要でも、言語そのものはできるだけシンプルな状態に保つ。** 既存の仕組みの組み合わせで十分なら、新しい概念を増やさないことを重視しています。

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
npm install
virune run
```

型やプロジェクト構成だけを確認する場合は`virune check`、ES2022のJavaScriptとして出力する場合は`virune build`を実行します。`check`、`run`、`build`はパスを省略すると現在のディレクトリを対象にします。

## ドキュメント

- [言語仕様](spec/README_ja.md)
- [互換性方針](COMPATIBILITY_ja.md)
- [コントリビューションガイド](CONTRIBUTING_ja.md)
- [セキュリティポリシー](SECURITY_ja.md)

## 開発に参加する

IssueやPull Requestは歓迎しています。開発環境の準備、テスト、言語仕様やAPI / ABIを変更するときの注意点については[コントリビューションガイド](CONTRIBUTING_ja.md)を参照してください。

## 運営

Viruneは現在、[`@yaona807`](https://github.com/yaona807)がメンテナンスしています。運営委員会や投票制度は設けていません。

変更や提案は原則としてIssueやPull Requestを通じて公開して進め、最終判断はメンテナーが行います。セキュリティ上の問題は[セキュリティポリシー](SECURITY_ja.md)に従って報告してください。

## リリース

公開済みの安定版、プレリリース、Nightly版は[GitHub Releases](https://github.com/yaona807/virune/releases)で確認できます。

GitHub Releasesは公式な配布先として扱い、公開済みの成果物は後から別の内容へ差し替えません。リリースできるかどうかは、リポジトリ内の機械可読なポリシーとCIで検証します。

## ライセンス

Viruneは[Apache License 2.0](LICENSE)で公開しています。第三者ソフトウェアについては[第三者ソフトウェアのライセンス情報](THIRD_PARTY_NOTICES.md)を参照してください。
