# scrum-team

プロダクトオーナー（PO）をユーザが担い、それ以外の役割を Agent が担ってスプリントを回す Claude Code plugin である。

## 役割
| 役割 | 担い手 | 使う Skill |
|---|---|---|
| プロダクトオーナー | ユーザ | — |
| スクラムマスター | メインセッション | `run-sprint` ほか運営 Skill |
| デザイナー | `designer` agent | `ui-designing` |
| 開発者 | `developer` agent | `backend-implementing` / `frontend-implementing` |
| コードレビュアー | `code-reviewer` agent | `code-reviewing` |
| セキュリティレビュアー | `security-reviewer` agent | `security-reviewing` |

PO の判断が必要な場面は次の2点に限る。
1. スプリント計画：スプリントゴールと対象 PBI の承認
2. スプリントレビュー：PBI ごとの受け入れ・却下

実装・レビュー・差し戻しは Agent 同士で進める。

## 導入
```
/plugin marketplace add kalKun24/scrum-team
/plugin install scrum-team@scrum-team
```

ローカルで開発する場合は、`/plugin marketplace add <このリポジトリのパス>` で追加する。

## 使い方
1. 対象プロジェクトで `/scrum-team:run-sprint` を実行する。初回はバックログの置き場を選ぶ。
   - GitHub Issues：`gh` CLI または GitHub MCP を使う。
   - Jira：Atlassian の MCP サーバを使う。
   - Markdown：`.scrum/backlog.md` を使う。
   - 接続が必要な場合は、その手順が案内される。
2. バックログに PBI を書く。書式は `skills/backlog-operations/` の各バックエンドのファイルに従う。
3. 再び `/scrum-team:run-sprint` を実行する。リファインメント → 計画 → 実行 → レビュー → レトロスペクティブの順に進む。
4. 途中で中断しても、次に `/scrum-team:run-sprint` を実行すれば中断したフェーズから再開する。

## 対象プロジェクトに作られるファイル
```
.scrum/
  config.md              # バックエンド、容量、DoD
  backlog.md             # Markdown バックエンドの場合のみ
  agreements.md          # レトロで更新されるチーム合意
  designs/<pbi-id>.md    # UI 仕様
  sprints/sprint-<N>.md  # スプリントの計画・進捗・結果
```

技術スタック固有の規約（言語、テストコマンド等）は、対象プロジェクトの `CLAUDE.md` に書く。Agent はそれに従う。
