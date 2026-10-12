// scrum ペインと帯の描画。要素は register.ts が $.ui.resolve(e) で得て渡す。

import { type Entry, type Run, SM, headline, pbiIn } from './log'
import type { Item, Row, ScrumState, Sprint } from './scrum'

// 要素の関数。props の検査は Claude Code が描画時に行う
type Node = unknown
type Element = (props: Record<string, unknown>) => Node
export type Elements = {
  Box: Element
  Text: Element
  Button: Element
  Markdown: Element
  Code: Element
  Image?: Element
}

export type Region = 'backlog' | 'kanban' | 'log'
export type Doc = 'demo' | 'retro' | 'team' | 'metrics' | 'deck'
export type Screen =
  | { kind: 'home' }
  | { kind: 'zoom'; region: Region }
  | { kind: 'agent'; role: string }
  | { kind: 'pbi'; id: string }
  | { kind: 'entry'; id: string }
  | { kind: 'docs'; doc: Doc }
  | { kind: 'sprints' }

export const REGIONS: Region[] = ['backlog', 'kanban', 'log']
export const DOCS: [Doc, string][] = [['demo', 'デモ'], ['retro', '振り返り'], ['team', 'チーム'], ['metrics', '指標'], ['deck', 'デッキ']]
const REGION_LABEL: Record<Region, string> = { backlog: 'バックログ', kanban: 'カンバン', log: 'Agent の会話' }
// キーの先頭で、フォーカスのある区画を見分ける
export const REGION_PREFIX: Record<Region, string> = { backlog: 'bl-', kanban: 'kb-', log: 'lg-' }

const PHASES: Record<string, string> = {
  refinement: 'リファインメント', planning: '計画', execution: '実行', demo: 'デモ準備',
  review: 'レビュー', retrospective: 'レトロ', closed: '終了',
}
const STATES: Record<string, [string, string?]> = {
  todo: ['未着手'], design: ['デザイン', 'remember'], dev: ['実装', 'suggestion'], review: ['レビュー', 'merged'],
  approved: ['PO', 'warning'], accepted: ['完了', 'success'], rejected: ['却下', 'error'], blocked: ['中断', 'error'],
}
// カンバンの段階。進行レーンの ● の並びと、列の並び
const STAGES = ['design', 'dev', 'review', 'approved', 'accepted']
const COLUMNS = ['todo', ...STAGES]
const SLOT_COLOR: Record<string, string> = {
  implement: 'suggestion', design: 'remember', 'code-review': 'merged', 'security-review': 'permission', 'extra-review': 'planMode',
}
const SLOT_STAGE: Record<string, string> = {
  implement: '実装', design: 'デザイン', 'code-review': 'レビュー', 'security-review': 'セキュリティ', 'extra-review': 'レビュー',
}
// ペインがこの幅以上なら、ホームを 2×2 にする（230 桁前後の端末でペインが開く幅）
const GRID_COLUMNS = 84
// 操作が途絶えたら止まっている疑いとみなす時間
export const STALL_MS = 10 * 60_000
// Markdown 要素が受け付ける長さ
const MARKDOWN_LIMIT = 10000

export type LiveAgent = { id: string; role: string; description: string; status: string; last: string | null; lastAt: number | null }
export type Interrupted = { role: string; description: string; worktree: string | null }
export type Pr = { number: number; url: string; state: string; check: string }

export type Model = {
  state: ScrumState
  selected: number | null
  screen: Screen
  canBack: boolean
  agents: LiveAgent[]
  runs: Map<string, Run>
  entries: Entry[]
  logLoading: boolean
  showOps: boolean
  pages: Record<Region, number>
  focus: Region
  single: Region
  interrupted: Interrupted[]
  prs: Map<string, Pr | null>
  surface: string
  root: string
  now: number
  columns: number
  rows: number
  placement: string
}

export type Actions = {
  open: (s: Screen) => void
  back: () => void
  page: (delta: number) => void
  toggleOps: () => void
  zoom: () => void
  single: (r: Region) => void
  sprint: (n: number | null) => void
  accept: () => void
  reject: () => void
}

type Key = [string, string, () => void]

// ---------- 文字の幅と行 ----------
type Seg = string | { t: string; color?: string; dim?: boolean; bold?: boolean }

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
const charWidth = (c: string) => (WIDE.test(c) ? 2 : 1)
export const width = (s: string) => [...s].reduce((a, c) => a + charWidth(c), 0)
const textOf = (s: Seg) => (typeof s === 'string' ? s : s.t)

/** 表示幅で切り詰める。ボタンは折り返しを止められないため、中身をここで切る。 */
export function clip(segs: Seg[], max: number): Seg[] {
  const out: Seg[] = []
  let used = 0
  for (const s of segs) {
    const t = textOf(s).replace(/\s*\n\s*/g, ' ')
    const w = width(t)
    if (used + w <= max) {
      out.push(typeof s === 'string' ? t : { ...s, t })
      used += w
      continue
    }
    let cut = ''
    for (const c of t) {
      if (used + width(cut) + charWidth(c) > max - 1) break
      cut += c
    }
    out.push(typeof s === 'string' ? cut + '…' : { ...s, t: cut + '…' })
    break
  }
  return out
}

const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)))

function spans(el: Elements, segs: Seg[]): Node[] {
  return segs.filter(s => textOf(s) !== '').map(s => (typeof s === 'string' ? s : el.Text({
    ...(s.color ? { color: s.color } : {}), ...(s.dim ? { dimColor: true } : {}), ...(s.bold ? { bold: true } : {}), children: [s.t],
  })))
}

function line(el: Elements, segs: Seg[]): Node {
  return el.Text({ wrap: 'truncate-end', children: spans(el, segs) })
}

function pick(el: Elements, key: string, segs: Seg[], w: number, onPress: () => void, autoFocus = false): Node {
  return el.Button({ key, plain: true, onPress, ...(autoFocus ? { autoFocus: true } : {}), children: spans(el, clip(segs, w)) })
}

const hm = (ts: number) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const ago = (now: number, ts: number) => {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  return s < 60 ? `${s}秒前` : s < 3600 ? `${Math.floor(s / 60)}分前` : `${Math.floor(s / 3600)}時間前`
}
const span = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}分` : `${(ms / 3_600_000).toFixed(1)}時間`)
const day = (t: string | null) => {
  const d = new Date(t ?? '')
  return isNaN(d.getTime()) ? '—' : `${d.getMonth() + 1}/${d.getDate()}`
}

// ---------- スプリントとチーム ----------
export function sprintOf(state: ScrumState, n: number | null): Sprint | null {
  const want = n ?? state.latest
  return state.sprints.find(s => s.number === want) ?? null
}

/** 最新のスプリントが終わっていれば、次のスプリントは準備中（リファインメント・計画）である。 */
export function isPreparing(state: ScrumState): boolean {
  const latest = sprintOf(state, null)
  return !latest || latest.phase === 'closed'
}

const isPast = (m: Model) => m.selected != null && m.selected !== m.state.latest

function slotOf(m: Model, role: string): string {
  if (role === SM) return 'sm'
  const sp = sprintOf(m.state, m.selected)
  const row = (sp?.team ?? m.state.team).find(r => r['Agent'] === role)
  return row?.['枠'] ?? 'general'
}

const roleSeg = (m: Model, role: string, bold = false): Seg =>
  ({ t: role, color: role === SM ? 'claude' : SLOT_COLOR[slotOf(m, role)] ?? 'ide', bold })

/** スプリントの期間（前のスプリントの終了から、このスプリントの終了まで）。 */
export function windowOf(state: ScrumState, n: number | null): { start: number | null; end: number | null } {
  const sp = sprintOf(state, n)
  if (!sp || (n == null && sp.phase === 'closed')) {
    // 準備中：最新のスプリントの終了から今まで
    return { start: sp?.closed ? Date.parse(sp.closed) : null, end: null }
  }
  const prev = state.sprints.find(s => s.number === sp.number - 1)
  return {
    start: prev?.closed ? Date.parse(prev.closed) : null,
    end: sp.phase === 'closed' && sp.closed ? Date.parse(sp.closed) + 60_000 : null,
  }
}

function pbiIds(m: Model): string[] {
  const sp = sprintOf(m.state, m.selected)
  return [...new Set([...(sp?.pbis.map(r => r['PBI'] ?? '') ?? []), ...m.state.backlog.map(b => b.id)])].filter(Boolean)
}

// ---------- 全体 ----------
export function render(el: Elements, m: Model, act: Actions): Node {
  const { Box, Text } = el
  if (!m.state.initialized) {
    return Box({
      flexDirection: 'column',
      children: [
        Text({ bold: true, children: ['.scrum/ がまだ無い'] }),
        Text({ dimColor: true, children: ['/scrum-team:run-sprint でスプリントを始めると作られる。'] }),
      ],
    })
  }
  const s = m.screen
  if (s.kind === 'home') return home(el, m, act)
  if (s.kind === 'zoom') return zoom(el, m, act, s.region)
  if (s.kind === 'agent') return agentScreen(el, m, act, s.role)
  if (s.kind === 'pbi') return pbiScreen(el, m, act, s.id)
  if (s.kind === 'entry') return entryScreen(el, m, act, s.id)
  if (s.kind === 'docs') return docsScreen(el, m, act, s.doc)
  return sprintsScreen(el, m, act)
}

function keys(el: Elements, items: Key[]): Node {
  return el.Box({
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 2,
    children: items.map(([hotkey, label, onPress]) => el.Button({ key: `key-${hotkey}`, label, hotkey, plain: true, dimColor: true, onPress })),
  })
}

function sprintSegs(m: Model): Seg[] {
  const s = m.state
  const sp = sprintOf(s, m.selected)
  if (!isPast(m) && isPreparing(s)) {
    return [{ t: `Sprint ${(s.latest ?? 0) + 1}`, bold: true }, ' ', { t: '準備中（リファインメント・計画）', color: 'warning' }]
  }
  if (!sp) return [{ t: 'スプリントはまだ無い', dim: true }]
  const points = sp.pbis.reduce((a, r) => a + (Number(r['points']) || 0), 0)
  return [
    { t: `Sprint ${sp.number}`, bold: true }, ' ',
    { t: PHASES[sp.phase ?? ''] ?? sp.phase ?? '—', color: isPast(m) ? 'inactive' : 'claude' }, ' ',
    ...(isPast(m) ? [{ t: '閲覧のみ ', color: 'warning' }] : []),
    { t: `${points} / ${s.capacity || '—'}pt `, dim: true },
    { t: sp.goal ? `ゴール：${sp.goal}` : '', dim: true },
  ]
}

function subHeader(el: Elements, m: Model, act: Actions, segs: Seg[], extra: Key[] = []): Node {
  return el.Box({
    flexDirection: 'column',
    marginBottom: 1,
    children: [line(el, segs), keys(el, [...(m.canBack ? [['b', '戻る', act.back] as Key] : []), ...extra])],
  })
}

// ---------- ホーム ----------
type Line = { key?: string; segs: Seg[]; target?: Screen }

function home(el: Elements, m: Model, act: Actions): Node {
  const { Box } = el
  const single = m.placement === 'inline'
  const grid = !single && m.columns >= GRID_COLUMNS
  const sp = sprintOf(m.state, m.selected)
  const top: Node[] = [line(el, sprintSegs(m))]
  // キーの案内は最下段に置き、矢印キーで区画の行から選べるようにする
  const bottom = keys(el, [
    ['s', 'スプリント', () => act.open({ kind: 'sprints' })],
    ['v', '表示', () => act.open({ kind: 'docs', doc: 'demo' })],
    ['z', '拡大', act.zoom],
    ['o', m.showOps ? '操作を隠す' : '操作', act.toggleOps],
    ['n', '次', () => act.page(1)],
    ['p', '前', () => act.page(-1)],
    ...(single ? REGIONS.map((r, i) => [String(i + 1), REGION_LABEL[r], () => act.single(r)] as Key) : []),
  ])
  // キーの行が折り返す分も見込む
  let used = 2 + (m.columns < 64 ? 1 : 0)
  if (!isPast(m) && m.interrupted.length) {
    top.push(interruptedBox(el, m))
    used += m.interrupted.length + 3
  }
  if (!isPast(m) && sp?.phase === 'review') {
    const scenes = (sp.demo?.results.length ? sp.demo.results : sp.demo?.scenes ?? []).slice(0, 4)
    top.push(acceptance(el, sp, act, scenes))
    used += scenes.length + 5
  }
  const avail = Math.max(9, m.rows - used)
  const inner = m.columns - 1
  if (single) return Box({ flexDirection: 'column', children: [...top, region(el, m, act, m.single, avail, inner, true), bottom] })
  if (grid) {
    const half = Math.floor((m.columns - 2) / 2)
    const need = Math.max(regionLines(m, 'backlog', half).lines.length, regionLines(m, 'kanban', half).lines.length) + 1
    const upper = Math.max(4, Math.min(need, Math.floor(avail * 0.45)))
    return Box({
      flexDirection: 'column',
      children: [
        ...top,
        Box({ flexDirection: 'row', columnGap: 2, children: [region(el, m, act, 'backlog', upper, half), region(el, m, act, 'kanban', upper, half)] }),
        region(el, m, act, 'log', avail - upper, inner),
        bottom,
      ],
    })
  }
  // 中身が少ない区画は縮め、余った行を会話に回す
  const need = (r: Region) => regionLines(m, r, inner).lines.length + 1
  const hb = Math.max(3, Math.min(need('backlog'), Math.floor(avail * 0.25)))
  const hk = Math.max(3, Math.min(need('kanban'), Math.floor(avail * 0.4)))
  return Box({
    flexDirection: 'column',
    children: [...top, region(el, m, act, 'backlog', hb, inner), region(el, m, act, 'kanban', hk, inner), region(el, m, act, 'log', Math.max(4, avail - hb - hk), inner), bottom],
  })
}

function regionLines(m: Model, r: Region, w: number, all = false): { lines: Line[]; note: string } {
  return r === 'backlog' ? backlogLines(m, w, all) : r === 'kanban' ? kanbanLines(m, w) : logLines(m)
}

function draw(el: Elements, act: Actions, l: Line, w: number, autoFocus = false): Node {
  const target = l.target
  return target && l.key ? pick(el, l.key, l.segs, w, () => act.open(target), autoFocus) : el.Text({ wrap: 'truncate-end', children: spans(el, clip(l.segs, w)) })
}

/** 高さを固定した区画。収まらない行はページに分け、n・p で送る。 */
function region(el: Elements, m: Model, act: Actions, r: Region, height: number, w: number, single = false): Node {
  const { lines, note } = regionLines(m, r, w)
  const per = Math.max(1, height - 1)
  const pages = Math.max(1, Math.ceil(lines.length / per))
  const page = Math.min(m.pages[r], pages - 1)
  // 会話は新しいものを下に置き、最初のページを最新にする
  const shown = r === 'log'
    ? lines.slice(Math.max(0, lines.length - per * (page + 1)), lines.length - per * page)
    : lines.slice(page * per, (page + 1) * per)
  const focused = m.focus === r || single
  return el.Box({
    flexDirection: 'column',
    height,
    width: w,
    overflow: 'hidden',
    children: [
      line(el, [{ t: `${focused && !single ? '▍' : ' '}${REGION_LABEL[r]}`, bold: true, ...(focused && !single ? { color: 'claude' } : {}) }, ' ', { t: note, dim: true },
        { t: pages > 1 ? `  ${page + 1}/${pages}` : '', dim: true }]),
      // ペインに移ったとき、フォーカスのある区画の最初の行から選べるようにする
      ...(shown.length ? shown.map((l, i) => draw(el, act, l, w, focused && i === shown.findIndex(x => x.target))) : [line(el, [{ t: ' —', dim: true }])]),
    ],
  })
}

function backlogLines(m: Model, w: number, all = false): { lines: Line[]; note: string } {
  const sp = sprintOf(m.state, m.selected)
  const inSprint = new Set(sp?.pbis.map(r => r['PBI']) ?? [])
  const next = m.state.backlog.filter(b => !inSprint.has(b.id) && b.status !== 'done' && b.status !== 'sprint')
  const done = m.state.backlog.filter(b => b.status === 'done' || b.sprint != null)
  const item = (b: Item): Line => ({
    key: `${REGION_PREFIX.backlog}${b.id}`,
    segs: [
      { t: b.status === 'ready' ? ' ● ' : b.status === 'done' ? ' ✓ ' : ' ○ ', color: b.status === 'ready' ? 'success' : 'inactive' },
      `${b.id} `, textOf(clip([b.title], Math.max(8, w - width(b.id) - 14))[0]!), ' ',
      { t: b.status === 'done' ? `Sprint ${b.sprint ?? '—'}` : b.points ? `${b.points}pt` : '未見積り', dim: true },
    ],
    target: { kind: 'pbi', id: b.id },
  })
  const at = m.state.backlogSnapshotAt ? ` · ${day(m.state.backlogSnapshotAt)} 時点` : ''
  return { lines: [...next.map(item), ...(all ? done.map(item) : [])], note: `次の候補 ${next.length} · 完了 ${done.length}${at}` }
}

/** PBI に取り組んでいる、実行中の Agent。 */
function workersOf(m: Model, id: string): LiveAgent[] {
  return m.agents.filter(a => a.status === 'running' && pbiIn(a.description, [id]))
}

function lane(state: string): Seg[] {
  const at = STAGES.indexOf(state)
  const segs: Seg[] = []
  STAGES.forEach((_, i) => {
    if (i) segs.push({ t: i <= at ? '━' : '─', color: i <= at ? 'success' : 'inactive' })
    segs.push(i < at ? { t: '●', color: 'success' } : i === at ? { t: '◉', color: STATES[state]?.[1] ?? 'claude', bold: true } : { t: '○', color: 'inactive' })
  })
  return segs
}

function agentLine(m: Model, a: LiveAgent): Seg[] {
  const stalled = a.lastAt != null && m.now - a.lastAt > STALL_MS
  return [
    '   └ ', { t: '● ', color: stalled ? 'warning' : 'success' }, roleSeg(m, a.role), '  ',
    { t: a.last ?? a.description, ...(stalled ? { color: 'warning' } : { dim: true }) },
    { t: a.lastAt != null ? `  ${ago(m.now, a.lastAt)}` : '', dim: true },
  ]
}

function kanbanLines(m: Model, w: number): { lines: Line[]; note: string } {
  const sp = sprintOf(m.state, m.selected)
  const titles = new Map(m.state.backlog.map(b => [b.id, b.title]))
  const lines: Line[] = []
  const nameW = Math.max(10, w - 23)
  const matched = new Set<string>()
  for (const row of sp?.pbis ?? []) {
    const id = row['PBI'] ?? ''
    const state = row['状態'] ?? 'todo'
    const [label, color] = STATES[state] ?? [state]
    const name = textOf(clip([` ${id} ${titles.get(id) ?? ''}`], nameW)[0]!)
    lines.push({
      key: `${REGION_PREFIX.kanban}${id}`,
      segs: [pad(name, nameW), ' ', ...lane(state), ' ', { t: label!, ...(color ? { color } : { dim: true }) },
        { t: Number(row['差し戻し']) ? ` ↺${row['差し戻し']}` : '', color: 'warning' }],
      target: { kind: 'pbi', id },
    })
    for (const a of isPast(m) ? [] : workersOf(m, id)) {
      matched.add(a.id)
      lines.push({ segs: agentLine(m, a) })
    }
  }
  const others = isPast(m) ? [] : m.agents.filter(a => a.status === 'running' && !matched.has(a.id))
  for (const a of others) {
    lines.push({ key: `${REGION_PREFIX.kanban}agent-${a.id}`, segs: [' ', { t: '● ', color: 'success' }, roleSeg(m, a.role), '  ', { t: a.description, dim: true }], target: { kind: 'agent', role: a.role } })
  }
  const running = isPast(m) ? 0 : m.agents.filter(a => a.status === 'running').length
  return { lines, note: running ? `${running} 人が作業中` : '' }
}

/** 会話の行。操作は、同じ役割の Agent が続けて行った分を1行に畳む。 */
function logRows(m: Model, entries: Entry[]): { entry: Entry; ops?: number }[] {
  const out: { entry: Entry; ops?: number }[] = []
  for (const e of entries) {
    const last = out.at(-1)
    if (e.kind === 'op' && !m.showOps) {
      if (last?.ops && last.entry.role === e.role) last.ops += 1
      else out.push({ entry: e, ops: 1 })
    } else {
      out.push({ entry: e })
    }
  }
  return out
}

function entrySegs(m: Model, e: Entry, ops?: number): Seg[] {
  const time: Seg = { t: ` ${hm(e.ts)} `, dim: true }
  if (ops) return [time, roleSeg(m, e.role), { t: ` の操作 ${ops} 件 ▸ ${e.text}`, dim: true }]
  if (e.kind === 'op') return [time, roleSeg(m, e.role), { t: `  ${e.text}`, dim: true }]
  if (e.verdict) {
    const ok = e.verdict.verdict === 'approve'
    return [time, roleSeg(m, e.role), '  ', { t: ok ? '✓ approve' : '✗ request-changes', color: ok ? 'success' : 'error', bold: true },
      { t: `  must ${e.verdict.must} / should ${e.verdict.should}${e.verdict.tests ? ` · テスト ${e.verdict.tests} 件` : ''}`, dim: true }]
  }
  if (e.error) return [time, roleSeg(m, e.role), { t: `  ⚠ ${headline(e.text)}`, color: 'error' }]
  if (e.kind === 'request') return [time, roleSeg(m, e.from ?? SM), ' → ', roleSeg(m, e.role), `  ${headline(e.text)}`]
  if (e.kind === 'send') return [time, roleSeg(m, e.role), ' → ', roleSeg(m, e.to ?? '?'), `  ${headline(e.text)}`]
  return [time, roleSeg(m, e.role), `  ${headline(e.text)}`]
}

function logLines(m: Model): { lines: Line[]; note: string } {
  return {
    lines: logRows(m, m.entries).map(({ entry, ops }) => ({
      key: `${REGION_PREFIX.log}${entry.id}`,
      segs: entrySegs(m, entry, ops),
      target: ops || entry.kind === 'op' ? { kind: 'agent', role: entry.role } : { kind: 'entry', id: entry.id },
    })),
    note: m.logLoading ? '読み込み中…' : m.showOps ? '操作を表示中' : '操作は畳む',
  }
}

function interruptedBox(el: Elements, m: Model): Node {
  return el.Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: 'warning',
    paddingX: 1,
    children: [
      el.Text({ color: 'warning', bold: true, children: ['前回、作業中のまま止まった Agent'] }),
      ...m.interrupted.map(a => line(el, [`- ${a.role}：${a.description}`, { t: `（${a.worktree ?? '元のリポジトリ'}）`, dim: true }])),
      el.Text({ dimColor: true, children: ['次の入力と一緒にスクラムマスターへ伝える。'] }),
    ],
  })
}

// レビューでは、PBI ごとではなく、デモで見たもの全体を受け入れるかを判断する
function acceptance(el: Elements, sp: Sprint, act: Actions, scenes: Row[]): Node {
  const { Box, Text, Button } = el
  const demo = sp.demo
  const total = demo?.results.length ?? 0
  return Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: 'warning',
    paddingX: 1,
    children: [
      line(el, [{ t: `PO の判定（${sp.judgements.length + 1}回目）`, color: 'warning', bold: true }, { t: '  デモで見たもの全体を受け入れるか', dim: true }]),
      ...scenes.map(r => {
        const judged = r['判定'] != null
        const ok = r['判定'] === '一致'
        return line(el, [{ t: !judged ? '· ' : ok ? '✓ ' : '! ', color: !judged ? 'inactive' : ok ? 'success' : 'error' }, `${r['#'] ?? ''}. ${r['期待する結果'] ?? ''}`])
      }),
      Text({ dimColor: true, children: [total ? `リハーサル：${demo!.matched} / ${total} 場面が一致` : 'リハーサルの記録はまだ無い'] }),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Button({ key: 'accept', label: '受け入れる', onPress: () => act.accept() }),
          Button({ key: 'reject', label: '差し戻す（違う点を書く）', onPress: () => act.reject() }),
          Button({ key: 'key-d', label: 'デモの詳細', hotkey: 'd', plain: true, dimColor: true, onPress: () => act.open({ kind: 'docs', doc: 'demo' }) }),
        ],
      }),
    ],
  })
}

// ---------- 拡大 ----------
function zoom(el: Elements, m: Model, act: Actions, r: Region): Node {
  const { Box } = el
  const w = m.columns - 1
  const head = subHeader(el, m, act, [{ t: REGION_LABEL[r], bold: true, color: 'claude' }, '  ', ...sprintSegs(m)], [
    ['z', '戻す', act.zoom],
    ...(r === 'log' ? [['o', m.showOps ? '操作を隠す' : '操作', act.toggleOps] as Key] : []),
  ])
  if (r === 'kanban' && w >= 72) return Box({ flexDirection: 'column', children: [head, columns(el, m, act, w)] })
  const { lines } = regionLines(m, r, w, true)
  return Box({ flexDirection: 'column', children: [head, ...(r === 'log' ? lines.slice(-300) : lines).map(l => draw(el, act, l, w))] })
}

function columns(el: Elements, m: Model, act: Actions, w: number): Node {
  const { Box, Text } = el
  const sp = sprintOf(m.state, m.selected)
  const titles = new Map(m.state.backlog.map(b => [b.id, b.title]))
  const colW = Math.floor((w - COLUMNS.length + 1) / COLUMNS.length)
  const rows = sp?.pbis ?? []
  const card = (row: Row) => {
    const id = row['PBI'] ?? ''
    const state = row['状態'] ?? 'todo'
    const workers = isPast(m) ? [] : workersOf(m, id)
    const pr = m.prs.get(row['ブランチ'] ?? '')
    const facts = [row['points'] ? `${row['points']}pt` : '', Number(row['差し戻し']) ? `差し戻し ${row['差し戻し']}` : ''].filter(Boolean).join(' · ')
    return Box({
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: workers.length ? 'success' : state === 'approved' ? 'warning' : 'inactive',
      width: colW,
      children: [
        pick(el, `${REGION_PREFIX.kanban}${id}`, [{ t: id, bold: true }], colW - 2, () => act.open({ kind: 'pbi', id })),
        Text({ wrap: 'truncate-end', dimColor: true, children: [titles.get(id) || ' '] }),
        ...(facts ? [Text({ wrap: 'truncate-end', color: Number(row['差し戻し']) ? 'warning' : 'inactive', children: [facts] })] : []),
        ...workers.map(a => line(el, [{ t: '●', color: 'success' }, roleSeg(m, a.role)])),
        ...workers.slice(0, 1).filter(a => a.last).map(a => Text({ wrap: 'truncate-end', dimColor: true, children: [`${a.last!.split(' ')[0]}${a.lastAt != null ? ` · ${ago(m.now, a.lastAt)}` : ''}`] })),
        ...(pr ? [Text({ wrap: 'truncate-end', color: pr.check === 'success' ? 'success' : pr.check === 'failure' ? 'error' : 'inactive', children: [`PR #${pr.number}`] })] : []),
      ],
    })
  }
  const extra = rows.filter(r => !COLUMNS.includes(r['状態'] ?? ''))
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: COLUMNS.map(state => {
          const cards = rows.filter(r => (r['状態'] || 'todo') === state)
          return Box({
            flexDirection: 'column',
            width: colW,
            children: [line(el, [{ t: STATES[state]![0], bold: true }, { t: ` ${cards.length}`, dim: true }]), ...cards.map(card)],
          })
        }),
      }),
      ...(extra.length ? [line(el, [{ t: '中断・却下：', color: 'error' }, extra.map(r => r['PBI']).join('、')])] : []),
    ],
  })
}

// ---------- Agent ----------
function agentScreen(el: Elements, m: Model, act: Actions, role: string): Node {
  const { Box, Text } = el
  const w = m.columns - 1
  const mine = m.entries.filter(e => e.role === role || (e.kind === 'send' && e.to === role))
  const runs = [...m.runs.values()].filter(r => r.role === role)
  const live = m.agents.filter(a => a.role === role)
  const running = live.some(a => a.status === 'running')
  const first = mine[0]?.ts ?? 0
  const last = mine.at(-1)?.ts ?? 0
  const head = subHeader(el, m, act, [
    roleSeg(m, role, true), { t: `  ${slotOf(m, role)}`, dim: true },
    { t: running ? '  作業中' : '', color: 'success' },
    { t: `  起動 ${runs.length} 回${mine.length ? ` · ${hm(first)}〜${hm(last)}（${span(last - first)}）` : ''}`, dim: true },
  ], [['o', m.showOps ? '操作を隠す' : '操作を表示', act.toggleOps]])
  const body: Node[] = []
  for (const { entry: e, ops } of logRows(m, mine)) {
    const key = `ag-${e.id}`
    const time: Seg = { t: `${hm(e.ts)} `, dim: true }
    const open = () => act.open({ kind: 'entry', id: e.id })
    if (ops) {
      body.push(line(el, [time, { t: `  操作 ${ops} 件 ▸ ${e.text}${ops > 1 ? ' ほか' : ''}`, dim: true }]))
    } else if (e.kind === 'op') {
      body.push(line(el, [time, { t: `  ${e.text}`, dim: true }]))
    } else if (e.error) {
      body.push(line(el, [time, { t: `⚠ ${headline(e.text)}`, color: 'error' }]))
    } else if (e.verdict) {
      const ok = e.verdict.verdict === 'approve'
      const notes = e.text.split('\n').filter(l => /\[(must|should)\]/.test(l)).slice(0, 4)
      body.push(Box({
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: ok ? 'success' : 'error',
        paddingX: 1,
        children: [
          pick(el, key, [time, { t: ok ? '✓ approve' : '✗ request-changes', color: ok ? 'success' : 'error', bold: true },
            { t: `  must ${e.verdict.must} / should ${e.verdict.should}${e.verdict.tests ? ` · テスト ${e.verdict.tests} 件` : ''}`, dim: true }], w - 4, open),
          ...notes.map(n => Text({ wrap: 'truncate-end', dimColor: true, children: [n.replace(/^[-*\s]+/, '')] })),
        ],
      }))
    } else {
      const who: Seg[] = e.kind === 'request' ? [roleSeg(m, e.from ?? SM), ' からの依頼']
        : e.kind === 'send' && e.role === role ? ['→ ', roleSeg(m, e.to ?? '?')]
          : e.kind === 'send' ? [roleSeg(m, e.role), ' から'] : ['発言']
      body.push(pick(el, key, [time, ...who], w, open))
      body.push(Text({ wrap: 'truncate-end', dimColor: true, children: [`      ${headline(e.text)}`] }))
    }
  }
  if (!body.length) body.push(Text({ dimColor: true, children: [m.logLoading ? '読み込み中…' : 'このスプリントの記録はまだ無い。'] }))
  return Box({ flexDirection: 'column', children: [head, ...body] })
}

function entryScreen(el: Elements, m: Model, act: Actions, id: string): Node {
  const { Box, Text } = el
  const e = m.entries.find(x => x.id === id)
  if (!e) return Box({ flexDirection: 'column', children: [subHeader(el, m, act, ['記録が見つからない']), Text({ dimColor: true, children: ['スプリントを切り替えた可能性がある。'] })] })
  const who: Seg[] = e.kind === 'request' ? [roleSeg(m, e.from ?? SM), ' → ', roleSeg(m, e.role)]
    : e.kind === 'send' ? [roleSeg(m, e.role), ' → ', roleSeg(m, e.to ?? '?')] : [roleSeg(m, e.role)]
  const other = e.kind === 'request' && e.from && e.from !== SM ? e.from : e.kind === 'send' && e.to && e.to !== SM ? e.to : null
  return Box({
    flexDirection: 'column',
    children: [
      subHeader(el, m, act, [{ t: `${new Date(e.ts).toLocaleString('ja-JP', { hour12: false })}  `, dim: true }, ...who], [
        ['a', `${e.role} の記録`, () => act.open({ kind: 'agent', role: e.role })],
        ...(other ? [['c', `${other} の記録`, () => act.open({ kind: 'agent', role: other })] as Key] : []),
      ]),
      doc(el, e.text, '本文が無い。', '会話ログ'),
    ],
  })
}

// ---------- PBI ----------
function pbiScreen(el: Elements, m: Model, act: Actions, id: string): Node {
  const { Box, Text } = el
  const w = m.columns - 1
  const sp = sprintOf(m.state, m.selected)
  const row = sp?.pbis.find(r => r['PBI'] === id)
  const item = m.state.backlog.find(b => b.id === id)
  const state = row?.['状態'] ?? item?.status ?? ''
  const [label, color] = STATES[state] ?? [state || '—']
  const heading = (t: string) => Box({ marginTop: 1, children: [Text({ bold: true, children: [t] })] })
  const body: Node[] = [subHeader(el, m, act, [
    { t: `${id} ${item?.title ?? ''}`, bold: true }, '  ', { t: label!, ...(color ? { color } : { dim: true }) },
    { t: `  ${row?.['points'] || item?.points || '—'}pt${Number(row?.['差し戻し']) ? ` · 差し戻し ${row!['差し戻し']}` : ''}`, dim: true },
  ])]
  if (row) body.push(line(el, [...lane(state), { t: `  ${row['担当構成'] ?? ''}`, dim: true }]))
  body.push(heading('受け入れ基準'))
  body.push(...(item?.acceptance.length
    ? item.acceptance.map(a => line(el, [{ t: a.done ? '☑ ' : '☐ ', color: a.done ? 'success' : 'inactive' }, a.text]))
    : [Text({ dimColor: true, children: ['バックログに書かれていない。'] })]))
  // 依頼の説明に PBI の ID がある Agent の起動を、時刻順に並べる
  const runs = [...m.runs.values()].filter(r => pbiIn(r.description, [id])).sort((a, b) => a.first - b.first)
  body.push(heading('経過'))
  if (!runs.length) body.push(Text({ dimColor: true, children: [m.logLoading ? '読み込み中…' : 'このスプリントの Agent の記録はまだ無い。'] }))
  for (const r of runs) {
    const said = m.entries.filter(e => e.agentId === r.agentId && e.verdict).at(-1)?.verdict
    const live = m.agents.find(a => a.id === r.agentId && a.status === 'running')
    const slot = slotOf(m, r.role)
    body.push(pick(el, `pb-${r.agentId}`, [
      { t: `${hm(r.first)} `, dim: true }, { t: `${SLOT_STAGE[slot] ?? '作業'} `, color: SLOT_COLOR[slot] ?? 'ide' },
      roleSeg(m, r.role), { t: `  ${span(r.last - r.first)}`, dim: true },
      ...(live ? [{ t: '  作業中', color: 'success' }] : []),
      ...(said ? [{ t: said.verdict === 'approve' ? '  ✓ 承認' : '  ✗ 差し戻し', color: said.verdict === 'approve' ? 'success' : 'error' }] : []),
      { t: `  ${r.description}`, dim: true },
    ], w, () => act.open({ kind: 'agent', role: r.role })))
  }
  if (row) {
    const pr = m.prs.get(row['ブランチ'] ?? '')
    body.push(heading('ブランチ'))
    body.push(line(el, [row['ブランチ'] || '—',
      ...(pr ? [{ t: `  PR #${pr.number} ${pr.state.toLowerCase()} · チェック ${pr.check}`, color: pr.check === 'success' ? 'success' : pr.check === 'failure' ? 'error' : 'inactive' }] : []),
      { t: row['作業ディレクトリ'] ? `  ${row['作業ディレクトリ']}` : '', dim: true }]))
  }
  const scenes = (sp?.demo?.scenes ?? []).filter(s => s['PBI'] === id)
  if (scenes.length) {
    body.push(heading('デモの場面'))
    body.push(...scenes.map(s => line(el, [`${s['#']}. ${s['PO の操作'] ?? ''} → `, { t: s['期待する結果'] ?? '', dim: true }])))
  }
  return Box({ flexDirection: 'column', children: body })
}

// ---------- 読み物 ----------
function docsScreen(el: Elements, m: Model, act: Actions, d: Doc): Node {
  const sp = sprintOf(m.state, m.selected)
  const at = DOCS.findIndex(([k]) => k === d)
  const [nextDoc, nextLabel] = DOCS[(at + 1) % DOCS.length]!
  const head = subHeader(el, m, act, DOCS.flatMap(([k, label], i): Seg[] => [i ? '  ' : '', { t: label, ...(k === d ? { bold: true, color: 'claude' } : { dim: true }) }]), [
    ['v', `次（${nextLabel}）`, () => act.open({ kind: 'docs', doc: nextDoc })],
  ])
  const body = d === 'demo' ? demoView(el, m, sp)
    : d === 'retro' ? doc(el, sp?.retro, '振り返りはまだ無い。', `.scrum/sprints/sprint-${sp?.number}.md`)
      : d === 'team' ? teamView(el, m, sp)
        : d === 'metrics' ? doc(el, m.state.metrics, '指標はまだ無い。', '.scrum/metrics.md')
          : doc(el, m.state.inceptionDeck, 'インセプションデッキはまだ無い。', '.scrum/inception-deck.md')
  return el.Box({ flexDirection: 'column', children: [head, body] })
}

function demoView(el: Elements, m: Model, sp: Sprint | null): Node {
  const { Box, Text, Code, Image } = el
  const demo = sp?.demo
  if (!sp || !demo) return Text({ dimColor: true, children: ['このスプリントのデモはまだ無い。'] })
  const rows: Node[] = []
  const heading = (t: string, note = '') => Box({ marginTop: rows.length ? 1 : 0, children: [line(el, [{ t, bold: true }, { t: note ? `  ${note}` : '', dim: true }])] })
  if (demo.command) {
    rows.push(heading('動かし方'))
    rows.push(Code({ source: demo.command, language: 'bash' }))
  }
  rows.push(heading('リハーサル', demo.results.length ? `${demo.matched} / ${demo.results.length} 場面が一致` : 'まだ無い'))
  const scenes = demo.results.length ? demo.results : demo.scenes
  rows.push(...scenes.map(r => {
    const judged = r['判定'] != null
    const ok = r['判定'] === '一致'
    return Text({ wrap: 'wrap', children: [Text({ color: !judged ? 'inactive' : ok ? 'success' : 'error', children: [!judged ? '· ' : ok ? '✓ ' : '! '] }),
      `${r['#'] ?? ''}. ${r['期待する結果'] ?? ''}`, ...(judged && !ok ? [Text({ color: 'error', children: [`  ${r['判定']}`] })] : [])] })
  }))
  if (demo.images.length) {
    rows.push(heading('画面'))
    for (const im of demo.images) {
      rows.push(Text({ dimColor: true, children: [im.alt || im.path] }))
      if (Image && m.surface === 'terminal' && /\.png$/i.test(im.path)) {
        rows.push(Image({ key: `shot-${im.path}`, source: { file: `${m.root}/${demo.path}/${im.path}`, format: 'png' }, columns: Math.min(60, m.columns - 4), rows: 16, alt: `（${demo.path}/${im.path} を表示できない）` }))
      } else {
        rows.push(Text({ dimColor: true, wrap: 'wrap', children: [`${demo.path}/${im.path}`] }))
      }
    }
  }
  if (sp.judgements.length) {
    rows.push(heading('これまでの判定'))
    rows.push(...sp.judgements.map(r => {
      const ok = (r['判定'] ?? '').includes('受け入れ')
      const said = r['PO の指摘'] && r['PO の指摘'] !== '—' ? `：${r['PO の指摘']}` : ''
      const done = r['対応'] ? ` → ${r['対応']}` : ''
      return Text({ wrap: 'wrap', children: [Text({ color: ok ? 'success' : 'error', children: [`${r['回'] ?? ''}回目 ${r['判定'] ?? ''}`] }), `${said}${done}`] })
    }))
  }
  if (demo.previous.length) {
    rows.push(heading('前の回のリハーサル'))
    rows.push(...demo.previous.map(p => Text({ dimColor: true, children: [`${p.round}回目：${p.matched} / ${p.total}（${demo.path}/rehearsal-${p.round}.md）`] })))
  }
  return Box({ flexDirection: 'column', children: rows })
}

function teamView(el: Elements, m: Model, sp: Sprint | null): Node {
  const { Box, Text } = el
  const team = isPast(m) ? sp?.team : m.state.team
  return Box({
    flexDirection: 'column',
    children: [
      Text({ bold: true, children: [isPast(m) ? `Sprint ${sp?.number} の時点のチーム` : 'チーム編成'] }),
      ...(team?.length
        ? team.map(r => line(el, [roleSeg(m, r['Agent'] ?? ''), { t: `  ${r['枠'] ?? ''}`, dim: true }]))
        : [Text({ dimColor: true, children: ['チームはまだ編成されていない。'] })]),
      Box({ marginTop: 1, children: [Text({ bold: true, children: ['チーム合意'] })] }),
      doc(el, m.state.agreements, 'チーム合意はまだ無い。', '.scrum/agreements.md'),
    ],
  })
}

function sprintsScreen(el: Elements, m: Model, act: Actions): Node {
  const w = m.columns - 1
  const list = m.state.sprints.map(sp => pick(el, `sp-${sp.number}`, [
    { t: `Sprint ${sp.number}`, bold: sp.number === (m.selected ?? m.state.latest) }, ' ',
    { t: sp.number === m.state.latest ? '最新 ' : '', color: 'claude' },
    { t: `${PHASES[sp.phase ?? ''] ?? sp.phase ?? ''} `, dim: true },
    { t: sp.closed ? `${day(sp.closed)} 終了 ` : '', dim: true },
    sp.goal ?? '',
  ], w, () => act.sprint(sp.number === m.state.latest ? null : sp.number)))
  return el.Box({ flexDirection: 'column', children: [subHeader(el, m, act, [{ t: 'スプリントを選ぶ', bold: true }, { t: '  過去のスプリントは閲覧のみ', dim: true }]), ...list] })
}

function doc(el: Elements, text: string | null | undefined, empty: string, path: string): Node {
  if (!text?.trim()) return el.Text({ dimColor: true, children: [empty] })
  const cut = text.length > MARKDOWN_LIMIT
  const note = `\n\n…（続きは ${path}）`
  return el.Markdown({ text: cut ? text.slice(0, MARKDOWN_LIMIT - note.length) + note : text })
}

// ---------- 帯 ----------
/** プロンプトの上に常に出す1行。ペインを閉じていても状況が分かるようにする。 */
export function band(el: Elements, m: Model): Node | null {
  if (!m.state.initialized) return null
  const latest = sprintOf(m.state, null)
  const segs: Seg[] = []
  if (isPreparing(m.state)) segs.push({ t: `Sprint ${(m.state.latest ?? 0) + 1} 準備中`, bold: true })
  else segs.push({ t: `Sprint ${latest!.number} · ${PHASES[latest!.phase ?? ''] ?? latest!.phase ?? ''}`, bold: true })
  const running = m.agents.filter(a => a.status === 'running')
  const ids = pbiIds({ ...m, selected: null })
  for (const a of running.slice(0, 3)) {
    const stalled = a.lastAt != null && m.now - a.lastAt > STALL_MS
    segs.push('  ', { t: '● ', color: stalled ? 'warning' : 'success' }, roleSeg({ ...m, selected: null }, a.role),
      { t: ` ${SLOT_STAGE[slotOf({ ...m, selected: null }, a.role)] ?? ''} ${pbiIn(a.description, ids) ?? ''}`.trimEnd(), dim: true })
  }
  if (running.length > 3) segs.push({ t: `  ほか ${running.length - 3} 人`, dim: true })
  const waiting = latest?.phase === 'review' ? 1 : 0
  segs.push({ t: `  PO 待ち ${waiting}`, ...(waiting ? { color: 'warning', bold: true } : { dim: true }) })
  if (m.interrupted.length) segs.push({ t: `  中断した Agent ${m.interrupted.length}`, color: 'warning' })
  segs.push({ t: '  /scrum', dim: true })
  return line(el, segs)
}
