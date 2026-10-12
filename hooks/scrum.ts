// .scrum/ の Markdown を画面表示用に解析する。ファイルの読み込みは register.ts が行う。

export type Row = Record<string, string>

export type Image = { alt: string; path: string }

export type Demo = {
  path: string
  command: string | null
  scenes: Row[]
  results: Row[]
  matched: number
  images: Image[]
  previous: { round: number; matched: number; total: number; images: Image[] }[]
}

export type Sprint = {
  number: number
  phase: string | null
  goal: string | null
  started: string | null
  closed: string | null
  pbis: Row[]
  retro: string | null
  judgements: Row[]
  demo: Demo | null
  team: Row[] | null
}

export type Item = {
  id: string
  title: string
  status: string
  points: string
  url: string | null
  acceptance: { done: boolean; text: string }[]
  sprint?: number
}

export type ScrumState = {
  initialized: boolean
  backend: string | null
  capacity: string | null
  githubRepo: string | null
  latest: number | null
  sprints: Sprint[]
  backlog: Item[]
  backlogSnapshotAt: string | null
  agreements: string | null
  metrics: string | null
  metricsRows: Row[]
  inceptionDeck: string | null
  team: Row[]
  teamMarkdown: string | null
}

export const EMPTY: ScrumState = {
  initialized: false, backend: null, capacity: null, githubRepo: null, latest: null,
  sprints: [], backlog: [], backlogSnapshotAt: null, agreements: null, metrics: null,
  metricsRows: [], inceptionDeck: null, team: [], teamMarkdown: null,
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function field(text: string | null, name: string): string | null {
  const m = (text ?? '').match(new RegExp(`^- ${escape(name)}:\\s*(.*)$`, 'm'))
  return m ? m[1]!.trim() : null
}

/** `## heading` から、次の同じ深さ以上の見出しまでを返す。 */
export function section(text: string | null, heading: string): string | null {
  if (!text) return null
  const level = heading.length - heading.replace(/^#+/, '').length
  const lines = text.split('\n')
  const at = lines.findIndex(l => l.trim() === heading)
  if (at < 0) return null
  const body: string[] = []
  for (const line of lines.slice(at + 1)) {
    const m = line.match(/^(#+)\s/)
    if (m && m[1]!.length <= level) break
    body.push(line)
  }
  return body.join('\n').trim()
}

/** 最初の Markdown の表を、行の辞書のリストにする。 */
export function table(markdown: string | null): Row[] {
  const rows = (markdown ?? '').split('\n').map(l => l.trim()).filter(l => l.startsWith('|'))
  if (rows.length < 2) return []
  const split = (r: string) => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
  const header = split(rows[0]!)
  return rows.slice(2).map(r => {
    const cells = split(r)
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']))
  })
}

/** 注記が後ろに付いていても、日時の部分だけを取り出す。 */
export function iso(value: string | null): string | null {
  const m = (value ?? '').match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/)
  return m ? m[1]! : null
}

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const IMAGE_SUFFIX = /\.(png|jpe?g|gif|webp)$/i

/** リハーサル記録の画像。パスはデモの場所からの相対で、外に出るものと画像でないものは除く。 */
export function images(markdown: string | null): Image[] {
  return [...(markdown ?? '').matchAll(IMAGE)]
    .map(m => ({ alt: m[1]!, path: m[2]! }))
    .filter(im => IMAGE_SUFFIX.test(im.path) && !im.path.startsWith('/') && !im.path.split('/').includes('..'))
}

const matchedOf = (rows: Row[]) => rows.filter(r => r['判定'] === '一致').length

export function demo(path: string, readme: string | null, rehearsal: string | null,
  previous: { round: number; text: string }[]): Demo | null {
  if (!readme && !rehearsal) return null
  const run = (section(readme, '## 動かし方') ?? '').split('\n')
  const results = table(rehearsal)
  return {
    path,
    command: run.map(l => l.trim()).find(l => l && !l.startsWith('```'))?.replace(/^`|`$/g, '') ?? null,
    scenes: table(section(readme, '## 台本')),
    results,
    matched: matchedOf(results),
    images: images(rehearsal),
    previous: previous.sort((a, b) => a.round - b.round).map(p => {
      const rows = table(p.text)
      return { round: p.round, matched: matchedOf(rows), total: rows.length, images: images(p.text) }
    }),
  }
}

export function sprint(number: number, text: string): Omit<Sprint, 'demo' | 'team'> {
  return {
    number,
    phase: field(text, 'phase'),
    goal: field(text, 'goal'),
    started: iso(field(text, 'started')),
    closed: iso(field(text, 'closed')),
    pbis: table(section(text, '## 対象 PBI')),
    retro: section(text, '## レトロスペクティブ') ?? section(text, '## KPT'),
    judgements: table(section(text, '## デモの判定')),
  }
}

/** backlog.md の `## PBI-xxx: タイトル` の節を、並び順（優先度順）の一覧にする。 */
export function backlogMarkdown(text: string | null): Item[] {
  const items: Item[] = []
  for (const m of (text ?? '').matchAll(/^## (\S+?):\s*(.+?)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) {
    const body = m[3]!
    items.push({
      id: m[1]!, title: m[2]!.trim(),
      status: field(body, 'status') || 'new',
      points: field(body, 'points') ?? '',
      url: null,
      acceptance: [...body.matchAll(/^\s*- \[( |x|X)\]\s*(.+)$/gm)].map(a => ({ done: a[1] !== ' ', text: a[2]!.trim() })),
    })
  }
  return items
}

export function backlogSnapshot(text: string | null): { items: Item[]; updatedAt: string | null } {
  try {
    const snap = JSON.parse(text ?? '') as { items?: Item[]; updated_at?: string }
    return { items: (snap.items ?? []).map(it => ({ ...it, acceptance: it.acceptance ?? [] })), updatedAt: snap.updated_at ?? null }
  } catch {
    return { items: [], updatedAt: null }
  }
}

/** 受け入れた PBI に、受け入れたスプリントの番号を付ける。 */
export function markDone(items: Item[], sprints: Sprint[]): Item[] {
  const doneIn = new Map<string, number>()
  for (const sp of [...sprints].sort((a, b) => a.number - b.number)) {
    for (const row of sp.pbis) {
      const id = row['PBI']
      if (id && row['状態'] === 'accepted' && !doneIn.has(id)) doneIn.set(id, sp.number)
    }
  }
  return items.map(it => (doneIn.has(it.id) ? { ...it, sprint: doneIn.get(it.id)! } : it))
}

export function latestSprint(config: string | null, numbers: number[]): number | null {
  const n = Number(field(config, 'sprint'))
  if (Number.isInteger(n) && numbers.includes(n)) return n
  return numbers.length ? Math.max(...numbers) : null
}

