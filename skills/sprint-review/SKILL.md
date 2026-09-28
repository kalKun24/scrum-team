---
name: sprint-review
description: スプリントのデモを PO に見せて、できたもの全体の受け入れ判定を得て、統合ブランチをマージし、バックログを更新する。scrum-team のデモの準備が終わったとき、またはスプリントファイルの phase が review のときに使う。
---

# スプリントレビュー

## 原則
- PO の承認点の2つ目である。PO は「やったこと」ではなく、デモで見た「できたもの」全体を受け入れるかを判断する。
- PO が受け入れていないものはマージしない。
- 最初に見せるのはデモである。PBI ごとの変更の説明は、PO が求めたときの補足にする。

## 手順
1. スプリントファイル、`.scrum/demos/sprint-<N>/` の `README.md` と `rehearsal.md` を読む。
2. PO に次を示す。
   - スプリントゴールと、デモで達成を確かめられるか。
   - デモの動かし方（1コマンド）と台本。
   - リハーサルの結果：場面ごとの判定と、実際の出力の要点。「不一致」「未達」の場面は、理由と対応案を添える。
   - `.scrum/inception-deck.md` の「夜も眠れない問題」に関わる変更や、新たに見つかったリスク。
   - `blocked` の PBI と、その理由。
3. PO に、デモで見たもの全体を受け入れるかを聞く。
4. 判定を、スプリントファイルの「デモの判定」の表に1行足す（書式は下記）。受け入れならマージの後に、差し戻しなら対応が決まった後に書く。
5. 受け入れた場合：統合ブランチ `scrum/sprint-<N>` をマージする。`base_branch` で作業ツリーが clean であることを確認してから行う。
   - `backend: github`：統合ブランチを push し、`gh pr create --base <base_branch> --head scrum/sprint-<N>` でデモの台本とリハーサルの結果を本文に含めた PR を作り、`gh pr merge --merge --delete-branch` でマージする。
   - それ以外：`git merge --no-ff scrum/sprint-<N>` でマージする。
   - マージ後に `base_branch` でテストを実行し、テスト数を「記録」に書く。失敗した場合は PO に報告し、対応を確認する。
6. 受け入れない場合（差し戻し）：[rejection.md](rejection.md) の手順で、PO の指摘を PBI と振る舞いに対応づけ、PO に対応を選んでもらう。
   - 「直して見せ直す」「除いて見せ直す」を選んだら、rejection.md のとおり作業を進め、`sprint-demo` を実行してから、この Skill の手順1からやり直す。
   - 「マージしない」を選んだら、手順7に進む。
7. バックログを更新する。
   - マージした PBI：`set_status(done)`。Markdown では受け入れ基準を `[x]` にする。
   - マージしなかった PBI：`set_status(ready)` にし、PO が挙げた振る舞いと、デモの判定の回を `comment` する。
   - `blocked` の PBI：`set_status(ready)` にし、理由を `comment` する。
8. 後片付けをする。
   - マージ済みの PBI のブランチと worktree、統合ブランチの worktree を削除する（`git worktree remove`）。
   - 中断から再開した PBI の worktree は、中断した Agent のロックが残っていることがある。ロックの理由に書かれた Agent が中断の記録にあれば、`git worktree unlock` してから削除する。
   - マージしなかった PBI の worktree とブランチは残し、スプリントファイルに記録する。
9. スプリントファイルの対象 PBI の「状態」を `accepted` / `rejected` にし、`phase` を `retrospective` にする。`.scrum/` の変更を `base_branch` にコミットする。

## デモの判定の書式
スプリントファイルの「記録」の後に、次の表を置く。回ごとに1行を足し、書き換えない。
```
## デモの判定
| 回 | 日時 | 判定 | PO の指摘 | 原因の PBI | 対応 |
|---|---|---|---|---|---|
| 1 | <date -Iseconds> | 差し戻し | <PO の言葉のまま> | <pbi-id> | 直して見せ直す / 除いて見せ直す / マージしない |
| 2 | <date -Iseconds> | 受け入れ | — | — | マージした |
```
