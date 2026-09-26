# scrum-team 開発規約

- Skill の作成・改修は `skill-creator` Skill の原則とレビュー観点に従う。ただし配置は `skills/<skill-name>/SKILL.md` とする。
- 日本語の記述は `japanese-writing` Skill に従う。
- Agent は `agents/<agent-name>.md` に置く。ツール権限・動く時期・独立した判断が他と異なる役割のみ Agent にし、知識だけが異なる役割は Skill にする。
- 役割 Skill には一般論を書かない。DoD・判断基準・チェックリスト・出力書式のみ書く。
- Skill 間・Agent 間で共有する語（PBI の状態名、スプリントファイルの `phase` と「状態」、判定書式の `verdict`）は、定義元のファイルと一致させる。
  - PBI の状態：`skills/backlog-operations/SKILL.md`
  - スプリントファイル：`skills/sprint-planning/SKILL.md`
  - インセプションデッキの節名：`skills/inception-deck/questions.md`
  - 振り返りの書式（指標、Try、依頼）：`skills/sprint-retrospective/formats.md`
  - 判定書式：`skills/code-reviewing/SKILL.md`、`skills/security-reviewing/SKILL.md`
- 変更後は `claude plugin validate --strict .` と `claude plugin validate --strict skills` / `agents` を実行する。
