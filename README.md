# scrum-team

プロダクトオーナー（PO）をユーザが担い、それ以外の役割を Agent が担ってスプリントを回す Claude Code plugin である。

## 役割
| 役割 | 担い手 | 使う Skill |
|---|---|---|
| プロダクトオーナー | ユーザ | — |
| スクラムマスター | メインセッション | `run-sprint` ほか運営 Skill |
| チームの Agent | カタログから選んで編成する | `scrum-protocol` と枠ごとの Skill |

チームの Agent は固定しない。プロジェクト開始時に次の順で決める。
1. スクラムマスターがインセプションデッキの10の質問を1問ずつ PO に聞き、`.scrum/inception-deck.md` を作る。
2. スクラムマスターがデッキをもとに、同梱のカタログ（`catalog/`）から枠ごとの Agent を提案し、PO が承認する。承認された Agent は対象プロジェクトの `.claude/agents/` に取り込まれ、`.scrum/team.md` に記録される。

| 枠 | 必須 | 付与される Skill |
|---|---|---|
| implement（実装） | 必須・1〜2 | `backend-implementing` / `frontend-implementing` |
| design（デザイン） | UI がある場合 | `ui-designing` |
| code-review（コードレビュー） | 必須 | `code-reviewing` |
| security-review（セキュリティレビュー） | 必須 | `security-reviewing` |
| extra-review（専門レビュー） | 任意 | `code-reviewing` |

取り込むときに、すべての Agent に `scrum-protocol`（報告書式、ブランチ、優先順位などの共通手順）と `invisible-characters` を付ける。レビュー枠は書き込み権限を外し、モデルは sonnet に揃える。チーム編成は振り返りの Try から見直せる。

## カタログ
`catalog/` は [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)（MIT）の Agent 定義を取り込んだものである。取り込み元のコミットは `catalog/SOURCE.md`、一覧は `catalog/INDEX.md` にある。更新するときは `scripts/update-catalog.py [--ref <branch|sha>]` を実行し、差分を確かめてからコミットする。

各スプリントの成果は、PO が触れて確かめられるデモである。スプリントゴールは「スプリントの終わりに PO が何をして、何を見られるか」で書き、実行の後に「デモ準備」のフェーズを置く。デモ準備では、承認された PBI を統合ブランチにまとめ、`.scrum/demos/sprint-<N>/` に台本（`README.md`）、1コマンドで動くスクリプト（`demo.sh`）、リハーサル記録（`rehearsal.md`）を作る。

スプリント中に PO の判断が必要な場面は次の2点に限る。
1. スプリント計画：スプリントゴール、デモ台本の下書き、対象 PBI の承認
2. スプリントレビュー：デモで見たもの全体の受け入れ（受け入れたら統合ブランチをマージする）

実装・レビュー・差し戻しは Agent 同士で進める。

レトロスペクティブには、スプリントに参加した全 Agent とスクラムマスターが参加し、それぞれ KPT を出す。Problem はなぜなぜ分析で根本原因まで掘り下げる。Try は5W1H と効果の確認方法を備えた施策として、チーム合意、DoD 変更案、改善 PBI、チーム編成の変更案、plugin への改善提案のいずれかに反映する。

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
3. 再び `/scrum-team:run-sprint` を実行する。リファインメント → 計画 → 実行 → デモ準備 → レビュー → レトロスペクティブの順に進む。
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
| タブ | 内容 |
|---|---|
| スプリント | 左：PO の受信箱（受け入れ判定のカード、スクラムマスターからの依頼、入力欄、スクラムマスターの記録）。中央：このスプリントの PBI の進み具合とチームの各 Agent。右：選んだ Agent の判定・依頼・操作・発言 |
| ボード | 左：バックログ（このスプリント・次の候補・完了したスプリント）。右：スプリントボード（未着手・デザイン・実装・レビュー・PO の判定・完了）。GitHub では PR とチェックの状態も出す |
| 振り返り・チーム・指標・デッキ | スプリントの振り返り、チーム編成とチーム合意、スプリントごとの指標、インセプションデッキ |
| 履歴 | プロジェクトの全セッション。会話の全文を開くか、そのセッションから再開できる |

ヘッダの「Sprint N」から、過去のスプリントに切り替えられる。過去のスプリントでは、結果・指標・その期間の会話・当時のチーム・振り返りを閲覧のみで表示する。スプリントの期間は、スプリントファイルの `started` / `closed`（無ければ git のコミット時刻）から求める。

GitHub Issues・Jira のバックログは、スクラムマスターが書き出す `.scrum/backlog-snapshot.json` を表示する。ダッシュボードは外部サービスの認証情報を持たない（GitHub の PR の状態だけは、ローカルの `gh` で読む）。

### 注意
- 閲覧は `~/.claude/projects/` の会話ログと `.scrum/` を読むだけで、トークンを使わない。
- 「開始」で `claude` を headless で起動し、以後の入力を同じセッションに渡す。「表示中のセッションを続ける」を選ぶと、表示中のセッションを `--resume` で再開する。
- headless では権限の確認ができないため、許可されていない操作は自動で拒否され、「拒否された操作」タブに出る。下記の権限設定で許可しておく。
- 端末で動いているセッションは閲覧だけできる。同じセッションに端末と画面の両方から入力しない。
- 操作中のセッション、拒否された操作、実行中の Agent は `~/.local/state/scrum-dash/<プロジェクト>.json` に保存する。ダッシュボードを再起動しても、前回操作したセッションを再開先にする。
- Agent が作業中のまま止まった場合（停止ボタン、ダッシュボードの終了）は、再開時にその Agent と作業ディレクトリをスクラムマスターに伝え、続きから進めるかやり直すかを判断させる。

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
      "Bash(date:*)",
      "Bash(bash .scrum/demos/:*)",
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
  team.md                # チーム編成（枠・Agent・出典・選定理由）
  inception-deck.md      # インセプションデッキ
  backlog.md             # Markdown バックエンドの場合のみ
  agreements.md          # レトロで更新されるチーム合意（Try）
  metrics.md             # スプリントごとの指標
  plugin-feedback.md     # レトロで出た scrum-team plugin への改善提案
  designs/<pbi-id>.md    # UI 仕様
  demos/sprint-<N>/      # デモの台本・実行スクリプト・リハーサル記録
  sprints/sprint-<N>.md  # スプリントの計画・進捗・結果
```

技術スタック固有の規約（言語、テストコマンド等）は、対象プロジェクトの `CLAUDE.md` に書く。Agent はそれに従う。
