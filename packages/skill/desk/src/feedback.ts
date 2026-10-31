/**
 * Durable desk feedback: append-only actions, revocation, and the preference
 * reset marker.
 *
 * A `set` action records one useful/useless/handled mark bound to a task, run,
 * and report version. A `revoke` action points at an earlier set id; readers
 * keep both actions so the history stays auditable while the mark stops
 * counting. Resetting preferences writes one timestamp; aggregation ignores
 * feedback recorded before it without deleting any row.
 *
 * @module @deepseek-ai/dsh-desk/feedback
 */

import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { DeskFeedbackRow } from './types.ts'

/** One stored feedback action. */
interface FeedbackAction {
  readonly action: 'set' | 'revoke'
  readonly id: string
  readonly ts: string
  readonly task?: string
  readonly runId?: string
  readonly reportAsset?: string
  readonly reportVersion?: number
  readonly kind?: 'useful' | 'useless' | 'handled'
  readonly note?: string | null
  readonly target?: string
}

/** Paths owned by the feedback store. */
export interface FeedbackPaths {
  readonly log: string
  readonly state: string
}

/** Resolve the two paths under one desk directory. */
export function feedbackPaths(deskDir: string): FeedbackPaths {
  return {
    log: join(deskDir, 'feedback.jsonl'),
    state: join(deskDir, 'preferences.json'),
  }
}

/** Read every action, tolerating a truncated trailing line. */
async function readActions(paths: FeedbackPaths): Promise<FeedbackAction[]> {
  let text: string
  try {
    text = await readFile(paths.log, 'utf-8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw error
  }
  const actions: FeedbackAction[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as FeedbackAction
      if (typeof parsed.id !== 'string' || (parsed.action !== 'set' && parsed.action !== 'revoke')) continue
      if (typeof parsed.ts !== 'string') continue
      actions.push(parsed)
    } catch {
      // A torn trailing line is not an action; every earlier row still counts.
    }
  }
  return actions
}

/**
 * Every set row with its active flag, newest first.
 * @param paths - feedback log and reset marker paths.
 * @returns the rows; a revoke hides its target without deleting it.
 */
export async function readFeedbackRows(paths: FeedbackPaths): Promise<DeskFeedbackRow[]> {
  const actions = await readActions(paths)
  const revoked = new Map<string, string>()
  const rows = new Map<string, DeskFeedbackRow>()
  for (const action of actions) {
    if (action.action === 'revoke') {
      if (typeof action.target === 'string') revoked.set(action.target, action.ts)
      continue
    }
    if (typeof action.task !== 'string' || typeof action.runId !== 'string') continue
    if (typeof action.reportAsset !== 'string' || typeof action.reportVersion !== 'number') continue
    if (action.kind !== 'useful' && action.kind !== 'useless' && action.kind !== 'handled') continue
    rows.set(action.id, {
      id: action.id,
      ts: action.ts,
      task: action.task,
      runId: action.runId,
      reportAsset: action.reportAsset,
      reportVersion: action.reportVersion,
      kind: action.kind,
      note: typeof action.note === 'string' && action.note !== '' ? action.note : null,
      active: false,
    })
  }
  return [...rows.values()]
    .map(row => {
      const at = revoked.get(row.id) ?? null
      return { ...row, active: at === null, revokedAt: at }
    })
    .sort((left, right) => right.ts.localeCompare(left.ts))
}

/**
 * Append one feedback mark.
 * @param paths - feedback store paths.
 * @param input - task, run, report binding, kind, and optional note.
 * @returns the new feedback id.
 */
export async function appendFeedback(
  paths: FeedbackPaths,
  input: {
    readonly task: string
    readonly runId: string
    readonly reportAsset: string
    readonly reportVersion: number
    readonly kind: 'useful' | 'useless' | 'handled'
    readonly note?: string
  },
): Promise<string> {
  const id = `fb-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  await mkdir(dirname(paths.log), { recursive: true })
  const action: FeedbackAction = {
    action: 'set',
    id,
    ts: new Date().toISOString(),
    task: input.task,
    runId: input.runId,
    reportAsset: input.reportAsset,
    reportVersion: input.reportVersion,
    kind: input.kind,
    note: input.note ?? null,
  }
  await appendFile(paths.log, `${JSON.stringify(action)}\n`, 'utf-8')
  return id
}

/**
 * Append a revoke action for one existing mark.
 * @param paths - feedback store paths.
 * @param id - the set row to revoke.
 * @returns whether the mark existed and is now revoked.
 */
export async function revokeFeedback(paths: FeedbackPaths, id: string): Promise<boolean> {
  const rows = await readFeedbackRows(paths)
  const row = rows.find(candidate => candidate.id === id)
  if (row === undefined) return false
  await mkdir(dirname(paths.log), { recursive: true })
  await appendFile(paths.log, `${JSON.stringify({ action: 'revoke', id: `rv-${randomBytes(4).toString('hex')}`, ts: new Date().toISOString(), target: id })}\n`, 'utf-8')
  return true
}

/**
 * Record the preference-reset instant. Earlier feedback stays on disk for the
 * audit view but stops shaping the model-facing summary and scorecard window.
 * @param paths - feedback store paths.
 * @returns the reset instant.
 */
export async function resetPreferences(paths: FeedbackPaths): Promise<string> {
  const resetAt = new Date().toISOString()
  await writeFileAtomic(paths.state, `${JSON.stringify({ resetAt }, null, 2)}\n`, {
    mode: 0o600,
    dirMode: 0o700,
  })
  return resetAt
}

/**
 * The last preference-reset instant, or `null` when none was recorded.
 * @param paths - feedback store paths.
 */
export async function readResetAt(paths: FeedbackPaths): Promise<string | null> {
  let text: string
  try {
    text = await readFile(paths.state, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const parsed = JSON.parse(text) as { resetAt?: unknown }
    return typeof parsed.resetAt === 'string' && parsed.resetAt !== '' ? parsed.resetAt : null
  } catch {
    throw new Error(`${paths.state}: preferences reset marker is not JSON`)
  }
}
