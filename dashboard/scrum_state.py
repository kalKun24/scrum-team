""".scrum/ の内容を画面表示用に解析する。"""

import re
from pathlib import Path


def _read(path):
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _field(text, name):
    m = re.search(rf"^- {re.escape(name)}:\s*(.*)$", text or "", re.M)
    return m.group(1).strip() if m else None


def _section(text, heading):
    """`## heading` から次の同じ深さ以上の見出しまでを返す。"""
    if not text:
        return None
    level = len(heading) - len(heading.lstrip("#"))
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.strip() == heading:
            body = []
            for rest in lines[i + 1:]:
                m = re.match(r"^(#+)\s", rest)
                if m and len(m.group(1)) <= level:
                    break
                body.append(rest)
            return "\n".join(body).strip()
    return None


def _table(markdown):
    """最初の Markdown 表を行の辞書のリストにする。"""
    rows = [l.strip() for l in (markdown or "").splitlines() if l.strip().startswith("|")]
    if len(rows) < 2:
        return []
    split = lambda r: [c.strip() for c in r.strip("|").split("|")]
    header = split(rows[0])
    return [dict(zip(header, split(r))) for r in rows[2:]]


class ScrumState:
    def __init__(self, project):
        self.root = Path(project).resolve() / ".scrum"
        self._sig = None
        self.snapshot = None

    def _signature(self):
        if not self.root.is_dir():
            return ()
        return tuple(sorted((str(p), p.stat().st_mtime_ns)
                            for p in self.root.rglob("*.md")))

    def poll(self):
        """内容が変わっていれば新しいスナップショットを返す。変わっていなければ None。"""
        sig = self._signature()
        if sig == self._sig:
            return None
        self._sig = sig
        self.snapshot = self._build()
        return self.snapshot

    def _latest_sprint(self, config):
        n = _field(config, "sprint")
        sprints = self.root / "sprints"
        if n and n.isdigit() and (sprints / f"sprint-{n}.md").exists():
            return int(n), sprints / f"sprint-{n}.md"
        files = [(int(m.group(1)), p) for p in sprints.glob("sprint-*.md")
                 if (m := re.match(r"sprint-(\d+)\.md$", p.name))]
        return max(files) if files else (None, None)

    def _sprint(self, number, path):
        text = _read(path) if path else None
        return {
            "number": number,
            "phase": _field(text, "phase"),
            "goal": _field(text, "goal"),
            "pbis": _table(_section(text, "## 対象 PBI")),
            "agent_log": _table(_section(text, "## Agent 実行ログ")),
            "retro": _section(text, "## レトロスペクティブ") or _section(text, "## KPT"),
            "markdown": text,
        }

    def _build(self):
        if not self.root.is_dir():
            return {"initialized": False}
        config = _read(self.root / "config.md")
        number, path = self._latest_sprint(config)
        sprints = sorted(
            ((int(m.group(1)), p) for p in (self.root / "sprints").glob("sprint-*.md")
             if (m := re.match(r"sprint-(\d+)\.md$", p.name))), reverse=True)
        backlog = _read(self.root / "backlog.md")
        counts = {}
        for status in re.findall(r"^- status:\s*(\S+)", backlog or "", re.M):
            counts[status] = counts.get(status, 0) + 1
        return {
            "initialized": True,
            "backend": _field(config, "backend"),
            "capacity": _field(config, "capacity"),
            "sprint": self._sprint(number, path),
            "sprints": [self._sprint(n, p) for n, p in sprints],
            "backlog_counts": counts,
            "agreements": _read(self.root / "agreements.md"),
            "metrics": _read(self.root / "metrics.md"),
            "inception_deck": _read(self.root / "inception-deck.md"),
            "plugin_feedback": _read(self.root / "plugin-feedback.md"),
        }
