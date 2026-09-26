"""scrum-dash のローカルサーバ。閲覧用の SSE と、PO の入力を受ける API を提供する。"""

import argparse
import json
import mimetypes
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
from transcripts import TranscriptWatcher

STATIC = Path(__file__).parent / "static"


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
        self.runner = Runner(self.project, plugin_dir, on_change=self._on_runner)
        self._on_runner(self.runner.state())

    def _on_runner(self, state):
        with self.cond:
            self.runner_state = state
            self.runner_version += 1
            self.cond.notify_all()

    def loop(self):
        while True:
            events = self.watcher.poll()
            snapshot = self.scrum.poll()
            if events or snapshot is not None:
                with self.cond:
                    for ev in events:
                        if ev["type"] == "session":
                            self.epoch += 1
                            self.events = []
                        self.events.append(ev)
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
                resume = self.hub.watcher.session if body.get("resume") else None
                runner.start(resume=resume)
                if body.get("message"):
                    runner.send(body["message"])
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
        hub.runner.stop()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    server.serve_forever()


if __name__ == "__main__":
    main()
