---
name: sprint-execution
description: 承認済みのスプリント計画に沿って designer・developer・code-reviewer・security-reviewer を起動し、実装とレビューの差し戻しループを回して、全 PBI を承認済みか中断にする。scrum-team のスプリント計画の承認後、またはスプリントファイルの phase が execution のときに使う。
---

# スプリント実行

## 原則
- PO には問い合わせない。PO の判断が要る事項は記録し、スプリントレビューで示す。
- スクラムマスター（メインセッション）は Agent の起動・結果の記録・差し戻しの判断のみを行い、自分で実装しない。
- 各 Agent への依頼には、PBI の全文、`.scrum/config.md`・`.scrum/agreements.md`・UI 仕様の絶対パス、`base_branch` を含める。worktree からも読めるよう、パスは必ず元のリポジトリの絶対パスにする。
- Agent の結果を受け取るたびに、スプリントファイルの表と「記録」を更新する。

## 手順
1. スプリントファイルを読み、状態が `approved` / `blocked` 以外の PBI を処理対象とする。
2. デザイン：`ui: yes` で UI 仕様が無い PBI に `designer` を起動する。出力先は `.scrum/designs/<pbi-id>.md` とする。依存の無いものは並列に起動する。
3. 実装：依存が解消した PBI に `developer` を起動する。
   - Agent tool の `isolation: "worktree"` を指定する。
   - 同時に動かす developer は3つまでとする。
   - 1つの PBI を2つの developer に分ける場合、バックエンド側を先に起動し、報告の API 契約をフロントエンド側の依頼に含める。2つ目は1つ目の作業ディレクトリで同じブランチに続けてコミットさせる（isolation は指定しない）。
   - `status: blocked` の報告は PBI を `blocked` にし、理由を記録して次へ進む。
4. レビュー：developer の報告ごとに `code-reviewer` と `security-reviewer` を並列に起動する。依頼には developer の報告と作業ディレクトリを含める。
5. 判定：
   - 両者が `approve`：PBI を `approved` にする。
   - どちらかが `request-changes`：両者の `must` をまとめて同じ developer に差し戻し、差し戻し回数を1増やす。差し戻しは SendMessage で元の developer に送る。送れない場合は、新しい developer を isolation なしで起動し、既存の作業ディレクトリで作業させる。
   - 差し戻しが3回に達しても承認されない：PBI を `blocked` にし、未解消の指摘を記録する。
6. 全 PBI が `approved` か `blocked` になったら、スプリントファイルの `phase` を `review` にする。

## 記録に残す事項
- 各 Agent の報告の `assumptions` と `unresolved`
- 差し戻しの理由（レトロで使う）
- `blocked` の理由
