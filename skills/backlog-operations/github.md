# GitHub Issues バックエンド

`gh` CLI を使う。`gh` が使えず GitHub MCP が接続されている場合は、同等の MCP ツールで同じ操作を行う。対象リポジトリは `.scrum/config.md` の `github.repo` である。

## 対応関係
| モデル | GitHub |
|---|---|
| PBI | `pbi` ラベル付きの Issue |
| `story` / `acceptance` | Issue 本文の `## ストーリー` / `## 受け入れ基準` 節 |
| `status` | ラベル `status:new` / `status:ready` / `status:sprint`。`done` は Issue のクローズ |
| `points` | ラベル `points:<n>` |
| `ui` | ラベル `ui` の有無 |
| 優先度 | ラベル `priority:<n>`（小さいほど高い）。同順位は Issue 番号の昇順 |
| スプリント | milestone `Sprint <N>` |

- ラベルと milestone が無ければ scrum-setup の時点で作成する。
- `status:*` ラベルが無い `pbi` Issue は `new` として扱う。

## 操作の実現
- `list`：`gh issue list -R <repo> --label pbi --label status:<s> --state open --json number,title,body,labels --limit 200` の結果を優先度で並べ替える。`done` は `--state closed`。
- `get`：`gh issue view <n> -R <repo> --json number,title,body,labels,comments`
- `create`：`gh issue create -R <repo> --title <t> --body <b> --label pbi,status:new`。本文末尾に `split from #<親>` を書く。
- `set_status`：`gh issue edit <n> --remove-label status:<旧> --add-label status:<新>`。`done` は `gh issue close <n>`。`sprint` にする時は `--milestone "Sprint <N>"` も付ける。
- `set_fields`：`points:*` ラベルを付け替え、`ui` ラベルを付け外しする。
- `comment`：`gh issue comment <n> -R <repo> --body <text>`
- `close_as_split`：`gh issue close <n> -R <repo> --reason "not planned" --comment "split into #<子>, ..."`
