---
name: scrum-setup
description: 対象プロジェクトで scrum-team を使い始めるための初期設定。PO にバックログの置き場（GitHub Issues / Jira / Markdown）を選ばせ、接続を確認し、.scrum/ を初期化する。.scrum/config.md が無いとき、またはバックログの置き場を変えたいときに使う。
---

# スクラムの初期設定

## 原則
- 選択は PO が行う。スクラムマスターは選択肢と各前提を示すだけにする。
- 外部サービスの接続は PO の操作が必要な箇所（認証、MCP の追加）で止め、実行するコマンドを示して待つ。
- 接続できない場合、Markdown で仮に始めるかを PO に確認する。黙って切り替えない。

## 手順
1. `.scrum/config.md` があれば内容を示し、作り直すかを PO に確認する。
2. PO にバックエンドを選ばせる：GitHub Issues / Jira / Markdown。
3. 選ばれたバックエンドの接続を [backends.md](backends.md) の手順で確認する。未接続なら同ファイルの手順を案内し、PO の完了報告を待って再確認する。
4. PO に次の値を確認する。既定値を示し、変更が無ければ既定値を使う。
   - `capacity`：1スプリントのポイント上限（既定 10）
   - `base_branch`：現在の既定ブランチ
   - DoD：下記の既定に追加・削除する項目
5. 下記の書式で `.scrum/` を作成する。
6. バックエンドが `github` なら、`backlog-operations` の github.md にあるラベルを作成する。`markdown` なら `.scrum/backlog.md` を見出しだけで作成する。
7. PO に、バックログの書き方（`backlog-operations` の各参照ファイルの書式）と、次に `run-sprint` を実行することを伝える。

## `.scrum/config.md` の書式
```
# Scrum config
- backend: markdown | github | jira
- capacity: 10
- base_branch: main
- sprint: 0
<github の場合>
- github.repo: <owner>/<name>
<jira の場合>
- jira.site: <site>.atlassian.net
- jira.project: <KEY>
- jira.issue_type: Story
- jira.points_field: <フィールド名または ID>
- jira.status_map: new=<名>, ready=<名>, sprint=<名>, done=<名>

## Definition of Done
- 受け入れ基準をすべて満たし、各基準に対応するテストがある
- 既存を含むすべてのテストが通る
- code-review 枠と security-review 枠（extra-review 枠がいればそれも）の Agent が approve している
- UI を含む PBI は UI 仕様と一致している
- スプリントのデモの台本どおりに動く（リハーサルで確かめる）
```

## 作成するその他のファイル
- `.scrum/agreements.md`：見出し `# チーム合意` のみ。
- `.scrum/sprints/`・`.scrum/designs/`：空ディレクトリ（`.gitkeep` を置く）。
- `.claude/agents/`：空ディレクトリ（`.gitkeep` を置く）。セッションの開始時にこのディレクトリが無いと、後で取り込んだ Agent をそのセッションで使えないためである。
