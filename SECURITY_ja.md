# セキュリティポリシー

[英語版](SECURITY.md)

## サポート対象

`main`と最新の安定版をサポート対象とします。

過去のリリースは、別途案内がある場合を除きサポート対象外です。

## 脆弱性の報告

セキュリティ上の問題を見つけた場合は、公開Issue、GitHub Discussions、Pull Requestなどへ詳細を投稿しないでください。

GitHubの[private vulnerability reporting](https://github.com/yaona807/virune/security/advisories/new)から報告してください。

可能であれば、次の情報を含めてください。

- 影響を受けるバージョンやコンポーネント
- 問題を再現する方法
- 想定される影響
- 回避方法が分かっている場合はその内容

private vulnerability reportingを利用できない場合でも、脆弱性の詳細を公開Issueへ投稿しないでください。

## 対象範囲

Viruneはセキュリティサンドボックスではありません。

生成されたJavaScriptは実行環境の権限で動作します。`unsafe`を使用した連携、第三者パッケージ、外部APIなどはVirune自身の安全性保証の対象外です。

Viruneのコンパイラ、CLI、Visual Studio Code拡張、Language Server、Interopなどに起因する脆弱性は報告対象です。

## 対応

報告された問題は、必要に応じて非公開で調査・修正します。

公開可能になった段階で、修正版などを通じて案内します。
