# 再現可能なリリース

[英語版](reproducible-builds.md)

Viruneの安定版は、同じソースツリーとロックファイルからバイト単位で同一の成果物を再生成できなければなりません。

## ローカルで検証する

### 事前条件

次が利用できる環境で実行します。

- Node.js 24以上
- npm
- `tar`
- `unzip`

リリース候補を確認する場合は、対象のコミットをチェックアウトし、意図しないローカル変更がないことも確認してください。

### 検証を実行する

リポジトリのルートで次を実行します。

```bash
npm run verify:reproducible-release
```

このコマンドはリポジトリの外に独立した一時作業領域を2つ作成します。それぞれへクリーンなソースをコピーし、`npm ci --no-audit --no-fund`と`npm run verify:release`を実行したあと、2つの`release/`を比較します。

成功すると、再現可能であることと証跡ファイルの場所が表示されます。

失敗した場合は、まず次を確認します。

1. `.cache/reproducible-release/summary.md`で差分の概要を確認します。
2. `.cache/reproducible-release/report.json`で機械可読な差分を確認します。
3. `build-a.log`と`build-b.log`で2回のビルドのどこが異なったか確認します。
4. 成果物自体が異なる場合は、`artifacts/build-a/`と`artifacts/build-b/`を比較します。

原因を確認せず、成功するまで単に再実行してはいけません。

### 一時作業領域を残す

通常、一時作業領域は検証後に削除されます。失敗した環境を直接確認するときだけ残します。

Bashなどでは次のように実行します。

```bash
VIRUNE_KEEP_REPRO_WORKSPACES=1 npm run verify:reproducible-release
```

PowerShellでは次のように実行します。

```powershell
$env:VIRUNE_KEEP_REPRO_WORKSPACES='1'
npm run verify:reproducible-release
```

調査後は不要になった一時作業領域を削除してください。

### `SOURCE_DATE_EPOCH`を指定する

既定値は`0`です。過去のリリース条件など、別の値を明示して再現する必要がある場合だけ上書きします。

Bashなど:

```bash
SOURCE_DATE_EPOCH=0 npm run verify:reproducible-release
```

PowerShell:

```powershell
$env:SOURCE_DATE_EPOCH='0'
npm run verify:reproducible-release
```

## 比較する内容

比較対象は、同じコミットとロックファイルから別々の一時作業領域で作った2つの`release/`です。

この比較は、ビルド時刻、一時作業領域のパス、ファイルの並び順など、ソースやロックファイル以外の偶然の状態が成果物へ混入していないかを検出するために行います。同じ入力から独立に作った2つの`release/`が一致すれば、その検証条件の範囲で、ビルド結果が一時的な環境状態に依存していないことを確認できます。これにより、公開済み成果物を後から同じソースから再生成し、同一性を検証できる状態を保ちます。

一部の成果物だけが一致しても、別の公開ファイルがビルドのたびに変わるならリリース全体は再現可能とはいえません。そのため、特定のパッケージだけではなく`release/`全体を比較します。

対応するファイルについて次を比較します。

- ファイルの存在、種類、大きさ、SHA-256、POSIX権限
- シンボリックリンクの参照先
- npm tarballとVSIXのバイト列
- npm tarballとVSIXを展開した完全なファイルツリー
- 一時作業領域のパスがリリース成果物や展開後の内容へ混入していないこと

アーカイブのバイト列だけが異なり、展開後の内容が一致する場合は、時刻、格納順、圧縮情報、権限などの差として報告します。

## 公開成果物の完全性を確認する

安定版には次の検証情報を含めます。

- `SHA256SUMS`: `SHA256SUMS`自身を除く公開ファイルのSHA-256
- `RELEASE-MANIFEST.json`: スキーマバージョン2のリリースマニフェスト
- `SBOM.cdx.json`: コミット済みnpmロックファイルから決定的に生成するCycloneDX 1.6 SBOM
- `MANIFEST.json`と`VSCODE-MANIFEST.json`: パッケージとVSIX固有の完全性情報

### 一式をダウンロードした場合

`sha256sum`が利用できる環境では、`SHA256SUMS`と検証対象のファイルを同じディレクトリへ置き、次を実行します。

```bash
sha256sum --check SHA256SUMS
```

すべて成功することを確認します。1件でも不一致があれば、その成果物を使用しないでください。

`sha256sum`を利用できない環境では、次の方法で`RELEASE-MANIFEST.json`に記録された大きさとSHA-256を各ファイルについて確認します。

### 一部の成果物だけをダウンロードした場合

`RELEASE-MANIFEST.json`を開き、対象ファイルについて次を確認します。

1. ファイル名が一致している。
2. 記録されたバイト数とローカルファイルの大きさが一致している。
3. 記録されたSHA-256とローカルファイルのSHA-256が一致している。

たとえば`virune-1.0.0.tgz`を確認する場合、バイト数はLinux／macOSでは次で確認できます。

```bash
wc -c < virune-1.0.0.tgz
```

PowerShellでは次を使います。

```powershell
(Get-Item .\virune-1.0.0.tgz).Length
```

SHA-256は利用環境に応じて次のように確認できます。

Linuxなど`sha256sum`がある環境:

```bash
sha256sum virune-1.0.0.tgz
```

macOSなど`shasum`がある環境:

```bash
shasum -a 256 virune-1.0.0.tgz
```

PowerShell:

```powershell
(Get-FileHash .\virune-1.0.0.tgz -Algorithm SHA256).Hash
```

いずれかを確認できない場合は、その成果物を使用しないでください。

## GitHub Artifact Attestationを確認する

安定版の`Release`ワークフローは、`SHA256SUMS`を含む公開ファイルに対して次の証明を作成します。

- 成果物をリポジトリ、コミット、ワークフロー、ランナー情報へ結び付けるSLSAビルド来歴（build provenance）
- 成果物を`SBOM.cdx.json`へ結び付けるCycloneDX SBOM attestation

この確認にはGitHub CLI（`gh`）を使用します。

1. 検証する成果物があるディレクトリへ移動します。
2. ビルド来歴を確認します。

```bash
gh attestation verify virune-1.0.0.tgz --repo yaona807/virune
```

3. 出力が`yaona807/virune`と期待する`Release`ワークフローに結び付いていることを確認します。
4. SBOMとの関連付けも確認する場合は、証明の種類をCycloneDX SBOMに限定します。

```bash
gh attestation verify virune-1.0.0.tgz \
  --repo yaona807/virune \
  --predicate-type https://cyclonedx.org/bom
```

`https://cyclonedx.org/bom`は、証明の種類がCycloneDXのBOMであることを示す公式の識別子です。このコマンドがそのURLからファイルをダウンロードしたり、URL先の仕様本文をViruneへ取り込んだりするわけではありません。

チェックサム、リポジトリ識別情報、対象ダイジェスト、attestationの署名のいずれかを検証できない成果物はインストールしないでください。

## 再現可能性の証跡

ローカル検証の証跡は`.cache/reproducible-release/`へ保存します。

- `report.json`: ビルド情報、アーカイブの結果、型付きの差分
- `summary.md`: 人が読むための結果
- `build-a.log`、`build-b.log`: 2回の独立したビルドのログ
- `artifacts/build-a/`、`artifacts/build-b/`: 成果物が一致しない場合だけ保存する比較対象

Nightlyはこのディレクトリを`reproducible-release-evidence`として保存します。`Release dry run`も同じ検証を実行し、証跡と候補成果物を保存します。

## 公開済みの安定版を変更しない

通常のタグ起動`Release`ワークフローは、同じGitHub Releaseが既に存在する場合は停止し、公開済みの成果物を上書きしません。

成果物の追加や削除が必要な場合は、既存の安定版を変更せず、新しいバージョンを公開します。

`Release asset repair`は、公開済みファイルの内容が破損・改ざんなどで正しくない一方、元のタグとソースは正しい場合に、同じファイル名の正しい内容へ戻すための非常用手順です。新しい機能や成果物を追加するためには使用しません。

### 利用する例

たとえば、`v1.0.0`のタグとソースが正しく、再現可能性検証でも同じ成果物を再生成できることを確認済みなのに、GitHub Release上の`virune-1.0.0.tgz`のSHA-256が、その再生成結果と一致しない場合です。この場合は、`Release asset repair`で同じタグから正しい成果物を作り直し、同じファイル名で復旧します。

公開後の改ざんや公開処理上の事故により、公開済みファイルだけが正しい再生成結果と異なると確認された場合も対象です。

一方、ソースコードの不具合を修正したい、新しい成果物を追加したい、パッケージ内容や仕様を変更したい場合には使用しません。その場合は新しいバージョンを公開します。

### `Release asset repair`の事前条件

実行前に次を確認します。

- 修復対象が既存の安定版タグである。
- 元のタグとソースが正しく、修復対象が公開済み成果物の内容だけである。
- 成果物の追加・削除ではなく、既存の成果物名を維持した修復である。
- 修復理由を20文字以上で具体的に説明できる。
- GitHubの`release-repair`環境（environment）にrequired reviewersなどのdeployment protectionが設定されている。
- `main`からワークフローを実行できる。

### `Release asset repair`の実行手順

1. GitHubのViruneリポジトリで **Actions** を開きます。
2. **Release asset repair** を選び、**Run workflow** を開きます。
3. 実行元のブランチとして`main`を選びます。
4. `tag`に修復する既存タグ（例: `v1.0.0`）を入力します。
5. `reason`にインシデントまたは完全性上の理由を20文字以上で入力します。
6. `confirm`に`REPLACE_STABLE_ASSETS`と完全一致する文字列を入力します。
7. **Run workflow** を実行し、`release-repair`環境の承認が必要な場合は承認手順を完了します。
8. `Audit and replace stable assets`ジョブが成功したことを確認します。
9. Artifactsから`release-repair-<tag>-<run id>`を取得し、置換前後のSHA-256一覧と再現可能性の証跡を確認します。この証跡は365日保持されます。
10. 修復後のGitHub Releaseから成果物を取得し、前述のチェックサムとGitHub Artifact Attestationをもう一度確認します。

ワークフローは、タグと`package.json`のバージョン、タグのコミット、既存Releaseの存在、成果物名の集合を検証します。再ビルド、監査証跡の保存、新しいビルド来歴とSBOM attestationの作成が完了した後にだけ、最後のステップで成果物を置換します。

途中の検証が失敗した場合は、原因を解決せずに置換へ進めてはいけません。成果物名の追加・削除が必要なら修復ではなく新しいリリースを作成します。

## 安定版のリリース条件

次をすべて満たさない限り、安定版を公開してはいけません。

- 2つの独立したビルドが成功する。
- その2回のビルドで作った2つの`release/`が、上記の比較項目で一致する。
- SBOMとリリースマニフェストの検証が成功する。
- 必要な最新の品質検証が成功する。

暗黙の例外は認めません。意図的に再現できない値を許可する場合は、対象を限定したポリシー変更、理由の文書化、専用の回帰テストが必要です。
