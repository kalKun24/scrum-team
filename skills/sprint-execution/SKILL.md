---
name: sprint-execution
description: 承認済みのスプリント計画に沿って、.scrum/team.md に編成された各枠の Agent を起動し、実装とレビューの差し戻しループを回して、全 PBI を承認済みか中断にする。scrum-team のスプリント計画の承認後、またはスプリントファイルの phase が execution のときに使う。
---

# スプリント実行

## 原則
- PO には問い合わせない。PO の判断が要る事項は記録し、スプリントレビューで示す。
- スクラムマスター（メインセッション）は Agent の起動・結果の記録・差し戻しの判断のみを行い、自分で実装しない。
- 各 Agent への依頼には、PBI の全文、`.scrum/config.md`・`.scrum/agreements.md`・`.scrum/inception-deck.md`・UI 仕様の絶対パス、`base_branch` を含める。worktree からも読めるよう、パスは必ず元のリポジトリの絶対パスにする。
- Agent の結果を受け取るたびに、スプリントファイルの表と「記録」を更新する。
- Agent を起動するたびに、結果に含まれる使用量（トークン数、ツール呼び出し数、所要時間）を、スプリントファイルの「Agent 実行ログ」に1行ずつ記録する。取得できない値は `不明` と書く。

## 枠と Agent
- 起動する Agent は `.scrum/team.md` の枠で決める。以下の「implement」「design」「code-review」「security-review」「extra-review」は、それぞれその枠の Agent を指す。
- 依頼には、枠の名前と「`scrum-team:scrum-protocol` に従う」ことを含める。
- PBI に必要な枠に Agent がいない場合（UI を含むのに design がいない等）は、その PBI を `blocked` にし、チーム編成の変更を振り返りで提案する。

## 手順
1. スプリントファイルを読み、状態が `approved` / `blocked` 以外の PBI を処理対象とする。
   - 再開したとき、状態が `design` / `dev` / `review` なのに担当の Agent が動いていない PBI は、中断されたものとみなす。
   - 中断された PBI は、作業ディレクトリで `git status` と `git log` を確かめる。途中の変更が受け入れ基準に沿っていれば、isolation なしの Agent をその作業ディレクトリで起動し、続きから進めさせる。沿っていなければ、作業ディレクトリを捨ててやり直す。
   - どちらにしたかと理由を「記録」に書き、実行ログの目的に `（中断から再開）` を付ける。
2. デザイン：`ui: yes` で UI 仕様が無い PBI に design を起動する。出力先は `.scrum/designs/<pbi-id>.md` とする。依存の無いものは並列に起動する。
3. 実装：依存が解消した PBI に implement を起動する。implement が2人いる場合は、PBI の技術領域に合う方を選ぶ。
   - Agent tool の `isolation: "worktree"` を指定する。
   - 依頼でブランチ名 `scrum/<pbi-id>` と分岐元を指定する。依存の無い PBI の分岐元は `base_branch` とする。未マージの PBI に依存する PBI の分岐元は、依存先のブランチとする。
   - 分岐元を依存先のブランチにした場合は、スプリントファイルの「実行計画」に積み重ねの順序を書く。
   - 同時に動かす implement は3つまでとする。
   - 1つの PBI を2つの implement に分ける場合、バックエンド側を先に起動し、報告の API 契約をフロントエンド側の依頼に含める。2つ目は1つ目の作業ディレクトリで同じブランチに続けてコミットさせる（isolation は指定しない）。
   - `status: blocked` の報告は PBI を `blocked` にし、理由を記録して次へ進む。
4. レビュー：implement の報告ごとに code-review と security-review を並列に起動する。extra-review がいれば、依頼に専門の観点を書いて同時に起動する。依頼には developer の報告と作業ディレクトリを含める。
5. 判定：
   - 全員が `approve`：PBI を `approved` にする。
   - いずれかが `request-changes`：全員の `must` をまとめて同じ implement に差し戻し、差し戻し回数を1増やす。差し戻しは SendMessage で元の developer に送る。送れない場合は、新しい developer を isolation なしで起動し、既存の作業ディレクトリで作業させる。
   - 差し戻しが3回に達しても承認されない：PBI を `blocked` にし、未解消の指摘を記録する。
6. 全 PBI が `approved` か `blocked` になったら、スプリントファイルの `phase` を `demo` にする。

## 記録に残す事項
- 各 Agent の報告の `assumptions` と `unresolved`
- 差し戻しの理由（レトロで使う）
- レビュアーの指摘件数（must / should）と、その観点
- `blocked` の理由
