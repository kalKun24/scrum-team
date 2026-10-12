// Agent の会話ログ（~/.claude/projects/<プロジェクト>/<セッション>/subagents/agent-<id>.jsonl）を、
// 依頼・発言・やり取り・操作の記録にする。ファイルの読み込みは register.ts が行う。

export type Verdict = { verdict: 'approve' | 'request-changes'; must: number; should: number; tests: string | null }

export type Entry = {
  id: string
  ts: number
  agentId: string
  role: string
  // request：Agent が受け取った依頼・メッセージ、say：Agent の発言、send：Agent が送ったメッセージ、op：操作
  kind: 'request' | 'say' | 'send' | 'op'
  text: string
  from?: string
  to?: string
  verdict?: Verdict
  // API のエラー（利用上限など）で、Agent の発言ではないもの
  error?: boolean
}

export type Run = {
  agentId: string
  role: string
  description: string
  session: string
  worktree: string | null
  first: number
  last: number
}

export type Meta = { agentType?: string; description?: string; worktreePath?: string }

export const SM = 'SM'

type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown> }
type Record_ = { type?: string; isMeta?: boolean; isApiErrorMessage?: boolean; timestamp?: string; message?: { content?: string | Block[] } }

export function roleOf(agentType: string | undefined): string {
  return (agentType || 'general-purpose').split(':').pop()!
}

export function describeTool(name: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const base = (p: string) => p.split('/').pop() ?? p
  if (['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) return `${name} ${base(str('file_path'))}`
  if (name === 'Bash') return `Bash ${str('command').trim().split('\n')[0]!.slice(0, 160)}`
  if (name === 'Grep' || name === 'Glob') return `${name} ${str('pattern').slice(0, 120)}`
  if (name === 'Skill') return `Skill ${str('skill')}`
  if (name === 'SendMessage') return `SendMessage → ${str('to')}`
  if (name === 'Agent') return `Agent ${roleOf(str('subagent_type'))}：${str('description')}`
  return name
}

/** レビュアーの判定書式（verdict・[must]・[should]）を読む。 */
export function verdictOf(text: string): Verdict | undefined {
  const v = text.match(/verdict:\s*\**\s*(approve|request-changes)/i)
  if (!v) return undefined
  const tests = [...text.matchAll(/Ran (\d+) tests?/g)].map(m => m[1]!)
  return {
    verdict: v[1]!.toLowerCase() as Verdict['verdict'],
    must: (text.match(/\[must\]/g) ?? []).length,
    should: (text.match(/\[should\]/g) ?? []).length,
    tests: tests.at(-1) ?? null,
  }
}

/** jsonl の行を記録にする。`start` 行目より前は読み飛ばす（読み足すとき用）。 */
export function parseAgentLog(text: string, agentId: string, role: string, start = 0): { entries: Entry[]; lines: number } {
  const lines = text.split('\n')
  // 最後の要素は、改行で終わっていれば空、そうでなければ書きかけの行なので、次回に回す
  const complete = lines.length - 1
  const entries: Entry[] = []
  for (let i = start; i < complete; i++) {
    let rec: Record_
    try {
      rec = JSON.parse(lines[i]!) as Record_
    } catch {
      continue
    }
    const ts = Date.parse(rec.timestamp ?? '')
    if (Number.isNaN(ts)) continue
    const push = (kind: Entry['kind'], text: string, extra: Partial<Entry> = {}, n = 0) => {
      if (text.trim()) entries.push({ id: `${agentId}:${i}:${n}`, ts, agentId, role, kind, text: text.trim(), ...extra })
    }
    const content = rec.message?.content
    if (rec.type === 'user' && !rec.isMeta) {
      if (typeof content === 'string') push('request', content, { from: SM })
      else (content ?? []).forEach((b, n) => b.type === 'text' && push('request', b.text ?? '', { from: SM }, n))
    } else if (rec.type === 'assistant' && Array.isArray(content)) {
      content.forEach((b, n) => {
        if (b.type === 'text') {
          const text = b.text ?? ''
          const verdict = verdictOf(text)
          push('say', text, rec.isApiErrorMessage ? { error: true } : verdict ? { verdict } : {}, n)
        } else if (b.type === 'tool_use' && b.name === 'SendMessage') {
          const input = b.input ?? {}
          push('send', String(input['message'] ?? ''), { to: String(input['to'] ?? '') }, n)
        } else if (b.type === 'tool_use' && b.name) {
          push('op', describeTool(b.name, b.input ?? {}), {}, n)
        }
      })
    }
  }
  return { entries, lines: complete }
}

/**
 * Agent 同士のメッセージは、送った側の send と受け取った側の request の両方に残る。
 * 送った側だけを残し、宛先を役割の名前にそろえる。受け取った側にしか無い依頼は、スクラムマスターからとみなす。
 */
export function merge(entries: Entry[], runs: Map<string, Run>, names: Map<string, string>): Entry[] {
  const roleOfAddress = (to: string) => {
    if (to === 'main' || to === 'team-lead') return SM
    return runs.get(to)?.role ?? names.get(to) ?? to
  }
  const sent = new Map<string, Entry>()
  for (const e of entries) if (e.kind === 'send') sent.set(e.text, e)
  const out: Entry[] = []
  for (const e of entries) {
    if (e.kind === 'send') {
      out.push({ ...e, to: roleOfAddress(e.to ?? '') })
    } else if (e.kind === 'request' && sent.has(e.text)) {
      continue
    } else {
      out.push(e)
    }
  }
  return out.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
}

export function pbiIn(text: string, ids: string[]): string | null {
  return ids.find(id => new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`).test(text)) ?? null
}

/** 本文の1行目（見出しや Markdown の記号を除く）。 */
export function headline(text: string): string {
  return text.split('\n')
    .map(l => l.replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').trim())
    .find(l => l && !/^[|`:\-]+/.test(l)) ?? ''
}
