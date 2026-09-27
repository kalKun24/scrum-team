---
name: sprint-review
description: スプリントの成果を PO に提示して受け入れ判定を得て、受け入れた PBI をマージし、バックログを更新する。scrum-team のスプリント実行が終わったとき、またはスプリントファイルの phase が review のときに使う。
---

# スプリントレビュー

## 原則
- PO の承認点の2つ目である。PO が受け入れていない PBI はマージしない。
- PO が判断しやすいよう、PBI ごとに「何が変わったか」「どう確かめられるか」「PO の判断が要る事項」を示す。

## 手順
1. スプリントファイルと各 PBI の記録を読む。
2. PO に次を示す。
   - スプリントゴールの達成状況。
   - `approved` の PBI ごとに：受け入れ基準と満たし方、変更の要約、確認手順（実行コマンドや操作手順）、UI 仕様のパス、Agent が置いた仮定と未解決事項。
   - `.scrum/inception-deck.md` の「夜も眠れない問題」に関わる変更や、新たに見つかったリスク。
   - `blocked` の PBI ごとに：理由と、次スプリントに向けた提案。
3. `approved` の PBI それぞれについて、PO に受け入れか却下かを聞く。却下の場合は理由を聞く。
4. 受け入れた PBI をマージする。`base_branch` で作業ツリーが clean であることを確認してから行う。
   - `backend: github`：ブランチを push し、`gh pr create --base <base_branch> --head scrum/<pbi-id>` でレビュー結果を本文に含めた PR を作り、`gh pr merge --merge --delete-branch` でマージする。
   - それ以外：`git merge --no-ff scrum/<pbi-id>` でマージする。
   - ブランチを積み重ねた PBI は、積み重ねの順にマージする。前の PBI が却下された場合、後ろの PBI はマージせず、却下と同じ扱いにする。理由には「依存先の却下」と書く。
   - 競合した場合：自明なもの（import の並び等）はスクラムマスターが解消する。そうでなければ implement 枠の Agent に解消させ、レビュー枠の全員の再判定を経てからマージする。
5. すべてのマージ後にテストを実行し、テスト数をスプリントファイルの「記録」に書く。失敗した場合は PO に報告し、対応を確認する。
6. バックログを更新する。
   - 受け入れた PBI：`set_status(done)`。Markdown では受け入れ基準を `[x]` にする。
   - 却下した PBI：`set_status(ready)` にし、却下理由を `comment` する。
   - `blocked` の PBI：`set_status(ready)` にし、理由を `comment` する。
7. マージ済みの worktree を `git worktree remove` で削除する。中断から再開した PBI の worktree は、中断した Agent のロックが残っていることがある。ロックの理由に書かれた Agent が中断の記録にあれば、`git worktree unlock` してから削除する。却下・中断の worktree とブランチは残し、スプリントファイルに記録する。
8. スプリントファイルに判定結果を記録し、`phase` を `retrospective` にする。`.scrum/` の変更を `base_branch` にコミットする。
