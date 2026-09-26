"use strict";

const TOKEN = new URLSearchParams(location.search).get("t") || "";
const ROLES = ["sm", "designer", "developer", "code-reviewer", "security-reviewer"];
const ROLE_LABEL = {
  sm: "スクラムマスター", designer: "designer", developer: "developer",
  "code-reviewer": "code-reviewer", "security-reviewer": "security-reviewer",
};
const TABS = [
  ["sprint", "スプリント"], ["retro", "振り返り"], ["agreements", "チーム合意"],
  ["metrics", "指標"], ["deck", "デッキ"], ["feedback", "改善提案"], ["denials", "拒否された操作"],
];
const REQUEST_LINES = 8;

const S = {
  project: "", session: null, agents: new Map(), msgs: new Map(), order: [],
  scrum: null, runner: null, filter: "all", expanded: new Set(), collapsed: new Set(),
  openedFull: new Set(), tab: "sprint", draft: "",
};

// ---------- 通信 ----------
function api(path, body) {
  return fetch(`${path}?t=${encodeURIComponent(TOKEN)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  });
}

function connect() {
  const es = new EventSource(`/api/events?t=${encodeURIComponent(TOKEN)}`);
  es.onmessage = (e) => { handle(JSON.parse(e.data)); schedule(); };
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}

function reset() {
  S.agents.clear(); S.msgs.clear(); S.order = []; S.expanded.clear(); S.collapsed.clear();
}

function handle(ev) {
  switch (ev.type) {
    case "project": S.project = ev.path; reset(); break;
    case "reset": reset(); break;
    case "session": S.session = ev.session; break;
    case "agent": {
      if (!S.agents.has(ev.agent_id)) S.order.push(ev.agent_id);
      S.agents.set(ev.agent_id, ev);
      break;
    }
    case "msg": {
      const key = ev.agent_id;
      if (!S.msgs.has(key)) S.msgs.set(key, []);
      S.msgs.get(key).push(ev);
      break;
    }
    case "state": S.scrum = ev.state; break;
    case "runner": S.runner = ev.runner; break;
  }
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}

// ---------- Markdown（見出し・箇条書き・表・コード・引用のみ） ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
function md(text) {
  const lines = String(text ?? "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const n = Math.min(h[1].length, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^[\s|:-]+$/.test(r)));
      const [head, ...rest] = body;
      out.push("<table><thead><tr>" + cells(head).map((c) => `<th>${inline(c)}</th>`).join("") +
        "</tr></thead><tbody>" + rest.map((r) => "<tr>" + cells(r).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>");
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${md(buf.join("\n"))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && buf.length))) buf.push(lines[i++]);
      out.push(list(buf));
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*\||\s*>|\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
  }
  return out.join("");
}
function list(lines) {
  const indent = (l) => l.match(/^\s*/)[0].length;
  const base = indent(lines[0]);
  const ordered = /^\s*\d+\./.test(lines[0]);
  const items = [];
  for (const l of lines) {
    if (indent(l) <= base && /^\s*([-*]|\d+\.)\s+/.test(l)) items.push({ text: l.replace(/^\s*([-*]|\d+\.)\s+/, ""), children: [] });
    else if (items.length) items[items.length - 1].children.push(l);
  }
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>` + items.map((it) => `<li>${inline(it.text)}${it.children.length ? list(it.children) : ""}</li>`).join("") + `</${tag}>`;
}

// ---------- 描画 ----------
const $ = (id) => document.getElementById(id);
function time(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d) ? "" : d.toLocaleTimeString("ja-JP", { hour12: false });
}
function roleColor(role) {
  return `var(--role-${ROLES.includes(role) ? role : "general"})`;
}
function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 40; }

function msgHtml(m, key) {
  const t = `<span class="meta">${time(m.ts)}</span>`;
  if (m.kind === "tool") return `<div class="msg tool" title="${esc(m.text)}">${time(m.ts)} ${esc(m.text)}</div>`;
  if (m.kind === "error") return `<div class="msg notice" style="color:var(--warn)">${time(m.ts)} ⚠ ${esc(m.text)}</div>`;
  if (m.kind === "notice") return `<div class="msg notice">${time(m.ts)} ✓ ${esc(m.text)}</div>`;
  if (m.kind === "po") return `<div class="msg po">${t} <b>PO</b><div class="bubble">${inline(m.text)}</div></div>`;
  if (m.kind === "request") {
    const lines = m.text.split("\n");
    const full = S.openedFull.has(key) || lines.length <= REQUEST_LINES;
    const shown = full ? m.text : lines.slice(0, REQUEST_LINES).join("\n");
    const more = full ? "" : `<button class="more" data-full="${esc(key)}">…残り${lines.length - REQUEST_LINES}行を表示</button>`;
    return `<div class="msg request">${t} <b>依頼</b><div class="bubble md">${md(shown)}${more}</div></div>`;
  }
  return `<div class="msg">${t}<div class="md">${md(m.text)}</div></div>`;
}

function renderHeader() {
  const sc = S.scrum;
  let html = S.project ? `<span>${esc(S.project.split("/").pop())}</span>` : "";
  if (sc && sc.initialized && sc.sprint && sc.sprint.number != null) {
    const sp = sc.sprint;
    html += ` · <b>Sprint ${sp.number}</b> · ${esc(sp.phase || "")}${sp.goal ? " · " + esc(sp.goal) : ""}`;
  } else if (sc && !sc.initialized) {
    html += " · .scrum 未初期化";
  }
  $("sprint-summary").innerHTML = html;
  $("sprint-summary").title = (sc && sc.sprint && sc.sprint.goal) || "";
  const r = S.runner || { status: "idle" };
  const label = { idle: "未起動", waiting: "PO の入力待ち", running: "処理中", exited: "終了" }[r.status] || r.status;
  const cost = r.cost != null ? `<span class="hint">累計 $${Number(r.cost).toFixed(2)}</span>` : "";
  $("runner-summary").innerHTML = `${cost}<span class="pill ${r.status}"><span class="dot"></span>${label}</span>`;
}

function renderSM() {
  const feed = $("sm-feed");
  const stick = nearBottom(feed);
  let list = S.msgs.get("main") || [];
  const r = S.runner || {};
  const busy = [...S.agents.values()].some((a) => a.status === "running");
  const ask = r.status === "waiting" && r.session_id && !r.error && !busy ? lastSmText() : null;
  if (ask && list.length && list[list.length - 1].text === ask) list = list.slice(0, -1);
  feed.innerHTML = list.length ? list.map((m, k) => msgHtml(m, `main:${k}`)).join("")
    : `<p class="empty">会話はまだ無い。下の欄からスプリントを始められる。</p>`;
  if (stick) feed.scrollTop = feed.scrollHeight;
}

function lastSmText() {
  const list = S.msgs.get("main") || [];
  for (let k = list.length - 1; k >= 0; k--) {
    if (list[k].kind === "po" || list[k].kind === "error") return null;
    if (list[k].kind === "text") return list[k].text;
  }
  return null;
}

let composerKey = null;
function renderComposer() {
  const el = $("composer");
  const r = S.runner || { status: "idle" };
  const busy = [...S.agents.values()].filter((a) => a.status === "running").length;
  const key = JSON.stringify([r.status, r.session_id, r.error, S.session, lastSmText(), busy]);
  if (key === composerKey) return;
  composerKey = key;
  const active = document.activeElement;
  if (active && active.id === "po-input") S.draft = active.value;
  let html = "";
  if (r.status === "waiting" && r.session_id) {
    const list = S.msgs.get("main") || [];
    const last = [...list].reverse().find((m) => m.kind !== "tool");
    const error = r.error || (last && last.kind === "error" ? last.text : null);
    const ask = error || busy ? null : lastSmText();
    if (busy && !error) html += `<div class="row" style="margin:0 0 10px"><span class="pill running"><span class="dot"></span>Agent が作業中（${busy}件）。完了するとスクラムマスターが続きを進める</span></div>`;
    if (error) html += `<div class="ask"><div class="ask-label">エラーで止まった</div><p>${esc(error)}</p><p class="hint">原因を解消してから「続けて」などを送信すると再開する。</p></div>`;
    if (ask) html += `<div class="ask"><div class="ask-label">PO への依頼</div><div class="md">${md(ask)}</div></div>`;
    html += `<textarea id="po-input" placeholder="回答を入力（Ctrl+Enter で送信）">${esc(S.draft)}</textarea>
      <div class="row">
        <button class="btn" data-quick="承認する">承認する</button>
        <button class="btn" data-quick="すべて推奨どおり">すべて推奨どおり</button>
        <div class="spacer"></div>
        <button class="btn" data-action="stop">停止</button>
        <button class="btn primary" data-action="send">送信</button>
      </div>`;
  } else if (r.status === "running") {
    html += `<div class="row"><span class="pill running"><span class="dot"></span>スクラムマスターが作業中</span>
      <div class="spacer"></div><button class="btn" data-action="stop">停止</button></div>`;
  } else {
    const last = S.session ? lastSmText() : null;
    if (last) html += `<div class="ask" style="border-color:var(--line);background:var(--panel-2)"><div class="ask-label" style="color:var(--muted)">スクラムマスターの最後の発言</div><div class="md">${md(last)}</div></div>`;
    const draft = S.draft || "/scrum-team:run-sprint";
    const note = S.session ? `<span class="hint">表示中のセッション：${esc(S.session.slice(0, 8))}</span>` : "";
    html += `<textarea id="po-input">${esc(draft)}</textarea>
      <div class="row">
        <label class="hint"><input type="checkbox" id="resume" ${S.session ? "checked" : ""}> 表示中のセッションを続ける</label>
        ${note}
        <div class="spacer"></div>
        <button class="btn primary" data-action="start">開始</button>
      </div>`;
    if (r.error) html += `<p class="hint">前回の終了：${esc(r.error)}</p>`;
  }
  el.innerHTML = html;
  const input = $("po-input");
  if (input && active && active.id === "po-input") {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function renderFilter() {
  const roles = ["all", ...new Set(S.order.map((id) => S.agents.get(id).role))];
  $("role-filter").innerHTML = roles.map((r) =>
    `<button class="chip ${S.filter === r ? "on" : ""}" data-filter="${esc(r)}">${r === "all" ? "すべて" : esc(ROLE_LABEL[r] || r)}</button>`).join("");
}

function firstTs(id) {
  const list = S.msgs.get(id);
  return (list && list[0] && list[0].ts) || "";
}

function renderAgents() {
  const box = $("agents");
  const keepScroll = box.scrollTop;
  const ids = [...S.order].sort((a, b) => firstTs(a).localeCompare(firstTs(b)))
    .filter((id) => S.filter === "all" || S.agents.get(id).role === S.filter);
  if (!ids.length) { box.innerHTML = `<p class="empty">まだ Agent は起動していない。</p>`; return; }
  box.innerHTML = ids.map((id) => {
    const a = S.agents.get(id);
    const list = S.msgs.get(id) || [];
    const open = S.expanded.has(id) || (a.status === "running" && !S.collapsed.has(id));
    const tools = list.filter((m) => m.kind === "tool").length;
    const status = a.status === "running" ? `<span class="pill running"><span class="dot"></span>実行中</span>`
      : `<span class="pill done"><span class="dot"></span>完了</span>`;
    const body = open ? `<div class="card-body" id="body-${esc(id)}">${list.map((m, k) => msgHtml(m, `${id}:${k}`)).join("") || '<p class="empty">出力なし</p>'}</div>` : "";
    return `<div class="card" style="--role:${roleColor(a.role)}">
      <div class="card-head" data-toggle="${esc(id)}">
        <span class="role">${esc(ROLE_LABEL[a.role] || a.role)}</span>
        <span class="card-title" title="${esc(a.description)}">${esc(a.description)}</span>
        <span class="hint">操作 ${tools}</span>${status}
      </div>${body}</div>`;
  }).join("");
  box.scrollTop = keepScroll;
  for (const id of ids) {
    const b = document.getElementById(`body-${id}`);
    if (b && S.agents.get(id).status === "running") b.scrollTop = b.scrollHeight;
  }
}

function table(rows) {
  if (!rows || !rows.length) return `<p class="empty">なし</p>`;
  const cols = Object.keys(rows[0]);
  return `<table class="grid"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((r) => `<tr>${cols.map((c) => `<td>${inline(r[c])}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
}

function allowRule(d) {
  if (d.tool === "Bash") {
    const word = String((d.input && d.input.command) || "").trim().split(/\s+/)[0] || "";
    return `Bash(${word}:*)`;
  }
  const path = d.input && d.input.file_path;
  if (path) return `${d.tool}(${path.replace(/\/[^/]*$/, "")}/**)`;
  return d.tool;
}

function renderTabs() {
  const denials = (S.runner && S.runner.denials) || [];
  $("tabs").innerHTML = TABS.map(([key, label]) => {
    const badge = key === "denials" && denials.length ? `<span class="badge">${denials.length}</span>` : "";
    return `<button class="tab ${S.tab === key ? "on" : ""}" data-tab="${key}">${label}${badge}</button>`;
  }).join("");
  const sc = S.scrum;
  const body = $("tab-body");
  const keep = body.scrollTop;
  const mdOr = (text, empty) => text ? `<div class="md">${md(text)}</div>` : `<p class="empty">${empty}</p>`;
  let html = "";
  if (!sc || !sc.initialized) {
    html = `<p class="empty">.scrum/ がまだ無い。スプリントを始めると作られる。</p>`;
  } else if (S.tab === "sprint") {
    const sp = sc.sprint || {};
    const counts = Object.entries(sc.backlog_counts || {}).map(([k, v]) => `${esc(k)} ${v}`).join(" / ");
    html = `<div class="md"><h3>Sprint ${esc(sp.number ?? "—")}（${esc(sp.phase || "—")}）</h3><p>${inline(sp.goal || "")}</p></div>
      <h2>対象 PBI</h2>${table(sp.pbis)}
      <h2>Agent 実行ログ</h2>${table(sp.agent_log)}
      <p class="hint">バックログ：${counts || "—"}　容量：${esc(sc.capacity || "—")}　置き場：${esc(sc.backend || "—")}</p>`;
  } else if (S.tab === "retro") {
    html = mdOr(sc.sprint && sc.sprint.retro, "このスプリントの振り返りはまだ無い。");
  } else if (S.tab === "agreements") {
    html = mdOr(sc.agreements, "チーム合意はまだ無い。");
  } else if (S.tab === "metrics") {
    html = mdOr(sc.metrics, "指標はまだ無い。");
  } else if (S.tab === "deck") {
    html = mdOr(sc.inception_deck, "インセプションデッキはまだ無い。");
  } else if (S.tab === "feedback") {
    html = mdOr(sc.plugin_feedback, "plugin への改善提案はまだ無い。");
  } else if (S.tab === "denials") {
    html = denials.length ? `<p class="hint">許可されていないため拒否された操作。必要なら対象プロジェクトの .claude/settings.json の permissions.allow に加える。</p>` +
      table(denials.map((d) => ({ ツール: d.tool, 内容: `\`${String((d.input && (d.input.command || d.input.file_path)) || "").slice(0, 160)}\``, 許可ルールの例: `\`${allowRule(d)}\`` })))
      : `<p class="empty">拒否された操作は無い。</p>`;
  }
  body.innerHTML = html;
  body.scrollTop = keep;
}

function render() {
  renderHeader();
  renderSM();
  renderComposer();
  renderFilter();
  renderAgents();
  renderTabs();
}

// ---------- 操作 ----------
function send(text) {
  text = (text || "").trim();
  if (!text) return;
  S.draft = "";
  api("/api/message", { text }).catch((e) => alertInline(e.message));
}
function alertInline(message) {
  const el = $("composer");
  el.insertAdjacentHTML("beforeend", `<p class="hint" style="color:var(--warn)">${esc(message)}</p>`);
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action],[data-quick],[data-toggle],[data-filter],[data-tab],[data-full]");
  if (!t) return;
  if (t.dataset.full) { S.openedFull.add(t.dataset.full); schedule(); return; }
  if (t.dataset.tab) { S.tab = t.dataset.tab; schedule(); return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; schedule(); return; }
  if (t.dataset.toggle) {
    const id = t.dataset.toggle;
    const a = S.agents.get(id);
    const open = S.expanded.has(id) || (a.status === "running" && !S.collapsed.has(id));
    if (open) { S.expanded.delete(id); S.collapsed.add(id); } else { S.expanded.add(id); S.collapsed.delete(id); }
    schedule();
    return;
  }
  if (t.dataset.quick) { send(t.dataset.quick); return; }
  const input = $("po-input");
  if (t.dataset.action === "send") send(input && input.value);
  if (t.dataset.action === "stop") api("/api/session/stop").catch((err) => alertInline(err.message));
  if (t.dataset.action === "start") {
    const resume = $("resume") && $("resume").checked;
    const message = (input && input.value.trim()) || "";
    S.draft = "";
    api("/api/session/start", { resume, message }).catch((err) => alertInline(err.message));
  }
});
document.addEventListener("input", (e) => { if (e.target.id === "po-input") S.draft = e.target.value; });
document.addEventListener("keydown", (e) => {
  if (e.target.id === "po-input" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const r = S.runner || {};
    if (r.status === "waiting" && r.session_id) send(e.target.value);
  }
});

connect();
