"""scrum-dash のローカルサーバ。閲覧用の SSE と、PO の入力を受ける API を提供する。"""

import argparse
import json
import mimetypes
import re
import secrets
import signal
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from runner import Runner
from scrum_state import ScrumState
from transcripts import TranscriptWatcher, encode_project_path, list_sessions, read_session

STATIC = Path(__file__).parent / "static"
STATE_DIR = Path.home() / ".local" / "state" / "scrum-dash"


def interruption_note(agents):
    lines = [f"- {a['role']}：{a['description']}（作業ディレクトリ：{a.get('worktree') or '元のリポジトリ'}）"
             for a in agents]
    return ("【ダッシュボードからの連絡】前回、次の Agent が作業中のまま中断された。\n"
            + "\n".join(lines)
            + "\nスプリントファイルと各作業ディレクトリの状態（git status・git log）を確かめ、"
              "続きから進めるかやり直すかを判断してから、作業を続けること。\n\n")


class Hub:
    """会話イベント・.scrum の状態・runner の状態を集め、SSE の購読者に知らせる。"""

    def __init__(self, project, plugin_dir):
        self.project = Path(project).resolve()
        self.cond = threading.Condition()
        self.epoch = 0
        self.events = []
        self.state = None
        self.state_version = 0
        self.runner_state = None
        self.runner_version = 0
        self.watcher = TranscriptWatcher(self.project)
        self.scrum = ScrumState(self.project)
        self.state_file = STATE_DIR / f"{encode_project_path(self.project)}.json"
        saved = self._load()
        self.interrupted = saved.get("interrupted") or saved.get("running_agents") or []
        self.abandoned = set(saved.get("abandoned") or []) | {a["agent_id"] for a in self.interrupted}
        self.running_agents = []
        self.runner = Runner(self.project, plugin_dir, on_change=self._on_runner)
        self.runner.session_id = saved.get("session_id")
        self.runner.denials = saved.get("denials") or []
        self._on_runner(self.runner.state())

    def _load(self):
        try:
            return json.loads(self.state_file.read_text())
        except (OSError, ValueError):
            return {}

    def _save(self):
        data = {"project": str(self.project), "session_id": self.runner.session_id,
                "status": self.runner.status, "denials": self.runner.denials,
                "running_agents": self.running_agents, "interrupted": self.interrupted,
                "abandoned": sorted(self.abandoned),
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        tmp.replace(self.state_file)

    def _track_agents(self):
        """runner が操作しているセッションで、実行中の Agent を記録する。"""
        if self.watcher.session != self.runner.session_id:
            return
        self.running_agents = [
            {k: a.get(k) for k in ("agent_id", "role", "description", "worktree")}
            for a in self.watcher.agents.values()
            if a["status"] == "running" and a["agent_id"] not in self.abandoned]

    def _on_runner(self, state):
        with self.cond:
            if state["status"] == "exited" and self.running_agents:
                self.interrupted = self.running_agents
                self.abandoned |= {a["agent_id"] for a in self.running_agents}
                self.running_agents = []
            self.runner_state = {**state, "interrupted": self.interrupted}
            self.runner_version += 1
            self._save()
            self.cond.notify_all()

    def start(self, resume, message):
        target = resume if isinstance(resume, str) else (
            (self.runner.session_id or self.watcher.session) if resume else None)
        note = ""
        if target and self.interrupted:
            note = interruption_note(self.interrupted)
            self.interrupted = []
            self._save()
        self.runner.start(resume=target)
        if message or note:
            self.runner.send(note + (message or "続けて。"))

    def mark_abandoned(self, events):
        """中断した Agent は完了通知が来ないため、実行中ではなく中断として表示する。"""
        for ev in events:
            if ev["type"] == "agent" and ev["agent_id"] in self.abandoned and ev["status"] == "running":
                ev["status"] = "interrupted"
        return events

    def loop(self):
        while True:
            events = self.mark_abandoned(self.watcher.poll())
            snapshot = self.scrum.poll()
            if events or snapshot is not None:
                with self.cond:
                    for ev in events:
                        if ev["type"] == "session":
                            self.epoch += 1
                            self.events = []
                        self.events.append(ev)
                    if any(ev["type"] == "agent" for ev in events):
                        self._track_agents()
                        self._save()
                    if snapshot is not None:
                        self.state = snapshot
                        self.state_version += 1
                    self.cond.notify_all()
            time.sleep(0.5)


class Handler(BaseHTTPRequestHandler):
    hub = None
    token = None
    port = None

    def log_message(self, *args):
        pass

    def _allowed(self, query):
        host = self.headers.get("Host", "")
        if host not in (f"127.0.0.1:{self.port}", f"localhost:{self.port}"):
            return False
        token = query.get("t", [None])[0] or self.headers.get("X-Token")
        return token is not None and secrets.compare_digest(token, self.token)

    def _json(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if url.path in ("/", "/index.html") or url.path.startswith("/static/"):
            return self._static(url.path)
        if not self._allowed(query):
            return self._json(403, {"error": "forbidden"})
        if url.path == "/api/events":
            return self._sse()
        if url.path == "/api/sessions":
            return self._json(200, {"sessions": list_sessions(self.hub.watcher.dir),
                                    "live": self.hub.watcher.session,
                                    "runner": self.hub.runner.session_id})
        if url.path.startswith("/api/sessions/"):
            session_id = url.path.rsplit("/", 1)[-1]
            if not re.fullmatch(r"[0-9a-f-]{8,64}", session_id):
                return self._json(400, {"error": "invalid session id"})
            events = read_session(self.hub.project, session_id)
            if events is None:
                return self._json(404, {"error": "not found"})
            return self._json(200, {"events": self.hub.mark_abandoned(events)})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if not self._allowed(parse_qs(url.query)):
            return self._json(403, {"error": "forbidden"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json(400, {"error": "invalid json"})
        runner = self.hub.runner
        try:
            if url.path == "/api/session/start":
                self.hub.start(body.get("resume"), body.get("message"))
            elif url.path == "/api/message":
                runner.send(body.get("text", ""))
            elif url.path == "/api/session/stop":
                runner.stop()
            else:
                return self._json(404, {"error": "not found"})
        except RuntimeError as e:
            return self._json(409, {"error": str(e)})
        return self._json(200, runner.state())

    def _static(self, path):
        name = "index.html" if path in ("/", "/index.html") else path[len("/static/"):]
        file = (STATIC / name).resolve()
        if STATIC.resolve() not in file.parents or not file.is_file():
            return self._json(404, {"error": "not found"})
        data = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", (mimetypes.guess_type(file.name)[0] or "text/plain")
                         + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        hub = self.hub
        epoch, index, state_v, runner_v = None, 0, 0, 0
        send = lambda obj: self.wfile.write(
            f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode())
        send({"type": "project", "path": str(hub.project)})
        try:
            while True:
                with hub.cond:
                    hub.cond.wait_for(lambda: hub.epoch != epoch or len(hub.events) > index
                                      or hub.state_version != state_v
                                      or hub.runner_version != runner_v, timeout=15)
                    if hub.epoch != epoch:
                        epoch, index = hub.epoch, 0
                        batch = [{"type": "reset"}]
                    else:
                        batch = []
                    batch += hub.events[index:]
                    index = len(hub.events)
                    if hub.state_version != state_v:
                        state_v = hub.state_version
                        batch.append({"type": "state", "state": hub.state})
                    if hub.runner_version != runner_v:
                        runner_v = hub.runner_version
                        batch.append({"type": "runner", "runner": hub.runner_state})
                if batch:
                    for obj in batch:
                        send(obj)
                else:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return


def main():
    parser = argparse.ArgumentParser(prog="scrum-dash")
    parser.add_argument("project", nargs="?", default=".")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--plugin-dir")
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    hub = Hub(args.project, args.plugin_dir)
    threading.Thread(target=hub.loop, daemon=True).start()
    Handler.hub, Handler.token, Handler.port = hub, secrets.token_urlsafe(16), args.port
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    url = f"http://127.0.0.1:{args.port}/?t={Handler.token}"
    print(f"scrum-dash: {hub.project}\n{url}", flush=True)
    if not args.no_open:
        webbrowser.open(url)
    def shutdown(*_):
        with hub.cond:
            hub._track_agents()
            if hub.running_agents and hub.runner.status in ("running", "waiting"):
                hub.interrupted, hub.running_agents = hub.running_agents, []
                hub.abandoned |= {a["agent_id"] for a in hub.interrupted}
            hub._save()
        hub.runner.stop()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    server.serve_forever()


if __name__ == "__main__":
    main()
