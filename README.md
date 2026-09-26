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

プロジェクト開始時、スクラムマスターはインセプションデッキの10の質問を1問ずつ PO に聞き、`.scrum/inception-deck.md` を作る。以降の Agent はデッキの技術方針・やらないこと・トレードオフスライダーに従う。

スプリント中に PO の判断が必要な場面は次の2点に限る。
1. スプリント計画：スプリントゴールと対象 PBI の承認
2. スプリントレビュー：PBI ごとの受け入れ・却下

実装・レビュー・差し戻しは Agent 同士で進める。

レトロスペクティブには、スプリントに参加した全 Agent とスクラムマスターが参加し、それぞれ KPT を出す。Problem はなぜなぜ分析で根本原因まで掘り下げる。Try は5W1H と効果の確認方法を備えた施策として、チーム合意、DoD 変更案、改善 PBI、plugin への改善提案のいずれかに反映する。

## 導入
```
/plugin marketplace add kalKun24/scrum-team
/plugin install scrum-team@scrum-team
```

ローカルで開発する場合は、`/plugin marketplace add <このリポジトリのパス>` で追加する。

## 使い方
1. 対象プロジェクトで `/scrum-team:run-sprint` を実行する。初回はバックログの置き場を選び、続けてインセプションデッキのヒアリングに答える。デッキを見直したいときは `/scrum-team:inception-deck` を実行する。
   - GitHub Issues：`gh` CLI または GitHub MCP を使う。
   - Jira：Atlassian の MCP サーバを使う。
   - Markdown：`.scrum/backlog.md` を使う。
   - 接続が必要な場合は、その手順が案内される。
2. バックログに PBI を書く。書式は `skills/backlog-operations/` の各バックエンドのファイルに従う。
3. 再び `/scrum-team:run-sprint` を実行する。リファインメント → 計画 → 実行 → レビュー → レトロスペクティブの順に進む。
4. 途中で中断しても、次に `/scrum-team:run-sprint` を実行すれば中断したフェーズから再開する。

## ダッシュボード（scrum-dash）
ブラウザでスプリントの進行を見て、PO としての回答や承認をその画面から入力できる。Python 3 の標準ライブラリだけで動き、外部パッケージは要らない。

### 導入
```
ln -s <このリポジトリのパス>/bin/scrum-dash ~/.local/bin/scrum-dash
```

### 起動
```
scrum-dash [対象プロジェクトのパス] [--port 8765] [--plugin-dir <path>] [--no-open]
```
- `127.0.0.1` だけで待ち受け、起動時に表示される URL（トークン付き）をブラウザで開く。
- plugin をインストールせずに使う場合は、`--plugin-dir` にこのリポジトリのパスを渡す。

### 画面
| 場所 | 内容 |
|---|---|
| 左 | スクラムマスターとの会話と、PO の入力欄。入力待ちになると、最後の質問・承認依頼をカードで示す |
| 中央 | 起動された Agent ごとのカード。開くと依頼・発言・操作の要約が流れる。役割で絞り込める |
| 右 | スプリント（PBI・Agent 実行ログ）、振り返り、チーム合意、指標、インセプションデッキ、改善提案、拒否された操作 |

### 注意
- 閲覧は `~/.claude/projects/` の会話ログと `.scrum/` を読むだけで、トークンを使わない。
- 「開始」で `claude` を headless で起動し、以後の入力を同じセッションに渡す。「表示中のセッションを続ける」を選ぶと、表示中のセッションを `--resume` で再開する。
- headless では権限の確認ができないため、許可されていない操作は自動で拒否され、「拒否された操作」タブに出る。下記の権限設定で許可しておく。
- 端末で動いているセッションは閲覧だけできる。同じセッションに端末と画面の両方から入力しない。

## 権限設定
スプリント中、Agent は git とテストのコマンドを繰り返し実行する。確認のプロンプトで止まらないよう、対象プロジェクトの `.claude/settings.json` で許可しておくことを推奨する。テストと実行のコマンドはプロジェクトに合わせて書き換える。

```json
{
  "permissions": {
    "allow": [
      "Skill",
      "Agent",
      "SendMessage",
      "Bash(git:*)",
      "Bash(ls:*)",
      "Bash(mkdir:*)",
      "Bash(npm test:*)"
    ]
  }
}
```

GitHub バックエンドを使う場合は `Bash(gh issue:*)`・`Bash(gh pr:*)`・`Bash(gh label:*)` も加える。

## 対象プロジェクトに作られるファイル
```
.scrum/
  config.md              # バックエンド、容量、DoD
  inception-deck.md      # インセプションデッキ
  backlog.md             # Markdown バックエンドの場合のみ
  agreements.md          # レトロで更新されるチーム合意（Try）
  metrics.md             # スプリントごとの指標
  plugin-feedback.md     # レトロで出た scrum-team plugin への改善提案
  designs/<pbi-id>.md    # UI 仕様
  sprints/sprint-<N>.md  # スプリントの計画・進捗・結果
```

技術スタック固有の規約（言語、テストコマンド等）は、対象プロジェクトの `CLAUDE.md` に書く。Agent はそれに従う。
