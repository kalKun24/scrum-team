#!/usr/bin/env python3
"""VoltAgent/awesome-claude-code-subagents を catalog/ に取り込み、一覧 INDEX.md を作る。

使い方: scripts/update-catalog.py [--ref <branch|sha>]
"""

import argparse
import re
import shutil
import subprocess
import tempfile
from datetime import date
from pathlib import Path

REPO = "https://github.com/VoltAgent/awesome-claude-code-subagents.git"
CATALOG = Path(__file__).resolve().parent.parent / "catalog"


def frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    return {k: v.strip().strip('"') for k, v in re.findall(r"^(\w[\w-]*):\s*(.*)$", m.group(1), re.M)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ref", default="main")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "repo"
        subprocess.run(["git", "clone", "-q", REPO, str(src)], check=True)
        subprocess.run(["git", "-C", str(src), "checkout", "-q", args.ref], check=True)
        sha = subprocess.run(["git", "-C", str(src), "rev-parse", "HEAD"],
                             check=True, capture_output=True, text=True).stdout.strip()

        if CATALOG.exists():
            shutil.rmtree(CATALOG)
        CATALOG.mkdir()
        shutil.copy(src / "LICENSE", CATALOG / "LICENSE")
        rows = []
        for path in sorted((src / "categories").glob("*/*.md")):
            if path.name == "README.md":
                continue
            rel = path.relative_to(src / "categories")
            dest = CATALOG / rel
            dest.parent.mkdir(exist_ok=True)
            shutil.copy(path, dest)
            fm = frontmatter(path.read_text(encoding="utf-8"))
            desc = re.sub(r"\s+", " ", fm.get("description", "")).replace("|", "/")
            rows.append((rel.parent.name, fm.get("name", path.stem), desc[:160],
                         fm.get("tools", ""), str(rel)))

    (CATALOG / "SOURCE.md").write_text(
        f"# 取り込み元\n- repository: {REPO}\n- commit: {sha}\n- imported: {date.today()}\n"
        "- license: MIT（catalog/LICENSE）\n", encoding="utf-8")
    lines = ["# Agent カタログ", "",
             f"取り込み元：{REPO} @ `{sha[:12]}`（{len(rows)} 件）", ""]
    category = None
    for cat, name, desc, tools, rel in rows:
        if cat != category:
            category = cat
            lines += ["", f"## {cat}", "", "| name | description | tools | path |", "|---|---|---|---|"]
        lines.append(f"| {name} | {desc} | {tools} | {rel} |")
    (CATALOG / "INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"catalog: {len(rows)} agents @ {sha}")


if __name__ == "__main__":
    main()
