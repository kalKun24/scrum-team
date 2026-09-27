"use strict";

const TOKEN = new URLSearchParams(location.search).get("t") || "";
const SLOT_LABEL = {
  implement: "実装", design: "デザイン", "code-review": "コードレビュー",
  "security-review": "セキュリティレビュー", "extra-review": "専門レビュー",
};
// チーム編成の導入前に使っていた固定の Agent
const FIXED_SLOT = { designer: "design", developer: "implement", "code-reviewer": "code-review", "security-reviewer": "security-review" };
const PHASES = [["refinement", "リファインメント"], ["planning", "計画"], ["execution", "実行"], ["review", "レビュー"], ["retrospective", "レトロ"]];
const VIEWS = [["sprint", "スプリント"], ["board", "ボード"], ["retro", "振り返り"], ["team", "チーム"], ["metrics", "指標"], ["deck", "デッキ"], ["history", "履歴"]];
const STATE_LABEL = {
  todo: ["未着手", ""], design: ["デザイン中", ""], dev: ["実装中", ""], review: ["レビュー中", ""],
  approved: ["PO の判定待ち", "po"], accepted: ["受け入れ", "ok"], rejected: ["却下", "bad"], blocked: ["中断", "bad"],
};
const COLUMNS = [
  ["todo", "未着手", null], ["design", "デザイン", "design"], ["dev", "実装", "implement"],
  ["review", "レビュー", "code-review"], ["approved", "PO の判定", "po"], ["accepted", "完了", null],
];
const REQUEST_LINES = 8;

const S = {
  project: "", scrum: null, runner: null, view: "sprint", sprintSel: null, switcher: false,
  selected: null, backlogFilter: "all", draft: "", modal: null, sessions: null,
  openedFull: new Set(), openAgents: new Set(), keys: {}, prs: {},
};

// ---------- 会話の保持 ----------
function newStore() { return { session: null, agents: new Map(), msgs: new Map(), order: [] }; }
const LIVE = newStore();
const CACHE = new Map();
const LOADING = new Set();

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
function apiGet(path, params = "") {
  return fetch(`${path}?t=${encodeURIComponent(TOKEN)}${params}`).then(async (r) => {
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
function handle(ev) {
  switch (ev.type) {
    case "project": S.project = ev.path; Object.assign(LIVE, newStore()); break;
    case "reset": Object.assign(LIVE, newStore()); break;
    case "state": S.scrum = ev.state; break;
    case "runner": S.runner = ev.runner; break;
    case "session": ingest(LIVE, ev); loadSessions(); break;
    default: ingest(LIVE, ev);
  }
}
function loadSessions() {
  apiGet("/api/sessions").then((d) => { S.sessions = d.sessions; schedule(); }).catch(() => {});
}
function loadSession(id) {
  if (CACHE.has(id) || LOADING.has(id)) return;
  LOADING.add(id);
  apiGet(`/api/sessions/${id}`).then((d) => {
    const store = newStore();
    for (const ev of d.events) ingest(store, ev);
    CACHE.set(id, store);
    LOADING.delete(id);
    schedule();
  }).catch(() => LOADING.delete(id));
}
function loadPr(branch) {
  if (!branch || branch in S.prs) return;
  S.prs[branch] = null;
  apiGet("/api/pr", `&branch=${encodeURIComponent(branch)}`).then((d) => { S.prs[branch] = d; schedule(); }).catch(() => {});
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}

// ---------- 文字列 ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
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
const ms = (t) => (t ? new Date(typeof t === "number" ? t * 1000 : t).getTime() : NaN);
function when(t) {
  const d = new Date(ms(t));
  return isNaN(d) ? "—" : d.toLocaleString("ja-JP", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function hm(t) {
  const d = new Date(ms(t));
  return isNaN(d) ? "" : d.toLocaleTimeString("ja-JP", { hour12: false, hour: "2-digit", minute: "2-digit" });
}
function day(t) {
  const d = new Date(ms(t));
  return isNaN(d) ? "—" : `${d.getMonth() + 1}/${d.getDate()}`;
}
// 要約用に、Markdown の記号・コードブロックの記号・表の行を除いた最初の1行を返す
const firstLine = (t) => String(t || "").split("\n")
  .filter((l) => !/^\s*(```|\|)/.test(l))
  .map((l) => l.replace(/^[#>*\-\s]+/, "").replace(/\*\*/g, "").trim())
  .find((l) => l && !/^[:\-]+$/.test(l)) || "";
const CHECK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8.5l3 3 7-7"></path></svg>';
const CHEV = (up) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${up ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"}"></path></svg>`;

// ---------- スプリントと期間 ----------
const sc = () => S.scrum || {};
const sprints = () => sc().sprints || [];
const latestN = () => sc().latest;
const selN = () => S.sprintSel ?? latestN();
const isPast = () => S.sprintSel != null && S.sprintSel !== latestN();
const sprintOf = (n) => sprints().find((x) => x.number === n) || null;
function windowOf(sp) {
  if (!sp) return { start: null, end: null };
  const prev = sprintOf(sp.number - 1);
  return { start: prev && prev.closed ? ms(prev.closed) : null, end: sp.phase === "closed" && sp.closed ? ms(sp.closed) : null };
}
const inWin = (t, w) => { const x = ms(t); return (w.start == null || x > w.start) && (w.end == null || x <= w.end + 60000); };
function sessionsFor(w) {
  return (S.sessions || []).filter((s) => (w.end == null || ms(s.started) <= w.end + 60000) && (w.start == null || s.updated * 1000 >= w.start));
}
function storesFor(sp) {
  const w = windowOf(sp);
  const stores = [];
  for (const s of sessionsFor(w)) {
    if (s.id === LIVE.session) stores.push(LIVE);
    else if (CACHE.has(s.id)) stores.push(CACHE.get(s.id));
    else loadSession(s.id);
  }
  if (!isPast() && LIVE.session && !stores.includes(LIVE)) stores.push(LIVE);
  return { stores, w };
}
function invocations(sp) {
  const { stores, w } = storesFor(sp);
  const out = [];
  for (const st of stores) {
    for (const id of st.order) {
      const msgs = st.msgs.get(id) || [];
      if (!msgs.length || !inWin(msgs[0].ts, w)) continue;
      out.push({ ...st.agents.get(id), msgs, first: msgs[0].ts, last: msgs[msgs.length - 1].ts });
    }
  }
  return out.sort((a, b) => ms(a.first) - ms(b.first));
}
function smMessages(sp) {
  const { stores, w } = storesFor(sp);
  return stores.flatMap((st) => (st.msgs.get("main") || []).filter((m) => inWin(m.ts, w))).sort((a, b) => ms(a.ts) - ms(b.ts));
}
function members(sp, invs) {
  const rows = (sp && sp.team) || null;
  if (rows && rows.length) return { fixed: false, list: rows.map((r) => ({ name: r["Agent"], slot: r["枠"] })) };
  const names = [...new Set(invs.map((i) => i.role))];
  return { fixed: true, list: names.map((n) => ({ name: n, slot: FIXED_SLOT[n] || "general" })) };
}
function slotOf(role, sp) {
  const row = ((sp && sp.team) || sc().team || []).find((r) => r["Agent"] === role);
  return row ? row["枠"] : FIXED_SLOT[role] || "general";
}
const color = (slot) => `var(--slot-${SLOT_LABEL[slot] ? slot : "general"})`;
const initials = (name) => { const p = String(name).split("-"); return (p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase(); };
const isRetro = (inv) => /振り返り|retro/i.test(inv.description || "");
function verdictOf(inv) {
  const text = inv.msgs.filter((m) => m.kind === "text").map((m) => m.text).join("\n");
  const v = text.match(/verdict:\s*\**\s*(approve|request-changes)/i);
  if (!v) return null;
  const tests = [...text.matchAll(/Ran (\d+) tests?/g)].map((m) => m[1]);
  return { verdict: v[1].toLowerCase(), must: (text.match(/\[must\]/g) || []).length, should: (text.match(/\[should\]/g) || []).length, tests: tests.pop() };
}
const lastText = (inv) => { const t = inv.msgs.filter((m) => m.kind === "text"); return t.length ? t[t.length - 1].text : ""; };
const backlogMap = () => new Map((sc().backlog || []).map((b) => [b.id, b]));

// ---------- 描画の土台 ----------
const $ = (id) => document.getElementById(id);
function put(el, key, html) {
  if (!el || S.keys[el.id] === key) return false;
  S.keys[el.id] = key;
  const keep = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = keep;
  return true;
}
function render() {
  renderTop();
  renderBanner();
  renderSprintbar();
  renderView();
  renderModal();
}

function renderTop() {
  $("project").textContent = S.project ? S.project.split("/").pop() : "";
  const inbox = inboxCount();
  put($("tabs"), JSON.stringify([S.view, inbox]), VIEWS.map(([k, label]) =>
    `<button type="button" class="tab" data-view="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${label}${k === "sprint" && inbox ? ` <span class="badge">${inbox}</span>` : ""}</button>`).join(""));
  const r = S.runner || { status: "idle" };
  const label = { idle: "未起動", running: "処理中", waiting: inbox ? "PO の判断待ち" : "入力待ち", exited: "停止" }[r.status] || r.status;
  put($("runner"), JSON.stringify([r.status, label, r.cost]), `<span class="pill ${r.status}"><span class="dot"></span>${label}</span>` +
    (r.cost != null ? `<span class="cost">累計 $${Number(r.cost).toFixed(2)}</span>` : ""));
}
function renderBanner() {
  const el = $("banner");
  if (!isPast()) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="banner"><b>Sprint ${selN()} を閲覧中</b><span>（読み取りのみ）。最新のスプリントの入力はここではできない。</span><span class="spacer"></span>
    <button type="button" class="link-btn" data-sprint="">最新の Sprint ${latestN()} に戻る</button></div>`;
}
function stepperHtml(sp) {
  const phase = sp ? sp.phase : null;
  const idx = PHASES.findIndex(([k]) => k === phase);
  const closed = phase === "closed";
  return `<ol class="stepper" aria-label="スプリントの進行">` + PHASES.map(([k, label], i) => {
    const cls = closed || (idx >= 0 && i < idx) ? "done" : i === idx ? "current" : "todo";
    return `${i ? '<li class="sep" aria-hidden="true">—</li>' : ""}<li class="step ${cls}">${label}</li>`;
  }).join("") + "</ol>";
}
function renderSprintbar() {
  const el = $("sprintbar");
  const s = sc();
  if (!s.initialized || !["sprint", "board", "retro"].includes(S.view)) { el.hidden = true; return; }
  el.hidden = false;
  const sp = sprintOf(selN());
  if (!sp) { put(el, "none", `<div><h1 class="switcher">スプリント前</h1><p class="goal">まだスプリントは無い。</p></div>`); return; }
  const m = (s.metrics_rows || []).find((r) => r.Sprint === String(sp.number));
  const pts = sp.pbis.reduce((a, r) => a + (Number(r.points) || 0), 0);
  let html = `<div style="flex:1;min-width:0"><div class="row-gap">
      <h1><button type="button" class="switcher ${S.switcher ? "open" : ""}" data-action="switcher" aria-haspopup="listbox" aria-expanded="${S.switcher}">Sprint ${sp.number}${CHEV(S.switcher)}</button></h1>
      <span class="muted">${pts}pt / 容量 ${esc(s.capacity || "—")}pt${sp.closed ? ` · ${day(sp.closed)} に終了` : ""}${m ? ` · 受け入れ率 ${esc(m["受け入れ率"])}` : ""}</span></div>
      <p class="goal">${inline(sp.goal || "")}</p></div>${stepperHtml(sp)}`;
  if (S.switcher) html += switcherMenu();
  put(el, html, html);
}
function switcherMenu() {
  const rows = sprints().map((sp) => {
    const m = (sc().metrics_rows || []).find((r) => r.Sprint === String(sp.number)) || {};
    const note = sp.phase !== "closed" ? `<span style="color:var(--po-ink);font-weight:700">${esc((PHASES.find(([k]) => k === sp.phase) || [0, sp.phase])[1])}中</span>`
      : m["blocked"] && m["blocked"] !== "0" ? `blocked ${esc(m["blocked"])}` : (sp.agent_log || []).some((r) => /中断/.test(r["目的"] || "")) ? "中断から再開" : "";
    return `<button type="button" class="row" role="option" aria-selected="${sp.number === selN()}" data-sprint="${sp.number === latestN() ? "" : sp.number}">
      <b>Sprint ${sp.number}</b><span class="ellipsis">${inline(sp.goal || "")}</span><span>${day(sp.closed || sp.started)}</span>
      <span>${m["実績pt"] ? `${esc(m["実績pt"])} / ${esc(m["計画pt"])}` : "—"}</span><span>${esc(m["受け入れ率"] || "—")}</span><span class="small muted">${note}</span></button>`;
  }).join("");
  const firstTeam = sprints().filter((sp) => sp.team && sp.team.length).map((sp) => sp.number).pop();
  return `<div class="sprint-menu" role="listbox" aria-label="スプリントを選ぶ">
    <div class="row head"><span>スプリント</span><span>ゴール</span><span>日付</span><span>実績 pt</span><span>受け入れ</span><span>メモ</span></div>${rows}
    <div class="foot"><button type="button" class="link-btn" data-view="metrics"><b>スプリントを並べて比べる</b></button><span class="spacer muted">pt・差し戻し・tokens/pt・テスト数の推移</span>
    ${firstTeam && firstTeam > 1 ? `<span class="muted">Sprint ${firstTeam} からチーム編成</span>` : ""}</div></div>`;
}

// ---------- 画面の切り替え ----------
function renderView() {
  const el = $("view");
  const s = sc();
  if (!s.initialized && S.view !== "history") {
    el.dataset.layout = "uninit";
    put(el, JSON.stringify(["uninit", S.runner]), `<div class="page"><div class="page-inner">${composerHtml()}<p class="empty">.scrum/ がまだ無い。スプリントを始めると作られる。</p></div></div>`);
    return;
  }
  if (S.view === "sprint") return isPast() ? renderPast(el) : renderSprint(el);
  if (S.view === "board") return renderBoard(el);
  if (S.view === "history") return renderHistory(el);
  return renderDoc(el);
}
function layout3(el, name) {
  if (el.dataset.layout !== name) {
    el.dataset.layout = name;
    S.keys = {};
    el.innerHTML = `<div class="grid3"><section class="col" id="c1"></section><section class="col" id="c2"></section><aside class="col" id="c3"></aside></div>`;
  }
}

// ---------- スプリント（最新） ----------
function lastSmText(list) {
  for (let k = list.length - 1; k >= 0; k--) {
    if (list[k].kind === "po" || list[k].kind === "error") return null;
    if (list[k].kind === "text") return list[k].text;
  }
  return null;
}
function liveState() {
  const r = S.runner || { status: "idle" };
  const main = LIVE.msgs.get("main") || [];
  const last = [...main].reverse().find((m) => m.kind !== "tool");
  const error = r.error || (last && last.kind === "error" ? last.text : null);
  const busy = [...LIVE.agents.values()].filter((a) => a.status === "running").length;
  const waiting = r.status === "waiting" && !!r.session_id;
  const ask = waiting && !busy && !error ? lastSmText(main) : null;
  return { r, error, busy, waiting, ask };
}
function inboxCount() { return liveState().ask ? 1 : 0; }

function acceptanceCards(sp, invs) {
  if (!sp || sp.phase !== "review") return "";
  const bl = backlogMap();
  return sp.pbis.filter((row) => row["状態"] === "approved").map((row) => {
    const id = row.PBI;
    const item = bl.get(id) || {};
    const mine = invs.filter((i) => (i.description || "").includes(id) && !isRetro(i));
    const reviews = mine.map((i) => ({ i, v: verdictOf(i) })).filter((x) => x.v && slotOf(x.i.role, sp).endsWith("review"));
    const impl = mine.filter((i) => slotOf(i.role, sp) === "implement").pop();
    const fromReview = (reviews.find((x) => x.v.tests) || { v: {} }).v.tests;
    const tests = (impl && [...lastText(impl).matchAll(/Ran (\d+) tests?/g)].map((m) => m[1]).pop()) || fromReview;
    return `<article class="inbox-card">
      <div class="kind"><span>受け入れ判定</span><span>承認点 2 / 2</span></div>
      <div><div class="mono muted">${esc(id)} · ${esc(row.points || item.points || "?")}pt</div><div style="font-size:16px;font-weight:700">${inline(item.title || "")}</div></div>
      <div class="tiles"><div class="tile"><div class="k">テスト</div><div class="v">${esc(tests || "—")}</div></div>
        <div class="tile"><div class="k">レビュー</div><div class="v">${reviews.filter((x) => x.v.verdict === "approve").length} / ${reviews.length || "—"}</div></div>
        <div class="tile"><div class="k">差し戻し</div><div class="v">${esc(row["差し戻し"] || "0")}</div></div></div>
      <ul class="verdicts">${reviews.map(({ i, v }) => `<li><span class="${v.verdict === "approve" ? "ok" : "ng"}">${v.verdict === "approve" ? CHECK : "!"}</span><span style="flex:1">${esc(i.role)}</span><span class="${v.verdict === "approve" ? "ok" : "ng"}">${v.verdict}</span><span class="muted">must ${v.must} · should ${v.should}</span></li>`).join("")}</ul>
      <div class="row-gap"><button type="button" class="btn primary big" style="flex:1" data-send="${esc(id)} は受け入れる。">受け入れる</button>
        <button type="button" class="btn big" data-prefill="${esc(id)} は却下する。理由：">却下して理由を書く</button></div></article>`;
  }).join("");
}
function composerHtml() {
  const { r, error, busy, waiting, ask } = liveState();
  const bits = [];
  if (waiting) {
    if (busy && !error) bits.push(`<div class="notice-card"><span class="pill running" style="background:var(--accent-soft);color:var(--accent-ink)"><span class="dot"></span>Agent が作業中（${busy}件）</span> 完了するとスクラムマスターが続きを進める。</div>`);
    if (error) bits.push(`<div class="notice-card warn"><b>エラーで止まった</b><p style="margin:4px 0">${esc(error)}</p><span class="small">原因を解消してから「続けて」と送ると再開する。</span></div>`);
    if (ask) {
      const lines = ask.split("\n");
      const full = S.openedFull.has("ask") || lines.length <= REQUEST_LINES * 2;
      bits.push(`<div class="inbox-card" style="border-width:1px"><div class="kind"><span>スクラムマスターからの依頼</span></div>
        <div class="md ask">${md(full ? ask : lines.slice(0, REQUEST_LINES * 2).join("\n"))}</div>
        ${full ? "" : `<button type="button" class="link-btn" style="text-align:left" data-full="ask">全文を読む（残り${lines.length - REQUEST_LINES * 2}行）</button>`}
        <div class="row-gap"><button type="button" class="btn" data-send="承認する。">承認する</button><button type="button" class="btn" data-send="すべて推奨どおり。">すべて推奨どおり</button></div></div>`);
    }
    bits.push(`<div class="panel pad" style="display:flex;flex-direction:column;gap:8px"><label for="po-input" style="font-weight:700;font-size:13px">スクラムマスターに伝える</label>
      <textarea id="po-input" class="input" placeholder="回答や指示を入力（Ctrl+Enter で送信）">${esc(S.draft)}</textarea>
      <div class="row-gap"><button type="button" class="btn" data-action="stop">停止</button><span class="spacer"></span><button type="button" class="btn primary" data-action="send">送信</button></div></div>`);
  } else if (r.status === "running") {
    bits.push(`<div class="notice-card row-gap"><span class="pill running" style="background:var(--accent-soft);color:var(--accent-ink)"><span class="dot"></span>スクラムマスターが作業中</span><span class="spacer"></span><button type="button" class="btn" data-action="stop">停止</button></div>`);
  } else {
    const target = r.session_id || LIVE.session;
    const interrupted = r.interrupted || [];
    if (interrupted.length) bits.push(`<div class="notice-card warn"><b>作業中のまま中断した Agent がいる</b><ul style="margin:6px 0;padding-left:18px">${interrupted.map((a) => `<li>${esc(a.role)}：${esc(a.description)}</li>`).join("")}</ul><span class="small">再開すると、この内容をスクラムマスターに伝え、続きから進めるかやり直すかを判断させる。</span></div>`);
    const last = target && target === LIVE.session ? lastSmText(LIVE.msgs.get("main") || []) : null;
    if (last) bits.push(`<div class="notice-card"><div class="label">スクラムマスターの最後の発言</div><div class="md ask">${md(last)}</div></div>`);
    bits.push(`<div class="panel pad" style="display:flex;flex-direction:column;gap:8px"><label for="po-input" style="font-weight:700;font-size:13px">スクラムマスターを起動する</label>
      <textarea id="po-input" class="input">${esc(S.draft || (target ? "続けて。" : "/scrum-team:run-sprint"))}</textarea>
      <div class="row-gap"><label class="small"><input type="checkbox" id="resume" ${target ? "checked" : ""}> セッションを再開する</label>
      ${target ? `<span class="small muted">再開先 <code>${esc(target.slice(0, 8))}</code>${target === r.session_id ? "（前回操作したセッション）" : ""}</span>` : ""}
      <span class="spacer"></span><button type="button" class="btn primary" data-action="start">開始</button></div>
      ${r.error ? `<span class="small muted">前回の終了：${esc(r.error)}</span>` : ""}</div>`);
  }
  return bits.join("");
}
function renderSprint(el) {
  layout3(el, "sprint");
  const sp = sprintOf(selN());
  const invs = invocations(sp);
  const sm = smMessages(sp);
  const { r, busy, ask, error } = liveState();
  // 左：PO の受信箱（入力中は描き直さない）
  const typing = document.activeElement && document.activeElement.id === "po-input";
  const leftKey = JSON.stringify([r.status, r.session_id, r.error, (r.interrupted || []).length, busy, ask, error, sp && sp.phase,
    sp && sp.pbis.map((x) => x["状態"]), invs.map((i) => [i.agent_id, i.msgs.length]), [...S.openedFull].join(), sm.length, S.draft && !typing ? S.draft : ""]);
  if (!typing || S.keys.c1 == null) {
    const acc = ask ? acceptanceCards(sp, invs) : "";
    const record = sm.filter((m) => m.kind === "text" || m.kind === "notice" || m.kind === "po").slice(-6).reverse();
    put($("c1"), leftKey, `<h2 class="h2">PO の受信箱 ${inboxCount() ? `<span class="badge">${inboxCount()}</span>` : ""}</h2>
      ${acc}${composerHtml()}
      <div class="panel pad" style="display:flex;flex-direction:column;gap:8px"><div class="h2" style="font-size:13px">スクラムマスターの記録${LIVE.session ? `<button type="button" class="link link-btn" data-modal="${esc(LIVE.session)}">会話をすべて見る</button>` : ""}</div>
      <ol class="timeline">${record.map((m) => `<li><span class="dot" style="background:${m.kind === "po" ? "var(--accent)" : m.kind === "notice" ? "var(--ok)" : "#A09B91"}"></span><span><span class="small muted">${hm(m.ts)}</span> ${m.kind === "po" ? "<b>PO</b> " : ""}${inline(firstLine(m.text).slice(0, 120))}</span></li>`).join("") || '<li class="empty">まだ記録は無い。</li>'}</ol></div>`);
  }
  // 中央：PBI とチーム
  const bl = backlogMap();
  const order = ["design", "dev", "review", "approved", "accepted"];
  const pbiCards = (sp ? sp.pbis : []).map((row) => {
    const item = bl.get(row.PBI) || {};
    const [label, cls] = STATE_LABEL[row["状態"]] || [row["状態"], ""];
    const at = order.indexOf(row["状態"]);
    const ui = (row.ui || item.ui) === "yes";
    const stages = [["design", "デザイン", "design"], ["dev", "実装", "implement"], ["review", "レビュー", "code-review"], ["approved", "PO の判定", "po"]]
      .filter(([k]) => k !== "design" || ui)
      .map(([k, name, slot]) => { const i = order.indexOf(k); const done = at > i; const now = at === i;
        return `<span><span class="bar" style="background:${done || now ? (slot === "po" ? "var(--po-line)" : color(slot)) : "var(--chip)"}"></span>${name}${done ? " ✓" : ""}</span>`; }).join("");
    return `<div class="pbi-card"><div class="row-gap"><span class="mono muted">${esc(row.PBI)} · ${esc(row.points)}pt</span><b style="flex:1">${inline(item.title || "")}</b><span class="state ${cls}">${esc(label)}</span></div>
      <div class="stages" style="grid-template-columns:repeat(${ui ? 4 : 3},minmax(0,1fr))">${stages}</div></div>`;
  }).join("") || '<p class="empty">このスプリントの PBI はまだ無い。</p>';
  const team = members(sp, invs);
  const selected = S.selected && invs.find((i) => i.agent_id === S.selected) ? S.selected : (invs.filter((i) => !isRetro(i)).pop() || invs[invs.length - 1] || {}).agent_id;
  const cards = team.list.map((m) => {
    const mine = invs.filter((i) => i.role === m.name);
    const cur = mine.filter((i) => i.status === "running").pop() || mine.filter((i) => !isRetro(i)).pop() || mine[mine.length - 1];
    const st = !cur ? ['<span class="status-idle">待機</span>', "このスプリントではまだ動いていない"]
      : cur.status === "running" ? ['<span class="status-run">実行中</span>', cur.description]
      : cur.status === "interrupted" ? ['<span class="status-int">中断</span>', cur.description]
      : ['<span class="status-ok">完了</span>', firstLine(lastText(cur)) || cur.description];
    return `<button type="button" class="member" ${cur ? `data-select="${esc(cur.agent_id)}"` : "disabled"} aria-pressed="${!!cur && cur.agent_id === selected}">
      <span class="top"><span class="avatar" style="background:${color(m.slot)}">${esc(initials(m.name))}</span>
      <span style="flex:1;display:flex;flex-direction:column"><b>${esc(m.name)}</b><span class="small muted">${esc(SLOT_LABEL[m.slot] || m.slot)}</span></span>${st[0]}</span>
      <span class="small clamp2" style="color:var(--ink-2)">${inline(String(st[1]).slice(0, 160))}</span></button>`;
  }).join("");
  const next = (sc().backlog || []).filter((b) => ["new", "ready"].includes(b.status)).slice(0, 3)
    .map((b) => `<div class="panel row-gap" style="padding:10px 12px;font-size:13px"><span class="mono muted">${esc(b.id)}</span><span style="flex:1">${inline(b.title)}</span><span class="state">${esc(b.status)}</span></div>`).join("");
  put($("c2"), JSON.stringify([sp && sp.pbis, invs.map((i) => [i.agent_id, i.status, i.msgs.length]), selected, sc().backlog, sc().team]),
    `<h2 class="h2">このスプリントの PBI<button type="button" class="link link-btn" data-view="board">ボードで見る</button></h2>${pbiCards}
     <h2 class="h2" style="margin-top:8px">チーム${team.fixed && team.list.length ? '<span class="small muted" style="font-family:inherit;font-weight:400">固定 Agent</span>' : ""}</h2>
     <div class="team">${cards || '<p class="empty">まだ Agent は動いていない。</p>'}</div>
     ${next ? `<h2 class="h2" style="margin-top:8px">次のスプリント候補</h2>${next}` : ""}`);
  renderDetail($("c3"), invs.find((i) => i.agent_id === selected), sp);
}
function renderDetail(el, inv, sp) {
  if (!inv) { put(el, "none", '<div class="panel pad"><p class="empty">Agent を選ぶと、依頼・操作・発言をここに出す。</p></div>'); return; }
  const key = JSON.stringify([inv.agent_id, inv.status, inv.msgs.length, [...S.openedFull].join()]);
  const slot = slotOf(inv.role, sp);
  const v = verdictOf(inv);
  const req = inv.msgs.find((m) => m.kind === "request");
  const reqKey = `req:${inv.agent_id}`;
  const tools = inv.msgs.filter((m) => m.kind === "tool");
  const groups = new Map();
  for (const t of tools) { const name = t.text.split(" ")[0]; groups.set(name, [...(groups.get(name) || []), t.text]); }
  const texts = inv.msgs.filter((m) => m.kind === "text");
  const opsKey = `ops:${inv.agent_id}`;
  const opsList = S.openedFull.has(opsKey) ? tools.map((t) => `<li title="${esc(t.text)}">${hm(t.ts)} ${esc(t.text)}</li>`).join("")
    : [...groups].map(([name, xs]) => `<li title="${esc(xs.join("\n"))}">${esc(name)} ×${xs.length} · ${esc(xs.slice(-2).map((x) => x.slice(name.length + 1)).join(", ").slice(0, 90))}</li>`).join("");
  const stLabel = inv.status === "running" ? ["status-run", "実行中"] : inv.status === "interrupted" ? ["status-int", "中断"] : ["status-ok", "完了"];
  put(el, key, `<div class="panel detail" style="height:100%">
    <div class="detail-head"><span class="avatar" style="width:32px;height:32px;background:${color(slot)}">${esc(initials(inv.role))}</span>
      <div style="flex:1;min-width:0"><b>${esc(inv.role)}</b><div class="small muted ellipsis">${esc(inv.description)}</div></div>
      <span class="${stLabel[0]}">${stLabel[1]}</span></div>
    <div class="detail-body">
      ${v ? `<div class="verdict-box ${v.verdict === "approve" ? "" : "ng"}"><div class="row-gap"><span style="color:${v.verdict === "approve" ? "var(--ok)" : "var(--bad-ink)"}">${v.verdict === "approve" ? CHECK : "!"}</span><b>${v.verdict}</b><span class="small">must ${v.must} · should ${v.should}${v.tests ? ` · ${v.tests} tests` : ""}</span></div></div>` : ""}
      ${req ? `<div><div class="label">依頼 <span class="small muted" style="font-weight:400;margin-left:6px">${hm(req.ts)}</span></div><div class="md small">${md(S.openedFull.has(reqKey) ? req.text : req.text.split("\n").slice(0, 4).join("\n"))}</div>
        ${req.text.split("\n").length > 4 ? `<button type="button" class="link-btn" data-full="${esc(reqKey)}">${S.openedFull.has(reqKey) ? "たたむ" : "依頼の全文を見る"}</button>` : ""}</div>` : ""}
      <div><div class="label">操作 ${tools.length}件<span class="spacer"></span>${tools.length ? `<button type="button" class="link-btn" data-full="${esc(opsKey)}">${S.openedFull.has(opsKey) ? "まとめて表示" : "すべて表示"}</button>` : ""}</div><ol class="ops">${opsList || "<li>なし</li>"}</ol></div>
      <div><div class="label">発言</div>${texts.map((m) => `<div class="md" style="margin-bottom:10px"><div class="small muted">${hm(m.ts)}</div>${md(m.text)}</div>`).join("") || '<p class="empty">まだ発言は無い。</p>'}</div>
    </div></div>`);
}

// ---------- スプリント（過去） ----------
function renderPast(el) {
  layout3(el, "past");
  const sp = sprintOf(selN());
  if (!sp) return;
  const invs = invocations(sp);
  const w = windowOf(sp);
  const m = (sc().metrics_rows || []).find((r) => r.Sprint === String(sp.number)) || {};
  const bl = backlogMap();
  const tile = (k, v) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const results = sp.pbis.map((row) => { const [label, cls] = STATE_LABEL[row["状態"]] || [row["状態"], ""];
    return `<div class="panel row-gap" style="padding:12px 14px"><span class="mono muted">${esc(row.PBI)}</span><span style="flex:1;font-size:13px">${inline((bl.get(row.PBI) || {}).title || "")}</span><span class="state ${cls}">${esc(label)}</span></div>`; }).join("");
  const sess = sessionsFor(w);
  const sessions = sess.map((s) => `<button type="button" class="session" data-modal="${esc(s.id)}"><span class="row-gap"><b>${esc(when(s.started))}〜${esc(hm(s.updated))}</b><code class="muted">${esc(s.id.slice(0, 8))}</code></span>
    <span class="small muted">${esc((s.first_prompt || "").slice(0, 60))} · Agent ${s.agents}件${s.cost != null ? ` · $${Number(s.cost).toFixed(2)}` : ""}</span><span class="small" style="color:var(--accent)">会話を開く</span></button>`).join("") || '<p class="empty">この期間のセッションは見つからない。</p>';
  const num = (v) => (v && !isNaN(Number(v)) ? Number(v).toLocaleString() : v || "—");
  put($("c1"), JSON.stringify([sp.number, m, sess.map((s) => s.id), sp.pbis]),
    `<h2 class="h2">結果</h2>${results}
     <div class="tiles big">${tile("実績 / 計画", `${esc(m["実績pt"] || "—")} / ${esc(m["計画pt"] || "—")} pt`)}${tile("差し戻し", esc(m["差し戻し"] || "—"))}
       ${tile("テスト", `${esc(m["テスト数"] || "—")} <span class="small" style="color:var(--ok)">${esc(m["テスト増分"] && m["テスト増分"] !== "不明" ? m["テスト増分"] : "")}</span>`)}${tile("tokens / pt", esc(num(m["tokens/pt"])))}
       ${tile("Agent の起動", esc(m["Agent起動"] || "—"))}${tile("所要時間", esc(m["所要時間"] || "—"))}</div>
     <button type="button" class="link-btn" data-view="metrics" style="text-align:left">指標の推移で比べる</button>
     <h2 class="h2" style="margin-top:8px">このスプリントの会話</h2>${sessions}`);
  const team = members(sp, invs);
  const cards = team.list.map((mm) => {
    const mine = invs.filter((i) => i.role === mm.name && !isRetro(i));
    const last = mine[mine.length - 1];
    return `<button type="button" class="member" ${last ? `data-select="${esc(last.agent_id)}"` : "disabled"} aria-pressed="${!!last && last.agent_id === S.selected}"><span class="top"><span class="avatar" style="background:${color(mm.slot)};width:32px;height:32px">${esc(initials(mm.name))}</span>
      <span style="flex:1;display:flex;flex-direction:column"><b>${esc(mm.name)}</b><span class="small muted">${esc(SLOT_LABEL[mm.slot] || mm.slot)}</span></span><span class="small muted">起動 ${mine.length}</span></span>
      <span class="small clamp2" style="color:var(--ink-2)">${inline(last ? firstLine(lastText(last)).slice(0, 140) : "作業の記録は無い")}</span></button>`;
  }).join("");
  const counts = COLUMNS.map(([k, label]) => [label, sp.pbis.filter((r) => r["状態"] === k).length]);
  put($("c2"), JSON.stringify([sp.number, invs.map((i) => [i.agent_id, i.msgs.length]), S.selected, LOADING.size]),
    `<h2 class="h2">当時のチーム${team.fixed ? '<span class="small muted" style="font-family:inherit;font-weight:400">チーム編成の導入前（固定 Agent）</span>' : ""}</h2>
     <div class="team">${cards || `<p class="empty">${LOADING.size ? "会話を読み込み中…" : "この期間の Agent の記録は無い。"}</p>`}</div>
     <p class="small muted" style="margin:0">振り返りでの起動は数に含めていない。</p>
     <h2 class="h2" style="margin-top:8px">スプリントボード（最終）</h2>
     <div class="tiles">${counts.map(([l, n]) => `<div class="tile"><div class="k">${l}</div><div class="v">${n}</div></div>`).join("")}</div>`);
  const sel = S.selected && invs.find((i) => i.agent_id === S.selected);
  if (sel) renderDetail($("c3"), sel, sp);
  else put($("c3"), `retro:${sp.number}`, `<div class="panel pad" style="height:100%;overflow-y:auto"><div class="h2">振り返り<button type="button" class="link link-btn" data-view="retro">全文</button></div><div class="md">${md(sp.retro || "記録は無い。")}</div></div>`);
}

// ---------- ボード ----------
function renderBoard(el) {
  el.dataset.layout = "board";
  const s = sc();
  const sp = sprintOf(selN());
  const items = s.backlog || [];
  const rowsOf = sp ? sp.pbis : [];
  const inSprint = new Set(rowsOf.map((r) => r.PBI));
  const open = items.filter((b) => b.status !== "done");
  const done = items.filter((b) => b.status === "done");
  const f = S.backlogFilter;
  const link = (b) => (b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener" class="mono">${esc(b.id)}</a>` : `<span class="mono muted">${esc(b.id)}</span>`);
  const row = (b, cls, right) => `<div class="item ${cls}">${link(b)}<span class="ellipsis">${inline(b.title)}</span>${right}</div>`;
  const stateOf = (id) => (rowsOf.find((r) => r.PBI === id) || {})["状態"];
  const current = open.filter((b) => inSprint.has(b.id));
  const next = open.filter((b) => !inSprint.has(b.id));
  let list = "";
  if (f !== "done") {
    if (!isPast() && current.length) list += `<div class="group">このスプリント（Sprint ${sp.number}）</div>` + current.map((b) => row(b, "current", `<span class="small" style="color:var(--po-ink);font-weight:700">${esc((STATE_LABEL[stateOf(b.id)] || [b.status])[0])}</span>`)).join("");
    list += `<div class="group">次の候補（優先度順）</div>` + (next.map((b) => row(b, "", `<span class="state">${esc(b.status)}</span>`)).join("") || '<p class="empty">無い</p>');
  }
  if (f !== "open") list += `<div class="group"><span style="flex:1">完了</span><span style="font-weight:400">スプリント</span></div>` + (done.slice().reverse().map((b) => row(b, "done", `<span class="small">${b.sprint ? `S${b.sprint}` : ""}</span>`)).join("") || '<p class="empty">無い</p>');
  const bl = backlogMap();
  const invs = invocations(sp);
  const inCol = (k, r) => (k === "todo" ? ["todo", "blocked", "rejected"].includes(r["状態"]) : r["状態"] === k);
  const checkLabel = { success: "チェック通過", pending: "実行中", failure: "失敗", none: "チェックなし" };
  const cards = (k) => rowsOf.filter((r) => inCol(k, r)).map((r) => {
    const item = bl.get(r.PBI) || {};
    const roles = [...new Set(invs.filter((i) => (i.description || "").includes(r.PBI) && !isRetro(i)).map((i) => i.role))];
    const branch = (r["ブランチ"] || "").replace(/（.*?）/g, "").trim();
    if (s.backend === "github" && branch) loadPr(branch);
    const pr = branch && S.prs[branch] && S.prs[branch].pr;
    return `<div class="card"><span class="row-gap small">${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener" class="mono">${esc(r.PBI)}</a>` : `<span class="mono muted">${esc(r.PBI)}</span>`}<span class="muted">· ${esc(r.points)}pt</span>
      ${["blocked", "rejected"].includes(r["状態"]) ? `<span class="state bad">${STATE_LABEL[r["状態"]][0]}</span>` : ""}</span>
      <b style="font-size:14px;line-height:1.4">${inline(item.title || "")}</b>
      ${roles.length ? `<span class="row-gap" style="gap:4px">${roles.map((ro) => `<span class="avatar sm" title="${esc(ro)}" style="background:${color(slotOf(ro, sp))}">${esc(initials(ro))}</span>`).join("")}</span>` : ""}
      ${Number(r["差し戻し"]) ? `<span class="small muted">差し戻し ${esc(r["差し戻し"])}</span>` : ""}
      ${pr ? `<span class="row-gap small"><a href="${esc(pr.url)}" target="_blank" rel="noopener" class="mono">PR #${pr.number}</a><span class="check ${pr.check}">${checkLabel[pr.check]}</span></span>` : ""}
      ${branch ? `<span class="mono muted ellipsis" style="font-size:11px">${esc(branch)}</span>` : ""}</div>`;
  }).join("");
  const counts = { all: items.length, open: open.length, done: done.length };
  const backendName = { markdown: "Markdown", github: "GitHub Issues", jira: "Jira" }[s.backend] || s.backend || "—";
  const html = `<div class="board">
    <section class="panel backlog" aria-label="バックログ"><div class="backlog-head"><div class="row-gap"><h1 class="h2" style="font-size:20px;flex:1">バックログ</h1><span class="small muted">置き場：${esc(backendName)}</span></div>
      ${s.backlog_snapshot_at ? `<span class="state po" style="align-self:flex-start">写しの更新 ${esc(when(s.backlog_snapshot_at))}</span>` : ""}
      ${s.backend && s.backend !== "markdown" && !s.backlog_snapshot_at ? '<span class="small muted">バックログの写し（.scrum/backlog-snapshot.json）がまだ無い。スクラムマスターがバックログを読むと作られる。</span>' : ""}
      <div class="chips" role="group" aria-label="状態で絞り込む">${[["all", "すべて"], ["open", "未完了"], ["done", "完了"]].map(([k, l]) => `<button type="button" class="chip" aria-pressed="${f === k}" data-filter="${k}">${l} ${counts[k]}</button>`).join("")}</div></div>
      <div class="backlog-list">${list}</div></section>
    <section class="board-right" aria-label="スプリントボード"><div class="row-gap"><h2 class="h2" style="font-size:20px">スプリントボード</h2><span class="muted small">Sprint ${sp ? sp.number : "—"}</span>
      <span class="spacer"></span><span class="small muted">アイコンは、その PBI を担当した Agent</span></div>
      <div class="columns">${COLUMNS.map(([k, label, slot]) => `<div class="column ${k === "approved" ? "po" : ""}"><div class="column-head">${slot ? `<span class="swatch" style="background:${slot === "po" ? "var(--po-line)" : color(slot)}"></span>` : ""}<span style="flex:1">${label}</span><span>${rowsOf.filter((r) => inCol(k, r)).length}</span></div>${cards(k) || (k === "accepted" && !isPast() && sp && sp.phase !== "closed" ? '<p class="empty">受け入れると、ここに移ってマージされる</p>' : "")}</div>`).join("")}</div></section></div>`;
  put(el, JSON.stringify(["board", selN(), f, items, rowsOf, invs.map((i) => i.agent_id), S.prs, s.backlog_snapshot_at]), html);
}

// ---------- 文書の画面 ----------
function renderDoc(el) {
  el.dataset.layout = "doc";
  const s = sc();
  const sp = sprintOf(selN());
  let body = "";
  if (S.view === "retro") body = `<div class="panel pad"><div class="md">${md((sp && sp.retro) || "このスプリントの振り返りはまだ無い。")}</div></div>`;
  if (S.view === "team") {
    const rows = (s.team || []).map((r) => `<div class="panel row-gap" style="padding:14px 16px;align-items:flex-start"><span class="avatar" style="background:${color(r["枠"])}">${esc(initials(r["Agent"]))}</span>
      <div style="flex:1"><div class="row-gap"><b>${esc(r["Agent"])}</b><span class="small muted">${esc(SLOT_LABEL[r["枠"]] || r["枠"])}</span><code class="muted">${esc(r["出典"] || "")}</code></div><div class="small">${inline(r["選定理由"] || "")}</div></div></div>`).join("");
    body = `<h1 class="h2" style="font-size:20px">チーム編成</h1>${rows || '<p class="empty">チーム編成はまだ無い。インセプションデッキの後にスクラムマスターが提案する。</p>'}
      <h2 class="h2">チーム合意</h2><div class="panel pad"><div class="md">${md(s.agreements || "チーム合意はまだ無い。")}</div></div>`;
  }
  if (S.view === "metrics") body = `<h1 class="h2" style="font-size:20px">指標（スプリントを並べて比べる）</h1><div class="panel pad"><div class="md">${md(s.metrics || "指標はまだ無い。")}</div></div>`;
  if (S.view === "deck") body = `<div class="panel pad"><div class="md">${md(s.inception_deck || "インセプションデッキはまだ無い。")}</div></div>${s.plugin_feedback ? `<div class="panel pad"><div class="md">${md(s.plugin_feedback)}</div></div>` : ""}`;
  put(el, JSON.stringify([S.view, selN(), s.team, s.agreements, s.metrics, s.inception_deck, sp && sp.retro]), `<div class="page"><div class="page-inner">${body}</div></div>`);
}
function renderHistory(el) {
  el.dataset.layout = "history";
  if (S.sessions == null) loadSessions();
  const r = S.runner || {};
  const locked = r.status === "running" || r.status === "waiting";
  const rows = (S.sessions || []).map((x) => `<div class="panel row-gap" style="padding:14px 16px;align-items:flex-start">
    <div style="flex:1;min-width:0"><div class="row-gap"><b>${esc(when(x.started))}〜${esc(hm(x.updated))}</b><code class="muted">${esc(x.id.slice(0, 8))}</code>
      ${x.id === LIVE.session ? '<span class="state po">表示中</span>' : ""}${x.id === r.session_id ? '<span class="state">前回操作</span>' : ""}</div>
      <div class="ellipsis">${esc(x.first_prompt || "—")}</div><div class="small muted clamp2">最後：${esc(x.last_prompt || "—")}</div>
      <div class="small muted">Agent ${x.agents}件${x.cost != null ? ` · $${Number(x.cost).toFixed(2)}` : ""}</div></div>
    <button type="button" class="btn" data-modal="${esc(x.id)}">会話を開く</button>
    <button type="button" class="btn" data-resume="${esc(x.id)}" ${locked ? "disabled" : ""}>再開</button></div>`).join("");
  put(el, JSON.stringify(["history", S.sessions, r.status, r.session_id, LIVE.session]),
    `<div class="page"><div class="page-inner"><h1 class="h2" style="font-size:20px">セッションの履歴</h1>${locked ? '<p class="small muted">操作中のセッションがあるため、別のセッションの再開はできない。先に停止する。</p>' : ""}${rows || '<p class="empty">読み込み中…</p>'}</div></div>`);
}

// ---------- 会話（全文） ----------
function msgHtml(m, key) {
  const t = `<span class="meta">${hm(m.ts)}</span>`;
  if (m.kind === "tool") return `<div class="msg tool" title="${esc(m.text)}">${hm(m.ts)} ${esc(m.text)}</div>`;
  if (m.kind === "notice") return `<div class="msg notice">${hm(m.ts)} ✓ ${esc(m.text)}</div>`;
  if (m.kind === "error") return `<div class="msg error">${hm(m.ts)} ⚠ ${esc(m.text)}</div>`;
  if (m.kind === "po") return `<div class="msg">${t} <b>PO</b><div class="bubble po">${inline(m.text)}</div></div>`;
  if (m.kind === "request") {
    const lines = m.text.split("\n");
    const full = S.openedFull.has(key) || lines.length <= REQUEST_LINES;
    return `<div class="msg">${t} <b>依頼</b><div class="bubble md">${md(full ? m.text : lines.slice(0, REQUEST_LINES).join("\n"))}${full ? "" : `<button type="button" class="link-btn" data-full="${esc(key)}">残り${lines.length - REQUEST_LINES}行を表示</button>`}</div></div>`;
  }
  return `<div class="msg">${t}<div class="md">${md(m.text)}</div></div>`;
}
function renderModal() {
  const el = $("overlay");
  if (!S.modal) { if (el.innerHTML) { el.innerHTML = ""; S.keys.overlay = null; } return; }
  const store = S.modal === LIVE.session ? LIVE : CACHE.get(S.modal);
  if (!store) { loadSession(S.modal); put(el, "loading", `<div class="overlay"><div class="modal"><div class="modal-head"><b>読み込み中…</b></div></div></div>`); return; }
  const main = store.msgs.get("main") || [];
  const agents = store.order.map((id) => ({ ...store.agents.get(id), msgs: store.msgs.get(id) || [] }))
    .sort((x, y) => ms((x.msgs[0] || {}).ts) - ms((y.msgs[0] || {}).ts));
  const info = (S.sessions || []).find((x) => x.id === S.modal) || {};
  put(el, JSON.stringify([S.modal, main.length, agents.map((a) => [a.status, a.msgs.length]), [...S.openAgents].join(), [...S.openedFull].join()]),
    `<div class="overlay" data-close="1"><div class="modal" role="dialog" aria-label="会話"><div class="modal-head"><b>会話</b><span class="muted">${esc(when(info.started))}</span><code class="muted">${esc(S.modal.slice(0, 8))}</code><span class="spacer"></span>
      <button type="button" class="icon-btn" data-close="1" aria-label="閉じる"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12"></path></svg></button></div>
      <div class="modal-body"><div class="feed"><div class="label">スクラムマスター</div>${main.map((m, k) => msgHtml(m, `m:${S.modal}:${k}`)).join("") || '<p class="empty">発言は無い。</p>'}</div>
      <div class="feed"><div class="label">Agent（${agents.length}）</div>${agents.map((a) => {
        const open = S.openAgents.has(a.agent_id);
        return `<div class="acard"><div class="acard-head" data-agent="${esc(a.agent_id)}"><span class="avatar sm" style="background:${color(slotOf(a.role))}">${esc(initials(a.role))}</span><b>${esc(a.role)}</b><span class="ellipsis small" style="flex:1">${esc(a.description)}</span><span class="small muted">操作 ${a.msgs.filter((m) => m.kind === "tool").length}</span></div>
          ${open ? `<div class="acard-body">${a.msgs.map((m, k) => msgHtml(m, `a:${a.agent_id}:${k}`)).join("")}</div>` : ""}</div>`;
      }).join("") || '<p class="empty">Agent は動いていない。</p>'}</div></div></div></div>`);
}

// ---------- 操作 ----------
function send(text) {
  text = (text || "").trim();
  if (!text) return;
  S.draft = "";
  S.keys.c1 = null;
  api("/api/message", { text }).catch((e) => alertInline(e.message));
}
function alertInline(message) {
  const el = $("c1") || $("view");
  el.insertAdjacentHTML("afterbegin", `<div class="notice-card warn small">${esc(message)}</div>`);
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-view],[data-sprint],[data-action],[data-send],[data-prefill],[data-select],[data-full],[data-filter],[data-modal],[data-close],[data-agent],[data-resume]");
  if (!t) { if (S.switcher && !e.target.closest(".sprint-menu")) { S.switcher = false; schedule(); } return; }
  // 会話の画面は、背景か閉じるボタンを押したときだけ閉じる
  if (t.dataset.close && t.classList.contains("overlay") && e.target !== t) return;
  if (t.dataset.view) { S.view = t.dataset.view; S.switcher = false; }
  else if (t.dataset.sprint !== undefined) { S.sprintSel = t.dataset.sprint ? Number(t.dataset.sprint) : null; S.switcher = false; S.selected = null; S.keys.c1 = null; if (S.sessions == null) loadSessions(); }
  else if (t.dataset.action === "switcher") { S.switcher = !S.switcher; if (S.sessions == null) loadSessions(); }
  else if (t.dataset.send) send(t.dataset.send);
  else if (t.dataset.prefill) {
    S.draft = t.dataset.prefill; S.keys.c1 = null; schedule();
    setTimeout(() => { const i = $("po-input"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 50);
    return;
  }
  else if (t.dataset.select) S.selected = t.dataset.select;
  else if (t.dataset.full) { if (S.openedFull.has(t.dataset.full)) S.openedFull.delete(t.dataset.full); else S.openedFull.add(t.dataset.full); S.keys.c1 = null; }
  else if (t.dataset.filter) S.backlogFilter = t.dataset.filter;
  else if (t.dataset.modal) { S.modal = t.dataset.modal; if (S.sessions == null) loadSessions(); }
  else if (t.dataset.close) S.modal = null;
  else if (t.dataset.agent) { if (S.openAgents.has(t.dataset.agent)) S.openAgents.delete(t.dataset.agent); else S.openAgents.add(t.dataset.agent); }
  else if (t.dataset.resume) { api("/api/session/start", { resume: t.dataset.resume, message: "続けて。" }).then(() => { S.view = "sprint"; schedule(); }).catch((err) => alertInline(err.message)); }
  else if (t.dataset.action === "send") send($("po-input") && $("po-input").value);
  else if (t.dataset.action === "stop") api("/api/session/stop").catch((err) => alertInline(err.message));
  else if (t.dataset.action === "start") {
    const resume = $("resume") && $("resume").checked;
    const message = ($("po-input") && $("po-input").value.trim()) || "";
    S.draft = "";
    S.keys.c1 = null;
    api("/api/session/start", { resume, message }).catch((err) => alertInline(err.message));
  }
  schedule();
});
document.addEventListener("input", (e) => { if (e.target.id === "po-input") S.draft = e.target.value; });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (S.modal || S.switcher)) { S.modal = null; S.switcher = false; schedule(); }
  if (e.target.id === "po-input" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const r = S.runner || {};
    if (r.status === "waiting" && r.session_id) send(e.target.value);
  }
});

loadSessions();
connect();
