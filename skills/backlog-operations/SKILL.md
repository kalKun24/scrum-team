---
name: backlog-operations
description: プロダクトバックログの PBI を取得・作成・更新する操作を、バックエンド（Markdown / GitHub Issues / Jira）に依存しない形で定義する。scrum-team の各セレモニーがバックログを読み書きするときに使う。
---

# バックログ操作

## 原則
- バックログへの読み書きはこの Skill の操作だけで行う。
- バックエンドは `.scrum/config.md` の `backend` で判定し、対応する参照ファイルの手順に従う。
  - `markdown`：[markdown.md](markdown.md)
  - `github`：[github.md](github.md)
  - `jira`：[jira.md](jira.md)
- PBI の本文（ストーリー、受け入れ基準）は PO の記述である。Agent は書き換えず、提案はコメントとして追記する。

## PBI のモデル
| 項目 | 内容 |
|---|---|
| `id` | バックエンドの識別子（`PBI-003`、`#12`、`PROJ-45`） |
| `title` | タイトル |
| `story` | ユーザストーリー |
| `acceptance` | 受け入れ基準のリスト |
| `status` | 下記の状態 |
| `points` | 見積り（1, 2, 3, 5, 8）。未見積りは空 |
| `ui` | UI を含むか（`yes` / `no`） |
| 優先度 | バックログ上の並び順。上ほど高い |

## 状態
| 状態 | 意味 | 変更する者 |
|---|---|---|
| `new` | PO が書いた直後。未精査 | PO |
| `ready` | 見積り済みで受け入れ基準が揃っている | refinement |
| `sprint` | 現スプリントの対象 | planning |
| `done` | PO が受け入れた | review |

PO が却下した PBI は `ready` に戻し、却下理由をコメントに書く。

## 操作
- `list(status)`：指定状態の PBI を優先度順に取得する。
- `get(id)`：PBI を1件取得する。
- `create(pbi, parent)`：PBI を作成する。分割時は親 PBI の直後に並べ、親を参照する。
- `set_status(id, status)`：状態を変える。
- `set_fields(id, points, ui)`：見積りと UI 有無を記録する。
- `comment(id, text)`：Agent の提案・記録を追記する。
- `close_as_split(id, children)`：分割済みの親 PBI を、子への参照を残して閉じる。
