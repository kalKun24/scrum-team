// scrum ペイン：.scrum/ の状態、Agent 同士の会話、カンバン、PO の判定を、セッションの横に表示する。
// プロンプトの上の帯に状況を1行で出し、PO が知るべきことを通知する。

import type { EngineInterface, On } from 'claude-code'

import * as Log from './log'
import * as Scrum from './scrum'
import {
  DOCS, type Elements, type Interrupted, type LiveAgent, type Model, type Pr, REGION_PREFIX, REGIONS, type Region, STALL_MS,
  type Screen, band, render, windowOf,
} from './view'

const PANE = 'scrum'
const TITLE = 'スクラム'
// .scrum/ を変えうるツール。実行の後に読み直す
const WRITES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']
// Agent が止まったときの記録。別のセッションが動かしている間は、その Agent を中断とみなさない
const HEARTBEAT_MS = 10_000
const STALE_MS = 30_000
const PR_TTL_MS = 60_000
// $.fs.read が読める大きさの上限。超えるログは末尾だけを読む
const READ_LIMIT = 4_000_000

type Saved = {
  sessionId: string
  updatedAt: number
  ended: boolean
  running: Interrupted[]
  interrupted: Interrupted[]
}

type LogFile = { size: number; lines: number; entries: Log.Entry[]; run: Log.Run }

let root = ''
let sessionId = ''
let state: Scrum.ScrumState = Scrum.EMPTY
let signature = ''
let dirty = false
let paneOpen = false
let selected: number | null = null
let stack: Screen[] = [{ kind: 'home' }]
let showOps = false
let pages: Record<Region, number> = { backlog: 0, kanban: 0, log: 0 }
let focus: Region = 'kanban'
let single: Region = 'kanban'
let agents: LiveAgent[] = []
let interrupted: Interrupted[] = []
let savedRunning = ''
let savedAt = 0
let ticking = false
let entries: Log.Entry[] = []
let runs = new Map<string, Log.Run>()
let logLoading = false
let logKey = ''
let loadingLog: Promise<void> | null = null

const lastAction = new Map<string, { text: string; at: number }>()
const worktrees = new Map<string, string | null>()
const prs = new Map<string, Pr | null>()
const prFetched = new Map<string, number>()
const notified = new Set<string>()
const logFiles = new Map<string, LogFile>()
const sessionSeen = new Map<string, number>()
// 閉じたスプリントの終了日時とチームは変わらないため、読み直さない
const closedCache = new Map<number, { closed: string | null; team: Scrum.Row[] | null }>()

export function register(on: On) {
  on('session.start', async ($, e, next) => {
    await start($)
    $.clock.every(3000, () => {
      void tick($)
    })
    try {
      await $.command.register({
        name: 'scrum',
        description: 'スクラムのペイン（バックログ・カンバン・Agent の会話）を開く',
        argumentHint: '[kanban|backlog|log|demo|retro|team|metrics|deck]',
        immediate: true,
      })
    } catch {
      // 同じ名前のコマンドが既にある。ペインは自動で開く
    }
    return next(e)
  })

  // /clear・/resume・/branch の後は、別のセッションとして扱う
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await start($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await saveRunning($, true)
    return next(e)
  })

  on('command.run', { command: 'scrum' }, async ($, e) => {
    const arg = e.args.trim()
    const doc = DOCS.find(([key, label]) => key === arg || label === arg)
    const region = REGIONS.find(r => r === arg)
    stack = [{ kind: 'home' }]
    if (doc) stack.push({ kind: 'docs', doc: doc[0] })
    if (region) stack.push({ kind: 'zoom', region })
    await reload($)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    paneOpen = true
    void refreshLog($)
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  })

  // フォーカスのある区画を、n・p・z の対象にする
  on('ui.focus', async ($, e, next) => {
    const r = e.requestId === PANE && e.element ? REGIONS.find(x => e.element!.startsWith(REGION_PREFIX[x])) : undefined
    if (r && r !== focus) {
      focus = r
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // Agent の直近の操作を覚え、.scrum/ を書き換えうる操作の後に読み直す
  on('tool.call', async ($, e, next) => {
    if (e.agentId) lastAction.set(e.agentId, { text: Log.describeTool(e.tool, e as unknown as Record<string, unknown>), at: Date.now() })
    const result = await next(e)
    if (WRITES.includes(e.tool)) dirty = true
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    void tick($)
    return result
  })

  // 中断した Agent は、次の入力と一緒にスクラムマスターへ伝える
  on('prompt.submit', async ($, e, next) => {
    if (!interrupted.length) return next(e)
    const note = interruptionNote(interrupted)
    interrupted = []
    await saveRunning($, false)
    $.ui.invalidate('ui.render')
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const el = $.ui.resolve(e) as unknown as Elements
    const props = e.props as { bodyColumns?: number; placement?: string; scroll?: { bodyRows?: number } }
    const redraw = () => $.ui.invalidate('ui.render')
    const model: Model = {
      ...modelBase(),
      surface: e.surface,
      columns: props.bodyColumns ?? 60,
      rows: props.scroll?.bodyRows ?? 30,
      placement: props.placement ?? 'dock',
    }
    return render(el, model, {
      open: s => {
        stack = [...stack, s]
        redraw()
      },
      back: () => {
        if (stack.length > 1) stack = stack.slice(0, -1)
        redraw()
      },
      page: delta => {
        pages = { ...pages, [focus]: Math.max(0, pages[focus] + delta) }
        redraw()
      },
      toggleOps: () => {
        showOps = !showOps
        redraw()
      },
      zoom: () => {
        const top = stack.at(-1)!
        stack = top.kind === 'zoom' ? stack.slice(0, -1) : [...stack, { kind: 'zoom', region: focus }]
        redraw()
      },
      single: r => {
        single = r
        focus = r
        redraw()
      },
      sprint: n => {
        selected = n
        stack = [{ kind: 'home' }]
        pages = { backlog: 0, kanban: 0, log: 0 }
        void refreshLog($)
        redraw()
      },
      accept: () => {
        void $.prompt.submit({ text: 'デモを受け入れる。', asUser: true })
        $.ui.toast('受け入れをスクラムマスターに伝えた。')
      },
      reject: () => {
        void $.prompt.fill({ text: 'デモを差し戻す。次の点が違う：' })
        $.ui.toast('違う点をプロンプトに続けて書き、送信する。')
      },
    }) as never
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const el = $.ui.resolve(e) as unknown as Elements
    const mine = band(el, { ...modelBase(), surface: e.surface, columns: 80, rows: 1, placement: 'band' })
    if (!mine) return next(e)
    const theirs = await next(e)
    return (theirs ? el.Box({ flexDirection: 'column', children: [theirs, mine] }) : mine) as never
  })
}

function modelBase(): Omit<Model, 'surface' | 'columns' | 'rows' | 'placement'> {
  return {
    state, selected, screen: stack.at(-1)!, canBack: stack.length > 1, agents, runs, entries, logLoading, showOps,
    pages, focus, single, interrupted, prs, root, now: Date.now(),
  }
}

async function start($: EngineInterface) {
  root = await $.session.root()
  sessionId = await $.session.id()
  selected = null
  stack = [{ kind: 'home' }]
  agents = []
  lastAction.clear()
  signature = ''
  logKey = ''
  closedCache.clear()
  await reload($)
  interrupted = await takeInterrupted($)
  if (state.initialized) {
    await $.ui.open({ id: PANE, title: TITLE })
    paneOpen = true
    void refreshLog($)
  }
}

async function tick($: EngineInterface) {
  if (ticking || !root) return
  ticking = true
  try {
    await refreshAgents($)
    if (dirty || paneOpen) {
      dirty = false
      if ((await scan($)) !== signature) await reload($)
    }
    if (paneOpen) {
      await refreshPrs($)
      await refreshLog($)
      // 経過時間の表示を進める
      $.ui.invalidate('ui.render')
    }
  } finally {
    ticking = false
  }
}

async function refreshAgents($: EngineInterface) {
  const list = await $.agent.list()
  const next: LiveAgent[] = list.map(a => ({
    id: a.id,
    role: Log.roleOf(a.type),
    description: a.description,
    status: a.status,
    last: lastAction.get(a.id)?.text ?? null,
    lastAt: lastAction.get(a.id)?.at ?? null,
  }))
  const now = Date.now()
  for (const a of next) {
    const before = agents.find(x => x.id === a.id)
    if ((a.status === 'failed' || a.status === 'killed') && before?.status === 'running') {
      $.ui.toast(`${a.role} が${a.status === 'failed' ? '失敗した' : '止められた'}：${a.description}`, { timeoutMs: 8000 })
    }
    const stallKey = `stall:${a.id}:${a.lastAt}`
    if (a.status === 'running' && a.lastAt != null && now - a.lastAt > STALL_MS && !notified.has(stallKey)) {
      notified.add(stallKey)
      $.ui.toast(`${a.role} の操作が10分以上止まっている：${a.description}`, { timeoutMs: 8000 })
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(agents)) {
    agents = next
    $.ui.invalidate('ui.render')
  }
  await saveRunning($, false)
}

/** 実行中の Agent を記録する。次のセッションは、止まった記録から中断した Agent を知る。 */
async function saveRunning($: EngineInterface, ended: boolean) {
  if (!root) return
  const running: Interrupted[] = []
  for (const a of agents.filter(x => x.status === 'running')) {
    running.push({ role: a.role, description: a.description, worktree: await worktreeOf($, a.id) })
  }
  const key = JSON.stringify([running, interrupted, ended])
  const now = await $.clock.now()
  if (key === savedRunning && (!running.length || now - savedAt < HEARTBEAT_MS)) return
  savedRunning = key
  savedAt = now
  const saved: Saved = { sessionId, updatedAt: now, ended, running, interrupted }
  await $.store.set(`running:${root}`, saved)
}

async function takeInterrupted($: EngineInterface): Promise<Interrupted[]> {
  const saved = (await $.store.get(`running:${root}`)) as Saved | undefined
  if (!saved) return []
  const now = await $.clock.now()
  // 別のセッションが今も動かしている Agent は、中断していない
  const stopped = saved.ended || now - saved.updatedAt > STALE_MS
  return [...(saved.interrupted ?? []), ...(stopped ? saved.running ?? [] : [])]
}

async function projectDir($: EngineInterface): Promise<string> {
  const home = await $.env.get('HOME')
  return `${home}/.claude/projects/${root.replace(/[^A-Za-z0-9-]/g, '-')}`
}

/** Agent の作業ディレクトリを、会話ログの Agent の記録から読む。 */
async function worktreeOf($: EngineInterface, agentId: string): Promise<string | null> {
  if (worktrees.has(agentId)) return worktrees.get(agentId)!
  let worktree: string | null = null
  try {
    const meta = JSON.parse(await $.fs.read(`${await projectDir($)}/${sessionId}/subagents/agent-${agentId}.meta.json`)) as Log.Meta
    worktree = meta.worktreePath ?? null
  } catch {
    // 記録がまだ無い、または worktree を使っていない
  }
  worktrees.set(agentId, worktree)
  return worktree
}

/** 選んでいるスプリントの期間の、Agent の会話ログを読む。変わったファイルだけを読み足す。 */
function refreshLog($: EngineInterface): Promise<void> {
  loadingLog ??= loadLog($).finally(() => {
    loadingLog = null
  })
  return loadingLog
}

async function loadLog($: EngineInterface) {
  if (!state.initialized) return
  const win = windowOf(state, selected)
  const key = `${win.start}-${win.end}`
  if (key !== logKey) {
    logKey = key
    logLoading = true
    $.ui.invalidate('ui.render')
  }
  const dir = await projectDir($)
  let listing: { name: string; kind: string; size: number; mtimeMs: number }[] = []
  try {
    listing = await $.fs.list(dir)
  } catch {
    // このプロジェクトの会話ログがまだ無い
  }
  const sessions = listing
    .filter(x => x.kind === 'file' && x.name.endsWith('.jsonl'))
    .filter(x => x.name === `${sessionId}.jsonl` || win.start == null || x.mtimeMs >= win.start)
    .map(x => ({ id: x.name.slice(0, -'.jsonl'.length), mtime: x.mtimeMs }))
  const collected: Log.Entry[] = []
  const found = new Map<string, Log.Run>()
  for (const s of sessions) {
    const changed = s.id === sessionId || sessionSeen.get(s.id) !== s.mtime
    sessionSeen.set(s.id, s.mtime)
    const sub = `${dir}/${s.id}/subagents`
    let files: { name: string; size: number; mtimeMs: number }[]
    if (changed) {
      try {
        files = (await $.fs.list(sub)).filter(x => /^agent-.+\.jsonl$/.test(x.name))
      } catch {
        files = []
      }
    } else {
      files = [...logFiles.entries()].filter(([p]) => p.startsWith(`${sub}/`)).map(([p, f]) => ({ name: p.slice(sub.length + 1), size: f.size, mtimeMs: f.run.last }))
    }
    for (const f of files) {
      if (win.start != null && f.mtimeMs < win.start) continue
      const file = await readLogFile($, `${sub}/${f.name}`, f.size, s.id)
      if (!file) continue
      found.set(file.run.agentId, file.run)
      for (const e of file.entries) if ((win.start == null || e.ts >= win.start) && (win.end == null || e.ts <= win.end)) collected.push(e)
    }
  }
  const names = new Map<string, string>()
  for (const a of await $.agent.list()) if (a.name) names.set(a.name, Log.roleOf(a.type))
  const merged = Log.merge(collected, found, names)
  const changedLog = merged.length !== entries.length || merged.at(-1)?.id !== entries.at(-1)?.id || logLoading
  entries = merged
  runs = found
  logLoading = false
  if (changedLog) $.ui.invalidate('ui.render')
}

async function readLogFile($: EngineInterface, path: string, size: number, session: string): Promise<LogFile | null> {
  const cached = logFiles.get(path)
  if (cached && cached.size === size) return cached
  const agentId = path.match(/agent-(.+)\.jsonl$/)![1]!
  let meta: Log.Meta = {}
  try {
    meta = JSON.parse(await $.fs.read(path.replace(/\.jsonl$/, '.meta.json'))) as Log.Meta
  } catch {
    // メタデータが無い Agent は、種類を general-purpose とみなす
  }
  const role = Log.roleOf(meta.agentType)
  let text = ''
  let from = cached && size > cached.size ? cached.lines : 0
  if (size <= READ_LIMIT) {
    try {
      text = await $.fs.read(path)
    } catch {
      return cached ?? null
    }
  } else {
    // 大きすぎるログは末尾だけを読み、最初の欠けた行を捨てる
    try {
      const r = await $.process.run(['tail', '-c', String(READ_LIMIT), path])
      text = r.stdout.slice(r.stdout.indexOf('\n') + 1)
      from = 0
    } catch {
      return cached ?? null
    }
  }
  const parsed = Log.parseAgentLog(text, agentId, role, from)
  const all = from ? [...cached!.entries, ...parsed.entries] : parsed.entries
  const times = all.map(e => e.ts)
  const file: LogFile = {
    size,
    lines: parsed.lines,
    entries: all,
    run: {
      agentId, role, description: meta.description ?? '', session, worktree: meta.worktreePath ?? null,
      first: times.length ? Math.min(...times) : 0, last: times.length ? Math.max(...times) : 0,
    },
  }
  logFiles.set(path, file)
  return file
}

async function read($: EngineInterface, rel: string): Promise<string | null> {
  try {
    return await $.fs.read(`${root}/${rel}`)
  } catch {
    return null
  }
}

async function names($: EngineInterface, rel: string): Promise<string[]> {
  try {
    return (await $.fs.list(`${root}/${rel}`)).filter(x => x.kind === 'file').map(x => x.name)
  } catch {
    return []
  }
}

async function git($: EngineInterface, args: string[]): Promise<string> {
  try {
    const r = await $.process.run(['git', '-C', root, ...args], { timeoutMs: 10_000 })
    return r.exitCode === 0 ? r.stdout : ''
  } catch {
    return ''
  }
}

/** .scrum/ の Markdown と JSON の更新時刻をつないだもの。変わったときだけ読み直す。 */
async function scan($: EngineInterface): Promise<string> {
  const parts: string[] = []
  const dirs = ['.scrum']
  while (dirs.length) {
    const dir = dirs.pop()!
    let list: { name: string; kind: string; size: number; mtimeMs: number }[] = []
    try {
      list = await $.fs.list(`${root}/${dir}`)
    } catch {
      continue
    }
    for (const x of list) {
      const rel = `${dir}/${x.name}`
      if (x.kind === 'dir' && x.name !== 'shots') dirs.push(rel)
      if (x.kind === 'file' && /\.(md|json)$/.test(x.name)) parts.push(`${rel}:${x.mtimeMs}:${x.size}`)
    }
  }
  return parts.sort().join('\n')
}

async function reload($: EngineInterface) {
  signature = await scan($)
  const before = state
  if (!(await $.fs.exists(`${root}/.scrum`))) {
    state = Scrum.EMPTY
    $.ui.invalidate('ui.render')
    return
  }
  const config = await read($, '.scrum/config.md')
  const backend = Scrum.field(config, 'backend')
  const numbers = (await names($, '.scrum/sprints'))
    .map(n => n.match(/^sprint-(\d+)\.md$/))
    .filter((m): m is RegExpMatchArray => m != null)
    .map(m => Number(m[1]))
    .sort((a, b) => b - a)
  const teamMarkdown = await read($, '.scrum/team.md')
  const sprints: Scrum.Sprint[] = []
  for (const n of numbers) {
    const rel = `.scrum/sprints/sprint-${n}.md`
    const base = Scrum.sprint(n, (await read($, rel)) ?? '')
    let closed = base.closed
    let team: Scrum.Row[] | null = teamMarkdown ? Scrum.table(teamMarkdown) : null
    if (base.phase === 'closed') {
      const cached = closedCache.get(n) ?? await closedFacts($, rel, closed)
      closedCache.set(n, cached)
      closed = cached.closed
      team = cached.team
    }
    sprints.push({ ...base, closed, team, demo: await loadDemo($, n) })
  }
  const backlog = !backend || backend === 'markdown'
    ? { items: Scrum.backlogMarkdown(await read($, '.scrum/backlog.md')), updatedAt: null }
    : Scrum.backlogSnapshot(await read($, '.scrum/backlog-snapshot.json'))
  const metrics = await read($, '.scrum/metrics.md')
  state = {
    initialized: true,
    backend,
    capacity: Scrum.field(config, 'capacity'),
    githubRepo: Scrum.field(config, 'github.repo'),
    latest: Scrum.latestSprint(config, numbers),
    sprints,
    backlog: Scrum.markDone(backlog.items, sprints),
    backlogSnapshotAt: backlog.updatedAt,
    agreements: await read($, '.scrum/agreements.md'),
    metrics,
    metricsRows: Scrum.table(metrics),
    inceptionDeck: await read($, '.scrum/inception-deck.md'),
    team: Scrum.table(teamMarkdown),
    teamMarkdown,
  }
  if (before.initialized) notifyChanges($, before, state)
  // スプリントが変わると会話を読む期間も変わる
  if (windowKey(before) !== windowKey(state)) void refreshLog($)
  $.ui.invalidate('ui.render')
}

const windowKey = (s: Scrum.ScrumState) => (s.initialized ? JSON.stringify(windowOf(s, selected)) : '')

/** PO が知るべき変化を通知する。 */
function notifyChanges($: EngineInterface, before: Scrum.ScrumState, after: Scrum.ScrumState) {
  const was = before.sprints.find(s => s.number === after.latest)
  const now = after.sprints.find(s => s.number === after.latest)
  if (now?.phase === 'review' && was?.phase !== 'review') {
    $.ui.toast(`Sprint ${now.number} のデモの準備ができた。PO の判定を待っている（/scrum）。`, { timeoutMs: 10_000 })
  }
  for (const row of now?.pbis ?? []) {
    const n = Number(row['差し戻し']) || 0
    const old = Number(was?.pbis.find(r => r['PBI'] === row['PBI'])?.['差し戻し']) || 0
    if (n > 2 && old <= 2) $.ui.toast(`${row['PBI']} の差し戻しが ${n} 回になった。`, { timeoutMs: 8000 })
  }
}

/** 閉じたスプリントの終了日時（書かれていなければ git の履歴）と、その時点のチーム。 */
async function closedFacts($: EngineInterface, rel: string, closed: string | null) {
  const when = closed ?? ((await git($, ['log', '-1', '--format=%cI', '--', rel])).trim() || null)
  const commit = when ? (await git($, ['log', '-1', `--before=${when}`, '--format=%H', '--', '.scrum/team.md'])).trim() : ''
  const team = commit ? await git($, ['show', `${commit}:.scrum/team.md`]) : ''
  return { closed: when, team: team ? Scrum.table(team) : null }
}

async function loadDemo($: EngineInterface, n: number): Promise<Scrum.Demo | null> {
  const path = `.scrum/demos/sprint-${n}`
  const files = await names($, path)
  if (!files.includes('README.md') && !files.includes('rehearsal.md')) return null
  const readme = await read($, `${path}/README.md`)
  const rehearsal = await read($, `${path}/rehearsal.md`)
  const previous: { round: number; text: string }[] = []
  for (const name of files) {
    const m = name.match(/^rehearsal-(\d+)\.md$/)
    if (m) previous.push({ round: Number(m[1]), text: (await read($, `${path}/${name}`)) ?? '' })
  }
  const demo = Scrum.demo(path, readme, rehearsal, previous)!
  // リハーサル記録に書かれていても、実在しない画像は出さない
  const exists = async (images: Scrum.Image[]) => {
    const out: Scrum.Image[] = []
    for (const im of images) if (await $.fs.exists(`${root}/${path}/${im.path}`)) out.push(im)
    return out
  }
  demo.images = await exists(demo.images)
  for (const p of demo.previous) p.images = await exists(p.images)
  return demo
}

/** GitHub の PR とチェックの状態を、ローカルの gh で読む。1分間は読み直さない。 */
async function refreshPrs($: EngineInterface) {
  const repo = state.githubRepo
  if (state.backend !== 'github' || !repo) return
  const sp = state.sprints.find(s => s.number === (selected ?? state.latest))
  const now = await $.clock.now()
  let changed = false
  for (const row of sp?.pbis ?? []) {
    const branch = row['ブランチ'] ?? ''
    if (!/^[\w./-]{1,100}$/.test(branch) || now - (prFetched.get(branch) ?? 0) < PR_TTL_MS) continue
    prFetched.set(branch, now)
    let found: { number: number; url: string; state: string; statusCheckRollup?: Record<string, string>[] }[] = []
    try {
      const r = await $.process.run(['gh', 'pr', 'list', '-R', repo, '--head', branch, '--state', 'all',
        '--json', 'number,url,state,statusCheckRollup', '--limit', '1'], { timeoutMs: 15_000 })
      if (r.exitCode === 0) found = JSON.parse(r.stdout)
    } catch {
      // gh が無い、または認証されていない
    }
    const pr = found[0]
    prs.set(branch, pr ? { number: pr.number, url: pr.url, state: pr.state, check: checkOf(pr.statusCheckRollup ?? []) } : null)
    changed = true
  }
  if (changed) $.ui.invalidate('ui.render')
}

function checkOf(rollup: Record<string, string>[]): string {
  const checks = rollup.map(c => c['conclusion'] || c['state'] || c['status'] || '')
  if (!checks.length) return 'none'
  if (checks.some(c => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED'].includes(c))) return 'failure'
  if (checks.every(c => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c))) return 'success'
  return 'pending'
}

function interruptionNote(list: Interrupted[]): string {
  return [
    '【scrum ペインからの連絡】前回、次の Agent が作業中のまま中断された。',
    ...list.map(a => `- ${a.role}：${a.description}（作業ディレクトリ：${a.worktree ?? '元のリポジトリ'}）`),
    'スプリントファイルと各作業ディレクトリの状態（git status・git log）を確かめ、続きから進めるかやり直すかを判断してから、作業を続けること。',
  ].join('\n')
}
