---
name: run-sprint
description: scrum-team のスプリントを1回分、初期設定の確認からリファインメント・計画・実行・レビュー・レトロスペクティブまで順に進める入口。PO が「スプリントを回して」「スプリント開始」と依頼したとき、または中断したスプリントを再開するときに使う。
---

# スプリントの実行

## 原則
- メインセッションがスクラムマスターを担う。ユーザは PO である。
- PO の承認点は計画時とレビュー時の2点のみとする。それ以外で PO に確認するのは、初期設定と、インセプションデッキのヒアリングと、チーム編成の承認と、リファインメントでの受け入れ基準の不足・分割の相談だけとする。
- この plugin の Skill と Agent は `scrum-team:` 接頭辞付きの名前で呼び出す（例：`scrum-team:sprint-planning`）。チームの Agent は `.scrum/team.md` に書かれた名前で呼び出す。
- Bash は1回に1コマンドだけ実行し、`&&`・`;`・`|` でつながない。ファイルの閲覧・編集は Read / Edit / Write を使う。権限の確認で止まるのを防ぐためである。
- スプリントの記録やバックログに制御文字・不可視文字を書く場合は `scrum-team:invisible-characters` に従う。
- 各フェーズは対応する Skill の手順に従う。この Skill は順序と再開位置だけを決める。

## 手順
1. `.scrum/config.md` が無ければ `scrum-team:scrum-setup` を実行する。
   - 続けて、`.scrum/inception-deck.md` が無いか `status: agreed` でなければ `scrum-team:inception-deck` を実行する。デッキが合意されるまで手順2以降に進まない。
   - 続けて、`.scrum/team.md` が無ければ `scrum-team:team-forming` を実行する。
2. 最新の `.scrum/sprints/sprint-<N>.md` を読み、`phase` が `closed` 以外なら、そのフェーズから再開する。
   - `execution` → 手順5
   - `review` → 手順6
   - `retrospective` → 手順7
3. 状態が `new` の PBI があれば `scrum-team:backlog-refinement` を実行する。
4. 状態が `ready` の PBI が無ければ、PO にバックログの追加を依頼して終了する。あれば `scrum-team:sprint-planning` を実行する。
5. `scrum-team:sprint-execution` を実行する。
6. `scrum-team:sprint-review` を実行する。
7. `scrum-team:sprint-retrospective` を実行する。
8. PO に、次のスプリントを続けて回すかを確認する。続ける場合は手順3へ戻る。
