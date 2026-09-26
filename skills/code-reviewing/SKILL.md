---
name: code-reviewing
description: PBI の実装差分をコードレビューする際の観点と判定書式。受け入れ基準の充足、DoD、UI 仕様との一致、設計・可読性・テストを判定し、approve か request-changes を返す。scrum-team の code-reviewer が使う。
---

# コードレビュー

## 観点（優先順）
1. 受け入れ基準をすべて満たしているか。各基準に対応するテストがあるか。
2. DoD と `.scrum/agreements.md` を満たしているか。
3. UI 仕様がある場合、「状態」「操作」「文言」と実装が一致しているか。
4. テストがすべて通るか。テストが実装の詳細ではなく振る舞いを検証しているか。
5. 受け入れ基準に無い変更が紛れていないか。
6. 既存の設計・命名・慣習に沿っているか。重複や不要な複雑さが無いか。

## 重要度
- `must`：受け入れ基準・DoD・UI 仕様の不充足、テスト失敗、バグ。
- `should`：保守性・可読性の改善。好みの問題は指摘しない。

## 判定書式
`must` が1件でもあれば `request-changes`、無ければ `approve` とする。

```
reviewer: code-reviewer
pbi: <pbi-id>
verdict: approve | request-changes
tests: <実行したコマンドと結果>
findings:
  - [must|should] <file>:<line> — <問題> — <修正方針>
```
