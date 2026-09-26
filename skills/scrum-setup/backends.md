# バックエンドの接続手順

## GitHub Issues
### 確認
1. `gh auth status` が成功するか確認する。
2. `git remote get-url origin` から `<owner>/<name>` を求め、PO に対象リポジトリを確認する。
3. `gh repo view <owner>/<name> --json hasIssuesEnabled` で Issues が有効か確認する。

### 未接続時の案内
- `gh` 未導入：OS に応じた導入方法を示す。
- 未認証：PO に `! gh auth login` の実行を依頼する。
- `gh` を使えない環境：GitHub MCP を使う。PO に `claude mcp add --transport http github https://api.githubcopilot.com/mcp/` を実行してもらい、`/mcp` で認証してもらう。追加後はセッションの再起動が必要な場合がある。

## Jira
### 確認
1. Atlassian の MCP ツール（JQL 検索、課題の取得）が使えるか、ツール一覧で確認する。
2. PO に `site` と `project` を確認し、そのプロジェクトで JQL 検索が成功するか確かめる。
3. 1件の課題を取得し、ストーリーポイントのフィールドと、ワークフローのステータス名を PO と確認する。この結果から `jira.points_field` と `jira.status_map` を決める。

### 未接続時の案内
- PO に Atlassian の公式リモート MCP サーバの追加を依頼する：`claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp`。その後 `/mcp` で認証してもらう。
- URL は Atlassian 側で変わることがある。追加に失敗した場合は、Atlassian の MCP サーバの公式ドキュメントで最新の URL を確認するよう PO に伝える。
- 追加後はセッションの再起動が必要な場合がある。再起動後に `run-sprint` を再実行すれば、この確認から再開する。

## Markdown
- 接続は不要である。`.scrum/backlog.md` を使う。
