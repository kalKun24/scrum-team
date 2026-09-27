"use strict";

const TOKEN = new URLSearchParams(location.search).get("t") || "";
const SLOT_LABEL = {
  implement: "実装", design: "デザイン", "code-review": "コードレビュー",
  "security-review": "セキュリティレビュー", "extra-review": "専門レビュー",
};
const TABS = [
  ["sprint", "スプリント"], ["team", "チーム"], ["retro", "振り返り"], ["agreements", "チーム合意"],
  ["metrics", "指標"], ["deck", "デッキ"], ["feedback", "改善提案"], ["denials", "拒否された操作"],
];
const REQUEST_LINES = 8;

const S = {
  project: "", scrum: null, runner: null, filter: "all", expanded: new Set(), collapsed: new Set(),
  openedFull: new Set(), tab: "sprint", draft: "", sprintView: null,
  sessions: null, drawer: false,
};
function newStore() { return { session: null, agents: new Map(), msgs: new Map(), order: [] }; }
const LIVE = newStore();
let HIST = null; // 過去のセッションを見ているときの { info, store }
const V = () => (HIST ? HIST.store : LIVE);

function ingest(store, ev) {
  if (ev.type === "session") store.session = ev.session;
  if (ev.type === "agent") {
    if (!store.agents.has(ev.agent_id)) store.order.push(ev.agent_id);
    store.agents.set(ev.agent_id, ev);
  }
  if (ev.type === "msg") {
    if (!store.msgs.has(ev.agent_id)) store.msgs.set(ev.agent_id, []);
    store.msgs.get(ev.agent_id).push(ev);
  }
}

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
  Object.assign(LIVE, newStore());
}

function handle(ev) {
  switch (ev.type) {
    case "project": S.project = ev.path; reset(); break;
    case "reset": reset(); break;
    case "state": S.scrum = ev.state; break;
    case "runner": S.runner = ev.runner; break;
    default: ingest(LIVE, ev);
  }
}

function apiGet(path) {
  return fetch(`${path}?t=${encodeURIComponent(TOKEN)}`).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  });
}

async function openHistory(info) {
  if (info.id === LIVE.session) { HIST = null; S.drawer = false; schedule(); return; }
  const data = await apiGet(`/api/sessions/${info.id}`);
  const store = newStore();
  for (const ev of data.events) ingest(store, ev);
  HIST = { info, store };
  S.drawer = false;
  schedule();
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
function slotOf(role) {
  const row = ((S.scrum && S.scrum.team) || []).find((r) => r["Agent"] === role);
  return row ? row["枠"] : null;
}
function roleColor(role) {
  const slot = slotOf(role);
  return `var(--slot-${slot && SLOT_LABEL[slot] ? slot : "general"})`;
}
function roleLabel(role) {
  const slot = slotOf(role);
  return slot ? `${role}（${SLOT_LABEL[slot] || slot}）` : role;
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
  let html = HIST ? `<span class="history-banner">過去のセッション ${esc(when(HIST.info.started))}</span> ` : "";
  html += S.project ? `<span>${esc(S.project.split("/").pop())}</span>` : "";
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
  let list = V().msgs.get("main") || [];
  const r = S.runner || {};
  const busy = [...V().agents.values()].some((a) => a.status === "running");
  const ask = r.status === "waiting" && r.session_id && !r.error && !busy ? lastSmText() : null;
  if (ask && list.length && list[list.length - 1].text === ask) list = list.slice(0, -1);
  feed.innerHTML = list.length ? list.map((m, k) => msgHtml(m, `main:${k}`)).join("")
    : `<p class="empty">会話はまだ無い。下の欄からスプリントを始められる。</p>`;
  if (stick) feed.scrollTop = feed.scrollHeight;
}

function when(t) {
  if (!t) return "—";
  const d = new Date(t);
  return isNaN(d) ? "—" : d.toLocaleString("ja-JP", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function lastSmText() {
  const list = LIVE.msgs.get("main") || [];
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
  const busy = [...V().agents.values()].filter((a) => a.status === "running").length;
  const key = JSON.stringify([r.status, r.session_id, r.error, LIVE.session, lastSmText(), busy,
    HIST && HIST.info.id, (r.interrupted || []).length]);
  if (key === composerKey) return;
  composerKey = key;
  const active = document.activeElement;
  if (active && active.id === "po-input") S.draft = active.value;
  let html = "";
  if (HIST) {
    const i = HIST.info;
    const locked = r.status === "running" || r.status === "waiting";
    html += `<div class="ask" style="border-color:var(--accent);background:var(--accent-soft)">
      <div class="ask-label" style="color:var(--accent)">過去のセッションを表示中</div>
      <p>${esc(when(i.started))} 〜 ${esc(when(i.updated * 1000))}　<code>${esc(i.id.slice(0, 8))}</code></p>
      <p class="hint">最初の入力：${esc(i.first_prompt || "—")}<br>最後の入力：${esc(i.last_prompt || "—")}</p></div>
      <div class="row">
        <button class="btn" data-action="live">ライブ表示に戻る</button>
        <div class="spacer"></div>
        <button class="btn primary" data-action="resume-hist" ${locked ? "disabled" : ""}>このセッションから再開</button>
      </div>${locked ? '<p class="hint">別のセッションを操作中のため再開できない。先に停止する。</p>' : ""}`;
  } else if (r.status === "waiting" && r.session_id) {
    const list = V().msgs.get("main") || [];
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
    const target = r.session_id || LIVE.session;
    const last = target && target === LIVE.session ? lastSmText() : null;
    const interrupted = r.interrupted || [];
    if (interrupted.length) html += `<div class="ask"><div class="ask-label">作業中のまま中断した Agent がいる</div><ul>${interrupted.map((a) => `<li>${esc(a.role)}：${esc(a.description)}${a.worktree ? `<br><code>${esc(a.worktree)}</code>` : ""}</li>`).join("")}</ul><p class="hint">再開すると、この内容をスクラムマスターに伝え、続きから進めるかやり直すかを判断させる。</p></div>`;
    if (last) html += `<div class="ask" style="border-color:var(--line);background:var(--panel-2)"><div class="ask-label" style="color:var(--muted)">スクラムマスターの最後の発言</div><div class="md">${md(last)}</div></div>`;
    const draft = S.draft || (target ? "続けて。" : "/scrum-team:run-sprint");
    const note = target ? `<span class="hint">再開先：${esc(target.slice(0, 8))}${target === r.session_id ? "（前回操作したセッション）" : ""}</span>` : "";
    html += `<textarea id="po-input">${esc(draft)}</textarea>
      <div class="row">
        <label class="hint"><input type="checkbox" id="resume" ${target ? "checked" : ""}> セッションを再開する</label>
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
  const roles = ["all", ...new Set(V().order.map((id) => V().agents.get(id).role))];
  $("role-filter").innerHTML = roles.map((r) =>
    `<button class="chip ${S.filter === r ? "on" : ""}" data-filter="${esc(r)}">${r === "all" ? "すべて" : esc(roleLabel(r))}</button>`).join("");
}

function firstTs(id) {
  const list = V().msgs.get(id);
  return (list && list[0] && list[0].ts) || "";
}

function renderAgents() {
  const box = $("agents");
  const keepScroll = box.scrollTop;
  const ids = [...V().order].sort((a, b) => firstTs(a).localeCompare(firstTs(b)))
    .filter((id) => S.filter === "all" || V().agents.get(id).role === S.filter);
  if (!ids.length) { box.innerHTML = `<p class="empty">まだ Agent は起動していない。</p>`; return; }
  box.innerHTML = ids.map((id) => {
    const a = V().agents.get(id);
    const list = V().msgs.get(id) || [];
    const open = S.expanded.has(id) || (a.status === "running" && !S.collapsed.has(id));
    const tools = list.filter((m) => m.kind === "tool").length;
    const status = a.status === "running" ? `<span class="pill running"><span class="dot"></span>実行中</span>`
      : a.status === "interrupted" ? `<span class="pill waiting"><span class="dot"></span>中断</span>`
      : `<span class="pill done"><span class="dot"></span>完了</span>`;
    const body = open ? `<div class="card-body" id="body-${esc(id)}">${list.map((m, k) => msgHtml(m, `${id}:${k}`)).join("") || '<p class="empty">出力なし</p>'}</div>` : "";
    return `<div class="card" style="--role:${roleColor(a.role)}">
      <div class="card-head" data-toggle="${esc(id)}">
        <span class="role">${esc(roleLabel(a.role))}</span>
        <span class="card-title" title="${esc(a.description)}">${esc(a.description)}</span>
        <span class="hint">操作 ${tools}</span>${status}
      </div>${body}</div>`;
  }).join("");
  box.scrollTop = keepScroll;
  for (const id of ids) {
    const b = document.getElementById(`body-${id}`);
    if (b && V().agents.get(id).status === "running") b.scrollTop = b.scrollHeight;
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

function selectedSprint(sc) {
  const all = sc.sprints || [];
  return all.find((x) => x.number === S.sprintView) || sc.sprint || {};
}
function sprintPicker(sc, sp) {
  const all = sc.sprints || [];
  if (all.length < 2) return "";
  return `<div class="chips" style="margin-bottom:10px">${all.map((x) =>
    `<button class="chip ${x.number === sp.number ? "on" : ""}" data-sprint="${x.number === (sc.sprint || {}).number ? "" : x.number}">Sprint ${x.number}</button>`).join("")}</div>`;
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
    const sp = selectedSprint(sc);
    const counts = Object.entries(sc.backlog_counts || {}).map(([k, v]) => `${esc(k)} ${v}`).join(" / ");
    html = sprintPicker(sc, sp) + `<div class="md"><h3>Sprint ${esc(sp.number ?? "—")}（${esc(sp.phase || "—")}）</h3><p>${inline(sp.goal || "")}</p></div>
      <h2>対象 PBI</h2>${table(sp.pbis)}
      <h2>Agent 実行ログ</h2>${table(sp.agent_log)}
      <p class="hint">バックログ：${counts || "—"}　容量：${esc(sc.capacity || "—")}　置き場：${esc(sc.backend || "—")}</p>`;
  } else if (S.tab === "retro") {
    const sp = selectedSprint(sc);
    html = sprintPicker(sc, sp) + mdOr(sp.retro, "このスプリントの振り返りはまだ無い。");
  } else if (S.tab === "team") {
    html = mdOr(sc.team_markdown, "チーム編成はまだ無い。インセプションデッキの後にスクラムマスターが提案する。");
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

async function toggleDrawer() {
  S.drawer = !S.drawer;
  if (S.drawer) {
    S.sessions = null;
    schedule();
    const data = await apiGet("/api/sessions").catch((err) => ({ sessions: [], error: err.message }));
    S.sessions = data.sessions;
  }
  schedule();
}

function renderDrawer() {
  const el = $("drawer");
  el.hidden = !S.drawer;
  if (!S.drawer) return;
  const q = (($("session-filter") && $("session-filter").value) || "").trim();
  const r = S.runner || {};
  const list = (S.sessions || []).filter((x) => !q || `${x.first_prompt} ${x.last_prompt}`.includes(q));
  const items = S.sessions == null ? '<p class="empty">読み込み中…</p>'
    : list.map((x) => {
      const badges = [
        x.id === LIVE.session ? '<span class="pill running"><span class="dot"></span>ライブ</span>' : "",
        x.id === r.session_id ? '<span class="pill waiting"><span class="dot"></span>前回操作</span>' : "",
        HIST && x.id === HIST.info.id ? '<span class="pill">表示中</span>' : "",
      ].join("");
      return `<button class="session" data-session="${esc(x.id)}">
        <div class="row" style="margin:0"><b>${esc(when(x.started))}</b><span class="hint">〜 ${esc(when(x.updated * 1000))}</span><div class="spacer"></div>${badges}</div>
        <div class="session-prompt">${esc(x.first_prompt || "—")}</div>
        <div class="hint clamp">最後：${esc(x.last_prompt || "—")}</div>
        <div class="hint">Agent ${x.agents}件${x.cost != null ? `　$${Number(x.cost).toFixed(2)}` : ""}　<code>${esc(x.id.slice(0, 8))}</code></div>
      </button>`;
    }).join("") || '<p class="empty">該当するセッションは無い。</p>';
  const focus = document.activeElement && document.activeElement.id === "session-filter";
  const prev = el.querySelector(".drawer-list");
  const keep = prev ? prev.scrollTop : 0;
  el.innerHTML = `<div class="drawer-head"><h2>セッションの履歴</h2><input id="session-filter" placeholder="入力内容で絞り込む" value="${esc(q)}"></div><div class="drawer-list">${items}</div>`;
  el.querySelector(".drawer-list").scrollTop = keep;
  if (focus) { const f = $("session-filter"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}

function render() {
  renderDrawer();
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
  const t = e.target.closest("[data-action],[data-quick],[data-toggle],[data-filter],[data-tab],[data-full],[data-session],[data-sprint]");
  if (!t) {
    if (S.drawer && !e.target.closest("#drawer")) { S.drawer = false; schedule(); }
    return;
  }
  if (t.dataset.session) {
    const info = (S.sessions || []).find((x) => x.id === t.dataset.session);
    if (info) openHistory(info).catch((err) => alertInline(err.message));
    return;
  }
  if (t.dataset.sprint !== undefined) { S.sprintView = t.dataset.sprint ? Number(t.dataset.sprint) : null; schedule(); return; }
  if (t.dataset.full) { S.openedFull.add(t.dataset.full); schedule(); return; }
  if (t.dataset.tab) { S.tab = t.dataset.tab; schedule(); return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; schedule(); return; }
  if (t.dataset.toggle) {
    const id = t.dataset.toggle;
    const a = V().agents.get(id);
    const open = S.expanded.has(id) || (a.status === "running" && !S.collapsed.has(id));
    if (open) { S.expanded.delete(id); S.collapsed.add(id); } else { S.expanded.add(id); S.collapsed.delete(id); }
    schedule();
    return;
  }
  if (t.dataset.quick) { send(t.dataset.quick); return; }
  const input = $("po-input");
  if (t.dataset.action === "send") send(input && input.value);
  if (t.dataset.action === "stop") api("/api/session/stop").catch((err) => alertInline(err.message));
  if (t.dataset.action === "live") { HIST = null; schedule(); return; }
  if (t.dataset.action === "sessions") { toggleDrawer(); return; }
  if (t.dataset.action === "resume-hist") {
    const id = HIST.info.id;
    HIST = null;
    api("/api/session/start", { resume: id, message: "続けて。" }).catch((err) => alertInline(err.message));
    schedule();
    return;
  }
  if (t.dataset.action === "start") {
    const resume = $("resume") && $("resume").checked;
    const message = (input && input.value.trim()) || "";
    S.draft = "";
    api("/api/session/start", { resume, message }).catch((err) => alertInline(err.message));
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "po-input") S.draft = e.target.value;
  if (e.target.id === "session-filter") renderDrawer();
});
document.addEventListener("keydown", (e) => {
  if (e.target.id === "po-input" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const r = S.runner || {};
    if (r.status === "waiting" && r.session_id) send(e.target.value);
  }
});

connect();
