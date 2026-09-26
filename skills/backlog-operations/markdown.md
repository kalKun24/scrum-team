# Markdown バックエンド

バックログは `.scrum/backlog.md` に置く。

## 書式
PBI 1件を1つの `##` 節で書く。節の並び順を優先度とする。

```
## PBI-001: <title>
- status: new
- points:
- ui: no

### ストーリー
<利用者>として、<目的>のために、<機能>がほしい。

### 受け入れ基準
- [ ] <基準>

### コメント
- (<ceremony>) <Agent の記録>
```

- PO は `id`・`title`・ストーリー・受け入れ基準・並び順だけを書けばよい。`status` 以下が無い PBI は `new` として扱い、refinement で補う。

## 操作の実現
- `list`：`##` 節を上から順に読み、`status` で絞り込む。
- `create`：未使用の最大番号 + 1 で `PBI-<3桁>` を採番し、親の節の直後に挿入する。コメントに `split from <親id>` と書く。
- `set_status` / `set_fields`：該当節の箇条書きを書き換える。
- `comment`：該当節の `### コメント` に追記する。節が無ければ作る。
- `close_as_split`：親の節を削除する。子の `split from` で経緯を辿る。
- 受け入れ基準のチェックボックスは review で PO が受け入れた時にのみ `[x]` にする。
