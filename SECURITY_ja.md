# セキュリティポリシー

English: [SECURITY.md](SECURITY.md)

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

private vulnerability reportingを利用できない場合は、`Security contact request` Issue Formを利用できます。

このIssueは公開されます。脆弱性の詳細、再現手順、秘密情報、連絡先などの機密情報は記載しないでください。

GitHubプロフィールに、メンテナーが非公開で連絡できる公開済みの連絡先がある場合、メンテナーがその方法を使って連絡します。

利用できる連絡先がない場合でも、脆弱性の詳細を公開して連絡を求めないでください。

## 対象範囲

Viruneはセキュリティサンドボックスではありません。

生成されたJavaScriptは実行環境の権限で動作します。また、`unsafe`を使用した連携、第三者パッケージ、外部APIなどはVirune自身の安全性保証の対象外です。

一方、Viruneのコンパイラー、CLI、Visual Studio Code拡張、language server、Interopなどに起因する脆弱性は報告対象です。

## 対応

報告された問題は、必要に応じて非公開で調査・修正します。

公開可能な段階で、修正版やrepository security advisoryなどを通じて案内します。
