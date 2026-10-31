/**
 * Merge one desk run log into run records.
 *
 * A run writes several append-only lines under one `runId`: `started`,
 * `signal`, `report`, and `finished`. Readers group by `runId` instead of
 * guessing from the file's last line, so a report line can never be mistaken
 * for the run's outcome and a run that crashed after `started` stays visible
 * as running rather than disappearing.
 *
 * @module @deepseek-ai/dsh-automation-runner
 */

import type {
  DeskInputVersion,
  DeskRun,
  DeskRunReport,
  DeskRunStatus,
  DeskRunTrigger,
  DeskRunUsage,
  DeskSignalRecord,
  DeskSignalRow,
} from './types.ts'
import type { RunLogLine } from './load.ts'

/** One mutable accumulation while folding lines for one run id. */
interface RunDraft {
  runId: string
  task: string
  trigger: DeskRunTrigger | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  sessionId: string | null
  report: DeskRunReport | null
  signals: readonly DeskSignalRow[]
  inputs: readonly DeskInputVersion[]
  summary: DeskSignalRecord['summary'] | null
  status: DeskRunStatus
  stopReason: string | null
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  cancelled: boolean
  usage: DeskRunUsage | null
  error: string | null
  stderrTail: string | null
  reportExpected: boolean
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function readTrigger(value: unknown): DeskRunTrigger | null {
  const record = asRecord(value)
  if (record === undefined) return null
  const kind = record.kind
  if (kind === 'manual' || kind === 'thesis-due') return kind === 'manual'
    ? { kind: 'manual' }
    : { kind: 'thesis-due', theses: Array.isArray(record.theses) ? record.theses.filter((item): item is string => typeof item === 'string') : [] }
  if (kind === 'cron' && typeof record.schedule === 'string') return { kind: 'cron', schedule: record.schedule }
  if (kind === 'interval' && typeof record.everySeconds === 'number') {
    return { kind: 'interval', everySeconds: record.everySeconds }
  }
  if (kind === 'event' && typeof record.name === 'string') {
    return {
      kind: 'event',
      name: record.name,
      ...typeof record.deliveryId === 'string' ? { deliveryId: record.deliveryId } : {},
      ...typeof record.source === 'string' ? { source: record.source } : {},
    }
  }
  return null
}

function readSummary(value: unknown): DeskSignalRecord['summary'] | null {
  const record = asRecord(value)
  if (record === undefined) return null
  const number = (key: string): number => (typeof record[key] === 'number' ? record[key] as number : 0)
  return {
    moves: number('moves'),
    quiet: number('quiet'),
    stale: number('stale'),
    missing: number('missing'),
    due: number('due'),
    recorded: number('recorded'),
  }
}

function readSignals(value: unknown): readonly DeskSignalRow[] | null {
  if (!Array.isArray(value)) return null
  const rows: DeskSignalRow[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (record === undefined) return null
    const kind = asString(record.kind)
    const ref = asString(record.ref)
    const status = asString(record.status)
    if (kind === null || ref === null || status === null) return null
    rows.push({ ...record, kind, ref, status })
  }
  return rows
}

function readInputs(value: unknown): readonly DeskInputVersion[] | null {
  if (!Array.isArray(value)) return null
  const rows: DeskInputVersion[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (record === undefined) return null
    const asset = asString(record.asset)
    const version = asNumber(record.version)
    if (asset === null || version === null) return null
    rows.push({
      asset,
      version,
      ...typeof record.kind === 'string' ? { kind: record.kind } : {},
    })
  }
  return rows
}

function readReport(value: unknown): DeskRunReport | null {
  const record = asRecord(value)
  if (record === undefined) return null
  const asset = asString(record.asset)
  const version = asNumber(record.version)
  const dir = asString(record.dir)
  if (asset === null || version === null || dir === null) return null
  return {
    asset,
    version,
    dir,
    tags: Array.isArray(record.tags) ? record.tags.filter((item): item is string => typeof item === 'string') : [],
    fallback: record.fallback === true,
  }
}

function readUsage(value: unknown): DeskRunUsage | null {
  const record = asRecord(value)
  if (record === undefined) return null
  const inputTokens = asNumber(record.inputTokens)
  const outputTokens = asNumber(record.outputTokens)
  const totalTokens = asNumber(record.totalTokens)
  const requests = asNumber(record.requests)
  if (inputTokens === null || outputTokens === null || totalTokens === null || requests === null) return null
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens: asNumber(record.cacheReadTokens),
    cacheWriteTokens: asNumber(record.cacheWriteTokens),
    reasoningTokens: asNumber(record.reasoningTokens),
    requests,
    unknown: record.unknown === true,
  }
}

/** The statuses a finished line may carry; an unknown value reads as failed. */
const STATUSES: ReadonlySet<DeskRunStatus> = new Set([
  'running', 'ok', 'degraded', 'no-change', 'data-insufficient', 'budget',
  'timeout', 'cancelled', 'failed', 'skipped',
])

function readStatus(value: unknown): DeskRunStatus {
  return typeof value === 'string' && STATUSES.has(value as DeskRunStatus) ? value as DeskRunStatus : 'failed'
}

/** Empty draft seeded from a started or signal line. */
function draftOf(runId: string, task: string): RunDraft {
  return {
    runId,
    task,
    trigger: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    sessionId: null,
    report: null,
    signals: [],
    inputs: [],
    summary: null,
    status: 'running',
    stopReason: null,
    exitCode: null,
    signal: null,
    timedOut: false,
    cancelled: false,
    usage: null,
    error: null,
    stderrTail: null,
    reportExpected: false,
  }
}

/**
 * Fold parsed run-log lines into complete run records, newest first.
 * @param lines - parsed lines in file order.
 * @param maxRuns - maximum records returned; older records are dropped after sorting.
 * @returns the merged records.
 */
export function mergeDeskRuns(lines: readonly RunLogLine[], maxRuns: number): DeskRun[] {
  const drafts = new Map<string, RunDraft>()
  for (const { value } of lines) {
    const runId = asString(value.runId)
    const task = asString(value.task)
    if (runId === null || task === null) {
      throw new Error('desk run log line is missing runId or task')
    }
    const draft = drafts.get(runId) ?? draftOf(runId, task)
    drafts.set(runId, draft)
    const trigger = readTrigger(value.trigger)
    if (trigger !== null) draft.trigger ??= trigger
    if (value.step === 'signal') {
      const signals = readSignals(value.signals)
      const inputs = readInputs(value.inputs)
      if (signals !== null) draft.signals = signals
      if (inputs !== null) draft.inputs = inputs
      draft.summary = readSummary(value.summary) ?? draft.summary
      draft.startedAt ??= asString(value.ts)
      continue
    }
    if (value.step === 'report') {
      draft.report = readReport(value.report) ?? draft.report
      continue
    }
    if (value.step !== 'runner') continue
    if (value.event === 'started') {
      draft.startedAt = asString(value.startedAt) ?? asString(value.ts) ?? draft.startedAt
      draft.status = 'running'
      continue
    }
    if (value.event !== 'finished') continue
    draft.status = readStatus(value.status)
    draft.startedAt = asString(value.startedAt) ?? draft.startedAt
    draft.finishedAt = asString(value.finishedAt) ?? asString(value.ts)
    draft.durationMs = asNumber(value.durationMs)
    draft.sessionId = asString(value.sessionId) ?? draft.sessionId
    draft.report = readReport(value.report) ?? draft.report
    const signals = readSignals(value.signals)
    const inputs = readInputs(value.inputs)
    if (signals !== null) draft.signals = signals
    if (inputs !== null) draft.inputs = inputs
    draft.summary = readSummary(value.summary) ?? draft.summary
    draft.stopReason = asString(value.stopReason)
    draft.exitCode = asNumber(value.exitCode)
    draft.signal = asString(value.signal)
    draft.timedOut = asBoolean(value.timedOut)
    draft.cancelled = asBoolean(value.cancelled)
    draft.usage = readUsage(value.usage)
    draft.error = asString(value.error)
    draft.stderrTail = asString(value.stderrTail)
    draft.reportExpected = asBoolean(value.reportExpected)
  }
  const records: DeskRun[] = []
  for (const draft of drafts.values()) {
    records.push({
      runId: draft.runId,
      task: draft.task,
      trigger: draft.trigger ?? { kind: 'manual' },
      status: draft.status,
      startedAt: draft.startedAt ?? '',
      finishedAt: draft.finishedAt,
      durationMs: draft.durationMs,
      sessionId: draft.sessionId,
      report: draft.report,
      signals: draft.signals,
      inputs: draft.inputs,
      summary: draft.summary,
      stopReason: draft.stopReason,
      exitCode: draft.exitCode,
      signal: draft.signal,
      timedOut: draft.timedOut,
      cancelled: draft.cancelled,
      usage: draft.usage,
      error: draft.error,
      stderrTail: draft.stderrTail,
      reportExpected: draft.reportExpected,
    })
  }
  records.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  return records.slice(0, maxRuns)
}
