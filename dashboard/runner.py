"""PO の入力を headless の claude に渡し、同じセッションを続ける。"""

import json
import subprocess
import threading
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent


class Runner:
    def __init__(self, project, plugin_dir=None, on_change=None):
        self.project = Path(project).resolve()
        self.plugin_dir = plugin_dir
        self.on_change = on_change or (lambda state: None)
        self.proc = None
        self.lock = threading.Lock()
        self.status = "idle"
        self.session_id = None
        self.cost = None
        self.denials = []
        self.error = None

    def state(self):
        return {"status": self.status, "session_id": self.session_id, "cost": self.cost,
                "denials": self.denials, "error": self.error}

    def _set(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)
        self.on_change(self.state())

    def start(self, resume=None):
        with self.lock:
            if self.proc and self.proc.poll() is None:
                raise RuntimeError("すでに起動している")
            cmd = ["claude", "-p", "--input-format", "stream-json",
                   "--output-format", "stream-json", "--verbose",
                   "--permission-mode", "acceptEdits", "--permission-prompts", "none"]
            if resume:
                cmd += ["--resume", resume]
            allowed = self._allowed_tools()
            if allowed:
                cmd += ["--allowedTools", *allowed]
            if self.plugin_dir:
                cmd += ["--plugin-dir", str(self.plugin_dir)]
            # Skill の参照ファイルは作業ディレクトリの外にあり、確認なしでは読めないため追加する
            cmd += ["--add-dir", str(PLUGIN_ROOT)]
            log_dir = Path.home() / ".cache" / "scrum-dash"
            log_dir.mkdir(parents=True, exist_ok=True)
            log = open(log_dir / f"{self.project.name}.log", "a", encoding="utf-8")
            self.proc = subprocess.Popen(cmd, cwd=self.project, stdin=subprocess.PIPE,
                                         stdout=subprocess.PIPE, stderr=log, text=True, bufsize=1)
            self.denials = []
            self._set(status="waiting", session_id=resume, error=None)
            threading.Thread(target=self._read, daemon=True).start()

    def _allowed_tools(self):
        """対象プロジェクトの許可リストを返す。

        settings.json の許可は worktree で動く Agent に効かないことがあったため、
        起動時の --allowedTools としても渡す。
        """
        allowed = []
        for name in ("settings.json", "settings.local.json"):
            try:
                data = json.loads((self.project / ".claude" / name).read_text())
            except (OSError, ValueError):
                continue
            for rule in data.get("permissions", {}).get("allow", []):
                if rule not in allowed:
                    allowed.append(rule)
        return allowed

    def send(self, text):
        with self.lock:
            if not self.proc or self.proc.poll() is not None:
                raise RuntimeError("起動していない")
            if self.status != "waiting":
                raise RuntimeError("処理中である")
            msg = {"type": "user", "message": {"role": "user", "content": text}}
            self.proc.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
            self.proc.stdin.flush()
            self._set(status="running")

    def stop(self):
        with self.lock:
            if self.proc and self.proc.poll() is None:
                self.proc.stdin.close()
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.proc.kill()

    def _read(self):
        for line in self.proc.stdout:
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("type") == "system" and ev.get("subtype") == "init":
                self._set(session_id=ev.get("session_id"))
            elif ev.get("type") == "assistant" and self.status == "waiting":
                # Agent の完了通知などで、PO の入力なしに次のターンが始まった
                self._set(status="running")
            elif ev.get("type") == "result":
                denials = self.denials + [
                    {"tool": d.get("tool_name"), "input": d.get("tool_input")}
                    for d in ev.get("permission_denials") or []]
                failed = ev.get("is_error") or ev.get("subtype") != "success"
                self._set(status="waiting", cost=ev.get("total_cost_usd"), denials=denials,
                          error=(ev.get("result") or ev.get("subtype")) if failed else None)
        code = self.proc.wait()
        self._set(status="exited", error=None if code == 0 else f"exit {code}")
