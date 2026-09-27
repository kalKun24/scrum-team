""".scrum/ の内容を画面表示用に解析する。"""

import json
import re
import subprocess
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


def _backlog_markdown(text):
    """backlog.md の `## PBI-xxx: タイトル` 節を、優先度順（並び順）の PBI の一覧にする。"""
    items = []
    for m in re.finditer(r"^## (\S+?):\s*(.+?)\n(.*?)(?=^## |\Z)", text or "", re.M | re.S):
        body = m.group(3)
        items.append({
            "id": m.group(1), "title": m.group(2).strip(),
            "status": _field(body, "status") or "new",
            "points": _field(body, "points") or "",
            "ui": _field(body, "ui") or "",
            "url": None,
        })
    return items


class ScrumState:
    def __init__(self, project):
        self.project = Path(project).resolve()
        self.root = self.project / ".scrum"
        self._sig = None
        self.snapshot = None

    def _signature(self):
        if not self.root.is_dir():
            return ()
        return tuple(sorted((str(p), p.stat().st_mtime_ns)
                            for p in self.root.rglob("*") if p.suffix in (".md", ".json")))

    def poll(self):
        """内容が変わっていれば新しいスナップショットを返す。変わっていなければ None。"""
        sig = self._signature()
        if sig == self._sig:
            return None
        self._sig = sig
        self.snapshot = self._build()
        return self.snapshot

    def _git(self, *args):
        try:
            out = subprocess.run(["git", "-C", str(self.project), *args],
                                 capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            return ""
        return out.stdout if out.returncode == 0 else ""

    def _latest_sprint(self, config, numbers):
        n = _field(config, "sprint")
        if n and n.isdigit() and int(n) in numbers:
            return int(n)
        return max(numbers) if numbers else None

    def _sprint(self, number, path):
        text = _read(path)
        phase = _field(text, "phase")
        rel = str(path.relative_to(self.project))
        # 開始・終了の日時が書かれていない古いスプリントは、git の履歴で補う
        def iso(value):
            # 注記が後ろに付いていても、日時の部分だけを取り出す
            m = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)", value or "")
            return m.group(1) if m else None
        closed = iso(_field(text, "closed"))
        if not closed and phase == "closed":
            closed = self._git("log", "-1", "--format=%cI", "--", rel).strip() or None
        started = iso(_field(text, "started"))
        if not started:
            started = self._git("log", "--reverse", "--format=%cI", "--", rel).split("\n")[0] or None
        return {
            "number": number, "phase": phase, "goal": _field(text, "goal"),
            "started": started, "closed": closed,
            "pbis": _table(_section(text, "## 対象 PBI")),
            "agent_log": _table(_section(text, "## Agent 実行ログ")),
            "retro": _section(text, "## レトロスペクティブ") or _section(text, "## KPT"),
            "markdown": text,
        }

    def _team_at(self, when):
        """その時点の .scrum/team.md を返す。まだ無ければ None。"""
        if not when:
            return _read(self.root / "team.md")
        commit = self._git("log", "-1", f"--before={when}", "--format=%H", "--", ".scrum/team.md").strip()
        return self._git("show", f"{commit}:.scrum/team.md") if commit else None

    def _backlog(self, backend):
        if backend in (None, "", "markdown"):
            return _backlog_markdown(_read(self.root / "backlog.md")), None
        # Markdown 以外は、スクラムマスターが書き出した写しを読む
        try:
            snap = json.loads(_read(self.root / "backlog-snapshot.json") or "")
        except ValueError:
            return [], None
        return snap.get("items") or [], snap.get("updated_at")

    def _build(self):
        if not self.root.is_dir():
            return {"initialized": False}
        config = _read(self.root / "config.md")
        backend = _field(config, "backend")
        paths = {int(m.group(1)): p for p in (self.root / "sprints").glob("sprint-*.md")
                 if (m := re.match(r"sprint-(\d+)\.md$", p.name))}
        sprints = [self._sprint(n, paths[n]) for n in sorted(paths, reverse=True)]
        latest = self._latest_sprint(config, set(paths))
        done_in = {}
        for sp in sprints:
            for row in sp["pbis"]:
                pbi = row.get("PBI")
                if pbi and row.get("状態") == "accepted":
                    done_in.setdefault(pbi, sp["number"])
            team = self._team_at(sp["closed"] if sp["phase"] == "closed" else None)
            sp["team"] = _table(team) if team else None
        items, snapshot_at = self._backlog(backend)
        for item in items:
            item["sprint"] = done_in.get(item["id"])
        metrics = _read(self.root / "metrics.md")
        return {
            "initialized": True,
            "backend": backend,
            "capacity": _field(config, "capacity"),
            "base_branch": _field(config, "base_branch"),
            "github_repo": _field(config, "github.repo"),
            "jira_site": _field(config, "jira.site"),
            "latest": latest,
            "sprint": next((s for s in sprints if s["number"] == latest), None),
            "sprints": sprints,
            "backlog": items,
            "backlog_snapshot_at": snapshot_at,
            "agreements": _read(self.root / "agreements.md"),
            "metrics": metrics,
            "metrics_rows": _table(metrics),
            "inception_deck": _read(self.root / "inception-deck.md"),
            "plugin_feedback": _read(self.root / "plugin-feedback.md"),
            "team": _table(_read(self.root / "team.md")),
            "team_markdown": _read(self.root / "team.md"),
        }
