# CIゲート戦略

[英語版](ci-gate-strategy.md)

Viruneでは、Pull Requestの検証、再現可能性の検証、Nightly、リリース前検証を分けています。通常の変更を十分に検証しながら、文書だけの変更や長時間の検証を適切な経路へ分けることが目的です。

CIの構成を変更する場合も、`CI`、`Release artifacts`、`Reproducible release required check`、`Reproducible release artifacts`と、後述するprovider必須の終端ゲート名は維持します。これらはGitHubのRulesetから参照される可能性があります。

必須チェックの成功結果は、その実行にGitHubが対応付けたPull Requestの正確な状態に対する証拠としてだけ扱います。Pull Requestのheadが変わった場合や、base branchの移動によりmerge対象の状態が変わった場合、以前の成功結果を新しい状態の証拠として使ってはいけません。

## Pull Requestの検証

### 検証経路の選択

文書だけの変更かどうかはCIの変更分類で判定します。この文書では対象パスを固定の一覧として持ちません。

文書だけの変更だと安全に判定できたPull Requestに限り、文書向けの検証経路を使用します。文書以外の変更が含まれる場合や、安全に判定できない場合は完全な検証を行います。

変更されたrepository pathは文字列をそのまま分類します。先頭・末尾の空白やliteralのバックスラッシュはfilenameの一部であり、別pathの別名として扱いません。未知、空、その他の理由で解決できないchange setを文書だけの変更として扱いません。

`main`へのpushと手動のCI実行でも、完全な検証を行います。

### 文書だけの変更

文書だけの変更では、メタデータとポリシーを検証したうえで、文書内のサンプルコードをビルド・検証・実行します。その他の重い検証は省略できます。

省略する場合も、必須チェックそのものを削除したり、別の名前へ変更したりしてはいけません。任意適用のformal workflowでも、重いjobを明示的に不要と判定した場合は終端ゲート自体を必ず出します。

Performance benchmarkの文書とTypeScript 7 migration ADRはMarkdown文書ですが、従来どおり専用のformal validationを実行します。

### 通常の変更

通常のPull Requestでは、Ubuntu 24.04／Node.js 24でメタデータを検証し、基準となるビルドと型検査を1回行います。生成した`dist`を同じワークフロー実行内の各検証で共有します。

主な検証は次のとおりです。

- 単体・結合テスト
- コンパイラー品質、TypeScriptバインディング、Language Server、VS Code、準拠性、フォーマッターなどの検証
- 多数の入力を自動生成し、クラッシュや処理結果の不一致を探すテスト（ファズテスト）
- Pull Request向けに、異なる処理経路の結果の不一致を探すテストを4分割して実行（各2分）
- Windows Server 2022／2025、macOS 14、Node.js 26での互換性検証
- Chromiumでのブラウザー検証
- 変更範囲に応じたセルフホスティングの全言語機能インベントリ

さらに、文書以外の変更を含むPull Requestでは、Browser conformance、Performance、Fixed Seed bootstrap、TypeScript 7 prototype、VSIX smokeのformal laneをすべて実行します。新しいpathや未知のpathを「安全なので省略可能」と推測しないための保守的な規則です。

WindowsやmacOSなど環境固有の依存関係が必要な検証では、対象環境でコミット済みのロックファイルから`npm ci`を実行します。ビルド済みのVirune成果物は共有しますが、ネイティブ依存関係まで別環境から持ち込みません。

`Release artifacts`は、必要な検証が成功した場合だけ実行します。Pull Request専用の結果差分テストはpushや手動CIでは実行しないため、その意図した省略は許可します。

公開判断にはPull Requestで作成したビルド成果物を流用せず、クリーンな環境からリリース用成果物を再ビルドして検証します。

## Providerで必須にする終端ゲート

`main`をtargetにするPull Requestでは、repository workflowが次の安定した終端check contextを出します。

- `Required CI gate`
- `Required self-host gate`
- `Required browser conformance gate`
- `Required performance gate`
- `Required fixed Seed gate`
- `Required TypeScript 7 gate`
- `Required VSIX gate`

`main`のRulesetでは、上記7個に加えて既存の次のcontextも必須にします。

- `Reproducible release artifacts`
- `CodeQL`
- `Diagnose dependency review API`

終端ゲートが成功できるのは、必要な上流検証が成功した場合、またはreview済みの変更分類で重いlaneが明示的に不要と判定され、その上流jobが実際に`skipped`だった場合だけです。requiredな結果がmissing、failed、cancelled、partial、stale、timed out、unknownの場合はsuccessとして扱いません。

Rulesetではrequired status checkをstrictに扱い、base branchの移動によってmerge対象の状態が変わった場合に古い成功結果を流用できないようにします。provider設定を変更する直前に現在値を取得し、変更後にも再取得して確認します。不一致があれば、事前に保存した値へrollbackします。

これらの終端ゲートはrepository側の証拠へ追加する安全境界です。品質、security、compatibility、reproducibility、browser、performance、self-hostingの元の検証を置き換えません。

## 再現可能性の必須チェック

`Reproducible release required check`は、Pull Requestごとに独立して実行する必須チェックです。通常の変更では次を実行します。

```bash
npm run verify:reproducible-release
```

文書だけの変更では、変更分類を確認したうえで実際の二重ビルドを省略できます。ただし、`Reproducible release required check`／`Reproducible release artifacts`という必須チェックの識別子は維持します。

## Nightly

`Nightly quality suites`は、定期実行、関連する変更が入った`main`へのpush、または手動実行で使用します。Pull Requestでは実行しません。

Nightlyでは次を行います。

- 多数の入力を自動生成してクラッシュを探すテストを15分×4分割で実行
- TypeScriptバインディングの大規模テスト一式
- 異なる処理経路の結果の不一致を探すテストを15分×4分割で実行
- 独立した再現可能リリースビルド

Nightlyの失敗を、原因を確認せず再実行して隠してはいけません。再現に必要な証跡を残し、原因となった問題は解決済みとする前に必要な回帰テストへ反映します。

## リリース前検証

`Release dry run`は、実際の公開を行わずに安定版のリリース経路を確認する手動ワークフローです。品質検証、パッケージ作成、再現可能性、インストール済みVSIX、必要なNightlyの証跡をまとめて確認します。

公開前のほか、リリース方針、パッケージング、署名、修復処理を変更した場合にも実行します。

### 実行手順

1. GitHubのViruneリポジトリで **Actions** を開きます。
2. **Release dry run** を選び、**Run workflow** を開きます。
3. GitHubの画面から実行する場合は、検証するリリース候補のブランチを選びます。
4. **Run workflow** を実行します。
5. `Stable release gate`が成功したことを確認します。
6. 実行結果のArtifactsから`stable-release-dry-run-<commit SHA>`を確認します。ここにはリリース証跡、再現可能性の証跡、候補成果物が含まれます。

GitHubの画面で選べないタグなどのrefを直接指定する場合は、GitHub CLI（`gh`）を使用できます。この方法では、`gh`をインストールしてGitHubへ認証し、対象リポジトリのActionsを実行できる権限が必要です。

```bash
gh workflow run "Release dry run" --ref <ref>
```

失敗した場合は公開へ進まず、失敗した検証と証跡を確認します。

## 成果物とキャッシュ

CIで共有するビルド成果物は、現在のワークフロー実行内だけで使用します。別のPull Requestや過去の実行から取得してはいけません。

共有する成果物にはリポジトリが生成した`dist`だけを含め、`node_modules`、認証情報、キャッシュ、パッケージ管理ツールの状態、リリース候補を含めません。

各環境はコミット済みのロックファイルから`npm ci`を実行します。npmのキャッシュはダウンロードの高速化にだけ使用し、ビルド結果やリリース証跡として扱いません。

リリース用パッケージは、クリーンなチェックアウトと依存関係のインストール後に必ずソースから再ビルドします。

## CI失敗時の確認

CIでラップされた各コマンドは、実行コマンド、所要時間、終了状態、OS、Node.jsのバージョン、ローカルでの再現コマンドをJSONで記録します。失敗時の標準出力・標準エラーは`.cache/ci-failures/`へ保存されます。

失敗を調べるときは次の順序で確認します。

1. Pull Requestの現在のheadと、baseから決まるmerge対象の状態が、失敗したworkflow実行で検証した状態と一致していることを確認します。
2. 失敗したjobとstepを開き、ログとGitHubの注釈に表示された再現コマンドを確認します。
3. 必要に応じてCIの証跡をダウンロードし、`.cache/ci-failures/`と`.cache/ci-timings/`を確認します。
4. repository rootで再現コマンドを実行します。OSやNode.jsのバージョンに依存する失敗は、該当する環境でも確認します。
5. repositoryや実装が原因なら修正し、新しい状態で検証します。GitHub Actionsやrunnerなど外部基盤が原因だと確認できた場合に限り、同じ状態の再実行を使用します。

古いheadや古いmerge対象状態の成功結果、または原因を確認していない再実行結果を現在の変更の証拠として扱ってはいけません。
