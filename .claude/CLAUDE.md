# scrum-team 開発規約

- Skill の作成・改修は `skill-creator` Skill の原則とレビュー観点に従う。ただし配置は `skills/<skill-name>/SKILL.md` とする。
- 日本語の記述は `japanese-writing` Skill に従う。
- plugin は固定の Agent を持たない。チームの Agent は `catalog/` から `team-forming` で取り込む。`catalog/` は手で編集せず、`scripts/update-catalog.py` で更新する。
- Agent 共通の手順は `skills/scrum-protocol/` に書く。知識だけが異なる役割は枠ごとの Skill にする。
- 役割 Skill には一般論を書かない。DoD・判断基準・チェックリスト・出力書式のみ書く。
- Skill 間・Agent 間で共有する語（PBI の状態名、スプリントファイルの `phase` と「状態」、判定書式の `verdict`）は、定義元のファイルと一致させる。
  - PBI の状態：`skills/backlog-operations/SKILL.md`
  - スプリントファイル：`skills/sprint-planning/SKILL.md`
  - インセプションデッキの節名：`skills/inception-deck/questions.md`
  - 振り返りの書式（指標、Try、依頼）：`skills/sprint-retrospective/formats.md`
  - 枠の名前（implement 等）：`skills/team-forming/SKILL.md`
  - 判定書式：`skills/code-reviewing/SKILL.md`、`skills/security-reviewing/SKILL.md`
- 変更後は `claude plugin validate --strict .` と `claude plugin validate --strict skills` を実行する。
