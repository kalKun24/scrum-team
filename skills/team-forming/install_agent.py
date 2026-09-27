#!/usr/bin/env python3
"""catalog/ の Agent を対象プロジェクトの .claude/agents/ に取り込み、.scrum/team.md を更新する。

取り込み:  install_agent.py --project <path> --slot <slot> --agent <catalog 内のパス> --reason <理由>
取り外し:  install_agent.py --project <path> --remove <agent 名>
"""

import argparse
import re
import sys
from pathlib import Path

CATALOG = Path(__file__).resolve().parents[2] / "catalog"
SLOTS = {
    "implement": ("実装", ["backend-implementing", "frontend-implementing"]),
    "design": ("デザイン", ["ui-designing"]),
    "code-review": ("コードレビュー", ["code-reviewing"]),
    "security-review": ("セキュリティレビュー", ["security-reviewing"]),
    "extra-review": ("専門レビュー", ["code-reviewing"]),
}
READ_ONLY = "Read, Grep, Glob, Bash"
HEADER = "# チーム編成\n\n| 枠 | Agent | 出典 | 選定理由 |\n|---|---|---|---|\n"


def source_sha():
    text = (CATALOG / "SOURCE.md").read_text(encoding="utf-8")
    m = re.search(r"^- commit:\s*(\S+)", text, re.M)
    return m.group(1) if m else "unknown"


def build(src_path, slot):
    text = src_path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        sys.exit(f"frontmatter が無い: {src_path}")
    lines = m.group(1).splitlines()
    fields = {l.split(":", 1)[0]: l for l in lines if re.match(r"^\w[\w-]*:", l)}
    name = fields["name"].split(":", 1)[1].strip().strip('"')
    if not re.fullmatch(r"[a-z0-9-]+", name):
        sys.exit(f"不正な Agent 名: {name}")
    tools = fields.get("tools", "tools: Read").split(":", 1)[1].strip()
    if slot.endswith("review"):
        tools = READ_ONLY
    elif slot == "implement" and "Bash" not in tools:
        tools += ", Bash"
    skills = ["scrum-protocol", "invisible-characters", *SLOTS[slot][1]]
    fm = [fields["name"], fields["description"], f"tools: {tools}", "model: sonnet", "skills:",
          *[f"  - scrum-team:{s}" for s in skills]]
    rel = src_path.relative_to(CATALOG)
    body = (f"<!-- source: VoltAgent/awesome-claude-code-subagents@{source_sha()} categories/{rel} -->\n\n"
            f"あなたは scrum-team のチームメンバーで、枠は「{SLOTS[slot][0]}（{slot}）」である。"
            "`scrum-team:scrum-protocol` の手順と優先順位が、以下の本文より優先する。\n\n"
            + m.group(2).lstrip("\n"))
    return name, "---\n" + "\n".join(fm) + "\n---\n\n" + body, rel


def update_team(project, name, row):
    team = project / ".scrum" / "team.md"
    text = team.read_text(encoding="utf-8") if team.exists() else HEADER
    kept = [l for l in text.splitlines() if not re.match(rf"^\|[^|]*\|\s*{re.escape(name)}\s*\|", l)]
    if row:
        kept.append(row)
    team.parent.mkdir(exist_ok=True)
    team.write_text("\n".join(kept) + "\n", encoding="utf-8")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--project", required=True)
    p.add_argument("--slot", choices=SLOTS)
    p.add_argument("--agent", help="catalog/ からの相対パス（例：02-language-specialists/python-pro.md）")
    p.add_argument("--reason", default="")
    p.add_argument("--remove")
    a = p.parse_args()
    project = Path(a.project).resolve()
    agents = project / ".claude" / "agents"

    if a.remove:
        (agents / f"{a.remove}.md").unlink(missing_ok=True)
        update_team(project, a.remove, None)
        print(f"removed: {a.remove}")
        return
    if not (a.slot and a.agent):
        p.error("--slot と --agent が必要である")
    src = (CATALOG / a.agent).resolve()
    if CATALOG not in src.parents or not src.is_file():
        sys.exit(f"カタログに無い: {a.agent}")
    name, content, rel = build(src, a.slot)
    agents.mkdir(parents=True, exist_ok=True)
    (agents / f"{name}.md").write_text(content, encoding="utf-8")
    reason = a.reason.replace("|", "/").replace("\n", " ")
    update_team(project, name, f"| {a.slot} | {name} | {rel}@{source_sha()[:12]} | {reason} |")
    print(f"installed: {name} ({a.slot}) -> {agents / (name + '.md')}")


if __name__ == "__main__":
    main()
