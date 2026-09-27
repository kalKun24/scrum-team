---
name: sprint-planning
description: 状態が ready の PBI から容量内でスプリントの対象を選び、スプリントゴールを起案して PO の承認を得て、スプリントファイルを作成する。scrum-team でスプリントを始めるときに使う。
---

# スプリント計画

## 原則
- PO の承認点の1つ目である。承認を得るまで開発を始めない。
- 選定は優先度順とし、優先度を飛ばす場合は理由を示す。

## 手順
1. `.scrum/config.md` の `sprint` に1を足した値を今回のスプリント番号 `N` とする。
2. `backlog-operations` の `list(ready)` を優先度順に取得する。
3. 上から順に、合計ポイントが `capacity` を超えない範囲で選ぶ。未完了の PBI に依存する PBI は飛ばし、理由を記録する。
4. 選んだ PBI 群から、スプリントゴールを1文で起案する。`.scrum/inception-deck.md` の「我々はなぜここにいるのか」と「エレベーターピッチ」に沿わせる。
5. PBI ごとに実行計画を立てる。
   - `ui: yes` なら design を先に起動する。`.scrum/team.md` に必要な枠の Agent がいなければ、チーム編成の変更を PO に提案する。
   - バックエンドとフロントエンドを別の implement に分けるか。分ける場合は API 契約を誰が先に決めるか。
   - PBI 間の依存と、並列に進めてよい組み合わせ。
   - 依存する PBI はブランチを積み重ねること。積み重ねた場合、前の PBI を却下すると後ろの PBI もそのままマージできないこと。
6. PO に次を示し、承認を求める。`.scrum/team.md` の `## 変更案` があれば、その採否もあわせて聞く：スプリントゴール、対象 PBI と合計ポイント、飛ばした PBI と理由、実行計画の要点。`.scrum/config.md` に `## DoD 変更案` があれば、その案ごとの採否もあわせて聞く。
7. PO が修正を求めた場合は反映して再提示する。
8. 承認後、次を行う。
   - `.scrum/sprints/sprint-<N>.md` を下記の書式で作成する。
   - `.scrum/config.md` の `sprint` を `N` にする。
   - 対象 PBI を `set_status(sprint)` にする。
   - DoD 変更案のうち採用されたものを DoD に反映し、採否にかかわらず案を削除する。採否はスプリントファイルの「記録」に書く。

## スプリントファイルの書式
```
# Sprint <N>
- phase: execution
- goal: <スプリントゴール>
- started: <計画の承認日時（ISO 8601、タイムゾーン付き）>
- base_branch: <base_branch>

## 対象 PBI
| PBI | points | ui | 担当構成 | 状態 | 差し戻し | ブランチ | 作業ディレクトリ |
|---|---|---|---|---|---|---|---|
| <id> | 3 | yes | ui-designer → python-pro | todo | 0 | | |

## 実行計画
<依存と並列の組み合わせ>

## Agent 実行ログ
| PBI | Agent | 目的 | tokens | tool_uses | 所要時間 |
|---|---|---|---|---|---|

## 記録
<execution 以降で追記する>
```

- 実行ログの「目的」は `design` / `implement` / `rework` / `review` / `retro` を使う。
- 「状態」は `todo` / `design` / `dev` / `review` / `approved` / `blocked` / `accepted` / `rejected` を使う。
