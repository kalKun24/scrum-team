"""Claude Code の会話ログ（jsonl）を追従し、表示用のイベントに変換する。"""

import json
import os
import re
from pathlib import Path

PROJECTS_DIR = Path.home() / ".claude" / "projects"


def encode_project_path(path):
    return re.sub(r"[^A-Za-z0-9-]", "-", str(path))


def find_transcript_dir(project):
    project = Path(project).resolve()
    candidate = PROJECTS_DIR / encode_project_path(project)
    if candidate.is_dir():
        return candidate
    for d in PROJECTS_DIR.glob("*"):
        for f in sorted(d.glob("*.jsonl"))[:3]:
            try:
                with f.open() as fh:
                    for line in fh:
                        cwd = json.loads(line).get("cwd")
                        if cwd:
                            if Path(cwd).resolve() == project:
                                return d
                            break
            except (OSError, ValueError):
                continue
    return candidate


def summarize_tool(name, inp):
    inp = inp or {}
    if name in ("Read", "Write", "Edit", "NotebookEdit"):
        return f"{name} {Path(inp.get('file_path', '')).name}"
    if name == "Bash":
        cmd = (inp.get("command") or "").strip().splitlines()
        return f"Bash {cmd[0][:160] if cmd else ''}"
    if name in ("Grep", "Glob"):
        return f"{name} {inp.get('pattern', '')[:120]}"
    if name == "Agent":
        role = (inp.get("subagent_type") or "general").split(":")[-1]
        return f"→ {role}：{inp.get('description', '')}"
    if name == "Skill":
        return f"Skill {inp.get('skill', '')}"
    if name == "SendMessage":
        return f"SendMessage → {inp.get('to', '')}"
    return name


def _tag(text, tag):
    m = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.S)
    return m.group(1).strip() if m else ""


class _Tail:
    """jsonl を読んだ位置から追う。改行で終わっていない最終行は次回に回す。"""

    def __init__(self, path):
        self.path = path
        self.offset = 0

    def read(self):
        try:
            size = self.path.stat().st_size
        except OSError:
            return []
        if size <= self.offset:
            return []
        with self.path.open("rb") as fh:
            fh.seek(self.offset)
            chunk = fh.read(size - self.offset)
        end = chunk.rfind(b"\n")
        if end < 0:
            return []
        self.offset += end + 1
        records = []
        for line in chunk[: end + 1].splitlines():
            try:
                records.append(json.loads(line))
            except ValueError:
                continue
        return records


class TranscriptWatcher:
    def __init__(self, project, session=None):
        self.dir = find_transcript_dir(project)
        self.fixed_session = session
        self.session = None
        self.main = None
        self.agents = {}
        self.tails = {}
        self.agent_tools = {}
        self.done_at = {}

    def _latest_session(self):
        if self.fixed_session:
            return self.fixed_session
        files = list(self.dir.glob("*.jsonl")) if self.dir.is_dir() else []
        if not files:
            return None
        return max(files, key=lambda f: f.stat().st_mtime).stem

    def poll(self):
        events = []
        latest = self._latest_session()
        if latest and latest != self.session:
            self.session = latest
            self.main = _Tail(self.dir / f"{latest}.jsonl")
            self.agents, self.tails = {}, {}
            self.agent_tools, self.done_at = {}, {}
            events.append({"type": "session", "session": latest})
        if not self.main:
            return events
        for rec in self.main.read():
            events += self._main_record(rec)
        sub = self.dir / self.session / "subagents"
        if sub.is_dir():
            for meta_path in sorted(sub.glob("agent-*.meta.json")):
                agent_id = meta_path.name[len("agent-"):-len(".meta.json")]
                if agent_id not in self.agents:
                    events += self._register_agent(agent_id, meta_path)
            for agent_id, tail in self.tails.items():
                for rec in tail.read():
                    events += self._agent_record(agent_id, rec)
                    done_ts = self.done_at.get(agent_id)
                    if (self.agents[agent_id]["status"] == "done" and done_ts
                            and (rec.get("timestamp") or "") > done_ts):
                        events.append(self._set_status(agent_id, "running"))
        return events

    def _register_agent(self, agent_id, meta_path):
        try:
            meta = json.loads(meta_path.read_text())
        except (OSError, ValueError):
            return []
        tool_id = meta.get("toolUseId")
        info = {
            "agent_id": agent_id,
            "role": (meta.get("agentType") or "general").split(":")[-1],
            "description": meta.get("description", ""),
            "background": meta.get("requestShape") == "background",
            "tool_id": tool_id,
            "worktree": meta.get("worktreePath"),
            "status": "running",
        }
        self.agents[agent_id] = info
        self.tails[agent_id] = _Tail(meta_path.with_name(f"agent-{agent_id}.jsonl"))
        done_ts = self.done_at.get(agent_id) or (
            None if info["background"] else self.done_at.get(("tool", tool_id)))
        if done_ts:
            self.done_at[agent_id] = done_ts
            info["status"] = "done"
        return [{"type": "agent", **info}]

    def _set_status(self, agent_id, status, ts=None):
        self.agents[agent_id]["status"] = status
        if status == "done":
            self.done_at[agent_id] = ts or self.done_at.get(agent_id)
        return {"type": "agent", **self.agents[agent_id]}

    def _msg(self, agent_id, role, kind, text, rec):
        return {"type": "msg", "agent_id": agent_id, "role": role, "kind": kind,
                "text": text, "ts": rec.get("timestamp")}

    def _assistant_blocks(self, agent_id, role, rec):
        if rec.get("isApiErrorMessage"):
            text = " ".join(b.get("text", "") for b in rec.get("message", {}).get("content") or [])
            return [self._msg(agent_id, role, "error", text.strip() or rec.get("error", ""), rec)]
        out = []
        for block in rec.get("message", {}).get("content") or []:
            if block.get("type") == "text" and block.get("text", "").strip():
                out.append(self._msg(agent_id, role, "text", block["text"], rec))
            elif block.get("type") == "tool_use":
                if agent_id == "main" and block.get("name") == "Agent":
                    self.agent_tools[block.get("id")] = block.get("input", {})
                out.append(self._msg(agent_id, role, "tool",
                                     summarize_tool(block.get("name"), block.get("input")), rec))
        return out

    def _main_record(self, rec):
        if rec.get("type") == "assistant":
            return self._assistant_blocks("main", "sm", rec)
        if rec.get("type") == "attachment":
            # ターンの途中に届いた完了通知や PO の入力は queued_command として記録される
            att = rec.get("attachment") or {}
            prompt = att.get("prompt")
            if att.get("type") != "queued_command" or not isinstance(prompt, str):
                return []
            if "<task-notification>" in prompt:
                return self._notification(prompt, rec)
            return [self._msg("main", "sm", "po", prompt, rec)]
        if rec.get("type") != "user" or rec.get("isMeta"):
            return []
        content = rec.get("message", {}).get("content")
        if isinstance(content, str):
            if "<task-notification>" in content:
                return self._notification(content, rec)
            if "<command-name>" in content:
                cmd = _tag(content, "command-name")
                args = _tag(content, "command-args")
                return [self._msg("main", "sm", "po", f"{cmd} {args}".strip(), rec)]
            return [self._msg("main", "sm", "po", content, rec)]
        events = []
        for block in content or []:
            if block.get("type") == "tool_result":
                tool_id = block.get("tool_use_id")
                self.done_at[("tool", tool_id)] = rec.get("timestamp")
                for a in self.agents.values():
                    if a["tool_id"] == tool_id and not a["background"]:
                        events.append(self._set_status(a["agent_id"], "done", rec.get("timestamp")))
            elif block.get("type") == "text" and block.get("text", "").strip():
                events.append(self._msg("main", "sm", "po", block["text"], rec))
        return events

    def _notification(self, content, rec):
        events = []
        # 複数の完了通知が1つのメッセージにまとまって届くことがある
        for block in re.findall(r"<task-notification>(.*?)</task-notification>", content, re.S):
            agent_id = _tag(block, "task-id")
            summary = _tag(block, "summary") or f"{agent_id} {_tag(block, 'status')}"
            events.append(self._msg("main", "sm", "notice", summary, rec))
            if agent_id in self.agents:
                events.append(self._set_status(agent_id, "done", rec.get("timestamp")))
            else:
                self.done_at[agent_id] = rec.get("timestamp")
        return events

    def _agent_record(self, agent_id, rec):
        role = self.agents[agent_id]["role"]
        if rec.get("type") == "assistant":
            return self._assistant_blocks(agent_id, role, rec)
        if rec.get("type") != "user" or rec.get("isMeta"):
            return []
        content = rec.get("message", {}).get("content")
        if isinstance(content, str):
            return [self._msg(agent_id, role, "request", content, rec)]
        return [self._msg(agent_id, role, "request", b["text"], rec)
                for b in content or [] if b.get("type") == "text" and b.get("text", "").strip()]


_session_cache = {}


def _session_summary(path):
    """セッション一覧用の要約。ファイルが変わっていなければキャッシュを返す。"""
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    if key in _session_cache:
        return _session_cache[key]
    info = {"id": path.stem, "updated": stat.st_mtime, "started": None,
            "first_prompt": None, "last_prompt": None, "cost": None, "agents": 0}
    with path.open() as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if not info["started"] and rec.get("timestamp"):
                info["started"] = rec["timestamp"]
            t = rec.get("type")
            if t == "cost-state":
                info["cost"] = rec.get("totalCostUSD")
            elif t == "last-prompt":
                info["last_prompt"] = rec.get("lastPrompt")
            elif (t == "user" and not rec.get("isMeta") and not info["first_prompt"]
                  and isinstance(rec.get("message", {}).get("content"), str)):
                content = rec["message"]["content"]
                if "<task-notification>" not in content:
                    cmd = _tag(content, "command-name")
                    info["first_prompt"] = (f"{cmd} {_tag(content, 'command-args')}".strip()
                                            if cmd else content)[:200]
    sub = path.with_suffix("") / "subagents"
    if sub.is_dir():
        info["agents"] = len(list(sub.glob("agent-*.meta.json")))
    _session_cache[key] = info
    return info


def list_sessions(directory):
    if not directory.is_dir():
        return []
    sessions = [_session_summary(p) for p in directory.glob("*.jsonl")]
    return sorted(sessions, key=lambda s: s["updated"], reverse=True)


def read_session(project, session_id):
    watcher = TranscriptWatcher(project, session=session_id)
    if not (watcher.dir / f"{session_id}.jsonl").is_file():
        return None
    return watcher.poll()
