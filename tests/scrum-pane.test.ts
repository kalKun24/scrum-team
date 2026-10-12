import { expect, mock, test } from 'claude-code/testing'

import * as Log from '../hooks/log'
import * as Scrum from '../hooks/scrum'

const ROOT = '/work/app'
const HOME = '/home/po'
const LOGS = `${HOME}/.claude/projects/-work-app`

const SPRINT_2 = `# Sprint 2
- phase: review
- goal: 検索結果を絞り込める
- started: 2026-10-01T10:00:00+09:00

## 対象 PBI
| PBI | points | ui | 担当構成 | 状態 | 差し戻し | ブランチ | 作業ディレクトリ |
|---|---|---|---|---|---|---|---|
| PBI-3 | 3 | yes | ui-designer → react-specialist | approved | 1 | scrum/pbi-3 | |
| PBI-4 | 2 | no | python-pro | dev | 0 | scrum/pbi-4 | |

## デモの判定
| 回 | 日時 | 判定 | PO の指摘 | 原因の PBI | 対応 |
|---|---|---|---|---|---|
| 1 | 2026-10-05T10:00:00+09:00 | 差し戻し | 並び順が違う | PBI-3 | 直して見せ直す |
`

const SPRINT_1 = `# Sprint 1
- phase: closed
- goal: 一覧を見られる
- closed: 2026-09-30T18:00:00+09:00（レトロ後）

## 対象 PBI
| PBI | points | ui | 担当構成 | 状態 | 差し戻し | ブランチ | 作業ディレクトリ |
|---|---|---|---|---|---|---|---|
| PBI-1 | 3 | yes | python-pro | accepted | 0 | | |

## レトロスペクティブ
### Keep
- テストを先に書いた
`

const FILES: Record<string, string> = {
  '.scrum/config.md': '- backend: markdown\n- capacity: 8\n- sprint: 2\n',
  '.scrum/team.md': '| 枠 | Agent | 出典 | 選定理由 |\n|---|---|---|---|\n| implement | python-pro | catalog | Python |\n| code-review | code-reviewer | catalog | 必須 |\n',
  '.scrum/backlog.md': '## PBI-1: 一覧\n- status: done\n- points: 3\n\n## PBI-3: 絞り込み\n- status: sprint\n- points: 3\n- acceptance:\n  - [x] カテゴリで絞り込める\n  - [ ] 0件のときに案内を出す\n\n## PBI-4: 並べ替え\n- status: sprint\n- points: 2\n\n## PBI-5: CSV 出力\n- status: ready\n- points: 2\n',
  '.scrum/sprints/sprint-1.md': SPRINT_1,
  '.scrum/sprints/sprint-2.md': SPRINT_2,
  '.scrum/metrics.md': '| Sprint | 計画pt | 実績pt | 受け入れ率 |\n|---|---|---|---|\n| 1 | 3 | 3 | 100% |\n',
  '.scrum/demos/sprint-2/README.md': '# Sprint 2 のデモ\n## 動かし方\n`bash .scrum/demos/sprint-2/demo.sh`\n\n## 台本\n| # | PO の操作 | 期待する結果 | PBI |\n|---|---|---|---|\n| 1 | 絞り込む | 3件出る | PBI-3 |\n',
  '.scrum/demos/sprint-2/rehearsal.md': '# リハーサル\n| # | 期待する結果 | 実際の出力（要点） | 判定 |\n|---|---|---|---|\n| 1 | 3件出る | 3件 | 一致 |\n| 2 | 並び替わる | 変わらない | 不一致 |\n\n## 画面\n![場面 1](shots/t1/scene-1.png)\n![外](../../secret.png)\n',
  '.scrum/demos/sprint-2/shots/t1/scene-1.png': 'PNG',
  '.scrum/demos/sprint-2/rehearsal-1.md': '| # | 期待する結果 | 実際の出力（要点） | 判定 |\n|---|---|---|---|\n| 1 | 3件出る | 0件 | 不一致 |\n',
}

const jsonl = (records: object[]) => records.map(r => JSON.stringify(r)).join('\n') + '\n'
const REVIEW = '入力の長さを検証していない。api/search.py:41 を直して。'

// python-pro（a1）と code-reviewer（a2）の会話ログ
const AGENT_LOGS: Record<string, string> = {
  [`${LOGS}/sess-1.jsonl`]: '{}\n',
  [`${LOGS}/sess-1/subagents/agent-a1.meta.json`]: JSON.stringify({ agentType: 'python-pro', description: 'PBI-4 の実装' }),
  [`${LOGS}/sess-1/subagents/agent-a1.jsonl`]: jsonl([
    { type: 'user', timestamp: '2026-10-02T01:00:00Z', message: { content: 'PBI-4 を実装して。受け入れ基準は…' } },
    { type: 'user', isMeta: true, timestamp: '2026-10-02T01:00:01Z', message: { content: [{ type: 'text', text: 'Skill の本文' }] } },
    { type: 'assistant', timestamp: '2026-10-02T01:01:00Z', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/work/app/api/search.py' } }] } },
    { type: 'assistant', timestamp: '2026-10-02T01:02:00Z', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pytest -q' } }] } },
    { type: 'assistant', timestamp: '2026-10-02T01:10:00Z', message: { content: [{ type: 'text', text: '実装した。テストを 12 件追加した。' }] } },
    { type: 'user', timestamp: '2026-10-02T01:20:00Z', message: { content: REVIEW } },
  ]),
  [`${LOGS}/sess-1/subagents/agent-a2.meta.json`]: JSON.stringify({ agentType: 'code-reviewer', description: 'PBI-4 のレビュー' }),
  [`${LOGS}/sess-1/subagents/agent-a2.jsonl`]: jsonl([
    { type: 'user', timestamp: '2026-10-02T01:11:00Z', message: { content: 'PBI-4 をレビューして' } },
    { type: 'assistant', timestamp: '2026-10-02T01:19:00Z', message: { content: [{ type: 'text', text: 'verdict: request-changes\n- [must] 入力の長さ\n- [should] 命名' }] } },
    { type: 'assistant', timestamp: '2026-10-02T01:19:30Z', message: { content: [{ type: 'tool_use', name: 'SendMessage', input: { to: 'a1', message: REVIEW } }] } },
  ]),
}

const PANE = {
  plugin: 'scrum-team',
  component: 'Pane',
  requestId: 'scrum',
  viewport: { columns: 160, rows: 50 },
  props: { title: 'スクラム', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 46 }, view: {} },
} as const

const BAND = {
  plugin: 'scrum-team',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 160, rows: 50 },
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 158, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

type Stubs = {
  files?: Record<string, string>
  saved?: Map<string, unknown>
  agents?: { id: string; type: string; description: string; status: string }[]
  submitted?: unknown[]
  opened?: unknown[]
  toasts?: string[]
}

// スタブは Claude Code の答えを素の値で返すため、型の検査を緩める
type Stub = (name: string, hook: (...args: any[]) => unknown) => void

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

/** 仮想の .scrum/ と会話ログを置き、セッションの開始に要る呼び出しに答える。 */
function stub(on: Stub, s: Stubs = {}) {
  const files = new Map([
    ...Object.entries(s.files ?? FILES).map(([k, v]) => [`${ROOT}/${k}`, v] as const),
    ...Object.entries(s.files && !Object.keys(s.files).length ? {} : AGENT_LOGS),
  ])
  const isDir = (p: string) => [...files.keys()].some(f => f.startsWith(p + '/'))
  const clock = mock.clock(on as never, { now: 1_000_000 })
  on('session.start', () => ({ cwd: ROOT }))
  on('session.root', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    s.opened?.push(e)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    s.toasts?.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  on('fs.read', ($, e) => (files.has(e.path) ? { value: files.get(e.path)! } : { deny: 'ENOENT' }))
  on('fs.exists', ($, e) => ({ value: files.has(e.path) || isDir(e.path) }))
  on('fs.list', ($, e) => {
    if (!isDir(e.path)) return { deny: 'ENOENT' }
    const names = new Map<string, { kind: 'file' | 'dir'; size: number }>()
    for (const [f, text] of files) {
      if (!f.startsWith(e.path + '/')) continue
      const [name, ...rest] = f.slice(e.path.length + 1).split('/')
      names.set(name!, rest.length ? { kind: 'dir', size: 0 } : { kind: 'file', size: text.length })
    }
    return { value: [...names].map(([name, x]) => ({ name, ...x, mtimeMs: 2_000_000_000_000, isLink: false })) }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('env.get', () => ({ value: HOME }))
  on('agent.list', () => ({ value: s.agents ?? [] }))
  const saved = s.saved ?? new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    s.submitted?.push(JSON.parse(JSON.stringify(e)))
    return { text: e.text, context: e.context }
  })
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.close', () => ({ value: undefined }))
  return { clock, files }
}

test('解析：スプリントファイル・バックログ・会話ログを読む', () => {
  const sp = Scrum.sprint(1, SPRINT_1)
  expect(sp.closed).toBe('2026-09-30T18:00:00+09:00')
  expect(sp.retro).toContain('テストを先に書いた')
  const items = Scrum.backlogMarkdown(FILES['.scrum/backlog.md']!)
  expect(items.find(i => i.id === 'PBI-3')!.acceptance).toEqual([{ done: true, text: 'カテゴリで絞り込める' }, { done: false, text: '0件のときに案内を出す' }])
  expect(Scrum.images(FILES['.scrum/demos/sprint-2/rehearsal.md']!).map(i => i.path)).toEqual(['shots/t1/scene-1.png'])

  const a1 = Log.parseAgentLog(AGENT_LOGS[`${LOGS}/sess-1/subagents/agent-a1.jsonl`]!, 'a1', 'python-pro')
  expect(a1.entries.map(e => e.kind)).toEqual(['request', 'op', 'op', 'say', 'request'])
  const a2 = Log.parseAgentLog(AGENT_LOGS[`${LOGS}/sess-1/subagents/agent-a2.jsonl`]!, 'a2', 'code-reviewer')
  expect(a2.entries[1]!.verdict).toEqual({ verdict: 'request-changes', must: 1, should: 1, tests: null })
  // 送った側の記録だけを残し、宛先を役割の名前にする
  const runs = new Map([['a1', { agentId: 'a1', role: 'python-pro' } as Log.Run]])
  const merged = Log.merge([...a1.entries, ...a2.entries], runs, new Map())
  expect(merged.filter(e => e.text === REVIEW).map(e => [e.kind, e.role, e.to])).toEqual([['send', 'code-reviewer', 'python-pro']])
  // 書きかけの最終行は読まない
  expect(Log.parseAgentLog('{"type":"user","timestamp":"2026-10-02T00:00:00Z","message":{"content":"a"}}\n{"type":', 'x', 'r').lines).toBe(1)
})

test('ホーム：バックログ・カンバン・会話の区画と、PO の判定を出す', async ($, on) => {
  const opened: unknown[] = []
  const submitted: unknown[] = []
  const { clock } = stub(on as Stub, { opened, submitted, agents: [{ id: 'a9', type: 'python-pro', description: 'PBI-4 の実装', status: 'running' }] })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  expect(opened).toEqual([{ id: 'scrum', title: 'スクラム' }])
  await clock.advance(3000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'PO の判定（2回目）' })).toBeDefined()
    expect(await ui.find({ key: 'bl-PBI-5' })).toBeDefined()
    expect(await ui.find({ key: 'kb-PBI-3' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 人が作業中' })).toBeDefined()
    // 会話：依頼、操作（畳む）、発言、判定、Agent 同士のやり取り
    expect(await ui.find({ key: 'lg-a2:1:0' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' の操作 2 件 ▸ Read search.py' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✗ request-changes' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'accept' })
  expect(submitted).toMatchObject([{ text: 'デモを受け入れる。', origin: { kind: 'plugin', asUser: true } }])
})

test('画面遷移：PBI 詳細、会話の全文、Agent 詳細、拡大、読み物、スプリントの選択', async ($, on) => {
  const { clock } = stub(on as Stub)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  await clock.advance(3000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'kb-PBI-3' })
  expect(await ui.find({ type: 'Text', text: 'カテゴリで絞り込める' })).toBeDefined()
  await ui.press({ key: 'key-b' })

  await ui.press({ key: 'lg-a2:2:0' })
  expect(await ui.find({ type: 'Markdown' })).toMatchObject({ props: { text: REVIEW } })
  await ui.press({ key: 'key-a' })
  expect(await ui.find({ type: 'Text', text: '✗ request-changes' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /起動 1 回/ })).toBeDefined()
  await ui.press({ key: 'key-b' })
  await ui.press({ key: 'key-b' })

  await ui.press({ key: 'key-z' })
  expect(await ui.find({ type: 'Text', text: 'カンバン' })).toBeDefined()
  await ui.press({ key: 'key-z' })

  await ui.press({ key: 'key-v' })
  expect(await ui.find({ type: 'Text', text: '  1 / 2 場面が一致' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toMatchObject({ props: { source: { file: `${ROOT}/.scrum/demos/sprint-2/shots/t1/scene-1.png`, format: 'png' } } })
  await ui.press({ key: 'key-b' })

  await ui.press({ key: 'key-s' })
  await ui.press({ key: 'sp-1' })
  expect(await ui.find({ type: 'Text', text: '閲覧のみ ' })).toBeDefined()
  expect(await ui.find({ key: 'accept' })).toBeUndefined()
  await ui.press({ key: 'key-v' })
  await ui.press({ key: 'key-v' })
  const retro = await ui.find({ type: 'Markdown' })
  expect(String(retro?.props['text'])).toContain('テストを先に書いた')
})

test('広い幅では 2×2、拡大したカンバンは列で描く', async ($, on) => {
  const { clock } = stub(on as Stub)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  await clock.advance(3000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 120 } })
    expect(await ui.find({ key: 'bl-PBI-5' })).toBeDefined()
    await ui.press({ key: 'key-z' })
    expect(await ui.find({ type: 'Text', text: ' 1' })).toBeDefined()
    expect(await ui.find({ key: 'kb-PBI-4' })).toBeDefined()
    await ui.press({ key: 'key-z' })
    await ui.unmount()
  }
})

test('狭い端末では区画を1つずつ切り替える', async ($, on) => {
  const { clock } = stub(on as Stub)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  await clock.advance(3000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 } } })
  expect(await ui.find({ key: 'kb-PBI-3' })).toBeDefined()
  expect(await ui.find({ key: 'bl-PBI-5' })).toBeUndefined()
  await ui.press({ key: 'key-1' })
  expect(await ui.find({ key: 'bl-PBI-5' })).toBeDefined()
})

test('帯：スプリントの状況と PO 待ちを1行で出す', async ($, on) => {
  stub(on as Stub, { agents: [{ id: 'a9', type: 'python-pro', description: 'PBI-4 の実装', status: 'running' }] })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: 'Sprint 2 · レビュー' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  PO 待ち 1' })).toBeDefined()
    await ui.unmount()
  }
})

test('通知：レビューに入ったとき、差し戻しが3回を超えたとき', async ($, on) => {
  const toasts: string[] = []
  const executing = SPRINT_2.replace('- phase: review', '- phase: execution')
  const { clock, files } = stub(on as Stub, { toasts, files: { ...FILES, '.scrum/sprints/sprint-2.md': executing } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  files.set(`${ROOT}/.scrum/sprints/sprint-2.md`, SPRINT_2.replace('| approved | 1 |', '| approved | 3 |'))
  await clock.advance(3000)
  expect(toasts).toEqual(['Sprint 2 のデモの準備ができた。PO の判定を待っている（/scrum）。', 'PBI-3 の差し戻しが 3 回になった。'])
})

test('止まったセッションの実行中の Agent を、次の入力と一緒に伝える', async ($, on) => {
  const saved = new Map<string, unknown>([[`running:${ROOT}`, {
    sessionId: 'old', updatedAt: 0, ended: true, interrupted: [],
    running: [{ role: 'python-pro', description: 'PBI-4 の実装', worktree: '/work/app/.claude/worktrees/pbi-4' }],
  }]])
  stub(on as Stub, { saved })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '前回、作業中のまま止まった Agent' })).toBeDefined()
  const first = await $.prompt.submit(typed('続けて。'))
  expect(first.context?.[0]).toContain('- python-pro：PBI-4 の実装（作業ディレクトリ：/work/app/.claude/worktrees/pbi-4）')
  const second = await $.prompt.submit(typed('ありがとう。'))
  expect(second.context ?? []).toEqual([])
})

test('別のセッションが動かしている Agent は中断とみなさない', async ($, on) => {
  const saved = new Map<string, unknown>([[`running:${ROOT}`, {
    sessionId: 'other', updatedAt: 1_000_000 - 5_000, ended: false, interrupted: [],
    running: [{ role: 'python-pro', description: 'PBI-4 の実装', worktree: null }],
  }]])
  stub(on as Stub, { saved })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  const first = await $.prompt.submit(typed('続けて。'))
  expect(first.context ?? []).toEqual([])
})

test('.scrum/ が無いプロジェクトではペインを開かず、帯も出さない', async ($, on) => {
  const opened: unknown[] = []
  stub(on as Stub, { files: {}, opened })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  expect(opened).toEqual([])
  const answer = await $.command.run({ command: 'scrum', args: '' } as never)
  expect(answer).toEqual({})
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '.scrum/ がまだ無い' })).toBeDefined()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Sprint/ })).toBeUndefined()
})
