# セルフホストShadow履歴

[English](self-hosting-shadow-history.md)

Bootstrap shadow履歴bridgeは、candidateに結び付いたStage 1／Stage 2 shadow reportを、決定論的な昇格evidenceへ変換します。純粋なHost componentであり、GitHub dataの収集、compiler stageの実行、workflow変更、compiler昇格は行いません。

## 入力contract

Version 1は、1つのcandidate SHAと厳密に整列されたshadow run一覧を受け取ります。各runは次を保持します。

- 一意なrun ID
- 全runで同一の40文字または64文字candidate SHA
- canonical ISO完了timestamp
- canonicalなversion 1 shadow report
- reportのSHA-256

Bridgeはreportのproperty順序とSHA-256を検証し、Stage 1 → Stage 2の厳密なsubject pairを要求します。Shadow reportのstatusとsection summaryも検証し、未知property、重複run ID、stale candidate、非canonicalな順序を拒否します。

## 履歴の意味

結果には次を記録します。

- 最新runまで連続して成功したrun数
- その末尾連続成功区間に含まれるUTC日付の異なる日数
- candidate履歴全体の未説明differential総数
- 末尾連続成功区間の最初のtimestamp
- 最新reportの識別子
- 各runのcompactなcanonical record

同じUTC日付に複数runがある場合、成功run数は増えますが観測日数は水増しされません。Mismatchは末尾連続成功区間を終了させます。またcandidate履歴内にmismatchが1件でもあれば、未説明差分を0件に保つ必要があるため、生成evidenceはfailedのままです。

## 昇格evidence

Bridgeは既存のfail-closed評価器と互換な`PromotionEvidenceObservation`を生成します。追加するevidence itemは1件だけです。

- ID: `stage1-stage2`
- status: 最新reportが成功し、candidate履歴に未説明差分がない場合だけ`passed`
- candidate: 入力された厳密なcandidate SHA
- source: 最新shadow reportのSHA-256
- completedAt: 最新runのcanonical timestamp

Manual approval、rollback evidence、stable release cycleはfalse／0のままです。これらの事実は、別のreview済みprocessが供給しなければなりません。

## 境界

この機能は次を行いません。

- Stage 1／Stage 2の実行
- GitHub Actions evidenceの取得、永続化、attestation
- Nightly、required check、branch protectionの変更
- 昇格承認またはproduction compiler切り替え
- grammar、stable Compiler API、Runtime ABI、Interop ABI、公開standard libraryの変更
