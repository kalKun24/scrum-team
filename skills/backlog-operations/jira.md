# Jira バックエンド

Atlassian の MCP サーバが提供するツール（JQL 検索、課題の取得・作成・編集・遷移、コメント追加）を使う。ツール名は接続した MCP サーバの一覧で確認する。対象は `.scrum/config.md` の `jira.site` と `jira.project` である。

## 対応関係
| モデル | Jira |
|---|---|
| PBI | 課題タイプ `Story`（`jira.issue_type` で変更可） |
| `story` / `acceptance` | 説明欄の「ストーリー」「受け入れ基準」見出し。受け入れ基準用のカスタムフィールドがあれば `jira.acceptance_field` を優先する |
| `status` | `.scrum/config.md` の `jira.status_map` で Jira のステータス名と対応付ける |
| `points` | `jira.points_field` のフィールド |
| `ui` | ラベル `ui` の有無 |
| 優先度 | Rank の順（JQL の `ORDER BY Rank`） |
| スプリント | Jira のスプリント。使えないボードでは `fixVersion` を `Sprint <N>` とする |

## 操作の実現
- `list`：JQL `project = <project> AND issuetype = <type> AND status in (<status_map の値>) ORDER BY Rank` で検索する。
- `get`：課題キーで取得し、コメントも読む。
- `create`：親と同じプロジェクトに作成し、親課題へ `split from` のリンクまたはコメントを付ける。
- `set_status`：課題の遷移一覧から、対応するステータスへの遷移を実行する。遷移が無い場合は PO に報告して止める。
- `set_fields`：`jira.points_field` を更新し、`ui` ラベルを付け外しする。
- `comment`：課題にコメントを追加する。
- `close_as_split`：子へのリンクをコメントし、`done` に対応するステータスへ遷移する。
