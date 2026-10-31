/**
 * Read pipeline yaml files and parse automation run logs.
 * @module @deepseek-ai/dsh-automation-runner
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { appendFile, mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { cronOf } from './clock.ts'
import type { AutomationLastResult, AutomationTrigger, DeskRunTrigger } from './types.ts'

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** One pipeline file the runner can execute. */
export interface PipelineFile {
  readonly name: string
  readonly path: string
  readonly trigger: AutomationTrigger
}

/** One parsed JSON line of a run log. */
export interface RunLogLine {
  readonly value: Record<string, unknown>
  /** Raw line, kept for diagnostics that must not lose the unreadable record. */
  readonly raw: string
}

/**
 * Local-time ISO timestamp with a numeric offset, second precision.
 * @param ms - wall-clock milliseconds.
 * @returns the timestamp written into pipeline and desk run lines.
 */
export function localIso(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/**
 * Load every `*.yaml` in `dir`. A missing directory, a bad file, or a duplicate name throws.
 * @param dir - absolute pipelines directory.
 * @returns the files in filename order.
 */
export function loadPipelines(dir: string): PipelineFile[] {
  if (!existsSync(dir)) throw new Error(`automation pipelinesDir does not exist: ${dir}`)
  const names = readdirSync(dir).filter(name => name.endsWith('.yaml')).sort()
  const files: PipelineFile[] = []
  const seen = new Set<string>()
  for (const filename of names) {
    const path = join(dir, filename)
    const file = readPipeline(path, filename.slice(0, -'.yaml'.length))
    if (seen.has(file.name)) throw new Error(`${path}: duplicate pipeline name ${file.name}`)
    seen.add(file.name)
    files.push(file)
  }
  return files
}

/**
 * Parse one desk trigger as the runner arms it. Cron and interval are the only
 * scheduled kinds; event and thesis-due stay with the desk host service.
 * @param trigger - task trigger, already parsed from YAML.
 * @param file - task path named in errors.
 */
export function assertDeskTrigger(trigger: DeskRunTrigger | { readonly kind: string }, file: string): void {
  switch (trigger.kind) {
    case 'manual':
    case 'event':
    case 'thesis-due':
      return
    case 'cron': {
      const schedule = (trigger as { schedule?: unknown }).schedule
      if (typeof schedule !== 'string' || schedule.trim() === '') {
        throw new Error(`${file}: cron trigger requires schedule`)
      }
      cronOf(schedule.trim(), file)
      return
    }
    case 'interval': {
      const every = (trigger as { everySeconds?: unknown }).everySeconds
      if (typeof every !== 'number' || !Number.isSafeInteger(every) || every < 1) {
        throw new Error(`${file}: interval trigger requires a positive integer everySeconds`)
      }
      return
    }
    default:
      throw new Error(`${file}: unknown desk trigger kind ${JSON.stringify(trigger.kind)}`)
  }
}

/**
 * The latest `pipeline-runs` line, or `null` when the file is missing or empty.
 * A non-JSON last line throws.
 * @param assetDir - asset library root.
 * @param name - pipeline name.
 * @returns the parsed tail.
 */
export function readLastResult(assetDir: string, name: string): AutomationLastResult | null {
  return readLastResultAt(runLogPath(assetDir, name))
}

/**
 * The latest jsonl line at `file`, or `null` when the file is missing or empty.
 * A non-JSON last line, or a line missing `ts` or `status`, throws.
 * @param file - absolute jsonl path.
 * @returns the parsed tail.
 */
export function readLastResultAt(file: string): AutomationLastResult | null {
  if (!existsSync(file)) return null
  const lines = readFileSync(file, 'utf8').split('\n').filter(line => line.trim() !== '')
  const last = lines[lines.length - 1]
  if (last === undefined) return null
  let value: unknown
  try {
    value = JSON.parse(last)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${file}: last line is not JSON: ${message}`)
  }
  if (!isRecord(value) || typeof value.ts !== 'string' || typeof value.status !== 'string') {
    throw new Error(`${file}: last line is missing ts or status`)
  }
  const exitCode = value.exitCode
  const signal = value.signal
  return {
    ts: value.ts,
    status: value.status,
    exitCode: typeof exitCode === 'number' ? exitCode : null,
    timedOut: value.timedOut === true,
    signal: typeof signal === 'string' ? signal : null,
  }
}

/**
 * The latest finished desk run in a run log, or `null`. A report line is not a
 * run outcome, so only `step: runner` / `event: finished` lines decide it.
 * @param file - absolute desk run jsonl.
 * @returns the latest finished run's summary.
 */
export function readLastDeskResult(file: string): AutomationLastResult | null {
  if (!existsSync(file)) return null
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const raw = lines[index]
    if (raw === undefined || raw.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${file}: line ${String(index + 1)} is not JSON: ${message}`)
    }
    if (!isRecord(value)) throw new Error(`${file}: line ${String(index + 1)} is not a JSON object`)
    if (value.step !== 'runner' || value.event !== 'finished') continue
    if (typeof value.ts !== 'string' || typeof value.status !== 'string') {
      throw new Error(`${file}: finished line is missing ts or status`)
    }
    const exitCode = value.exitCode
    const signal = value.signal
    return {
      ts: value.ts,
      status: value.status,
      exitCode: typeof exitCode === 'number' ? exitCode : null,
      timedOut: value.timedOut === true,
      signal: typeof signal === 'string' ? signal : null,
    }
  }
  return null
}

/**
 * Parse the complete run log bounded to `maxBytes` from the tail. A byte window
 * that starts mid-line drops that first partial line. Malformed JSON fails loud:
 * a torn record means the log itself is not trustworthy.
 * @param file - absolute jsonl path.
 * @param maxBytes - read bound; older lines are reported as truncated.
 * @returns parsed lines in file order plus whether older history was cut.
 */
export async function readRunLog(file: string, maxBytes: number): Promise<{ lines: RunLogLine[]; truncated: boolean }> {
  if (!existsSync(file)) return { lines: [], truncated: false }
  let text: string
  let truncated = false
  const handle = await open(file, 'r')
  try {
    const stat = await handle.stat()
    if (stat.size <= maxBytes) {
      text = (await handle.readFile({ encoding: 'utf8' })) as string
    } else {
      truncated = true
      const buffer = Buffer.alloc(maxBytes)
      await handle.read(buffer, 0, maxBytes, stat.size - maxBytes)
      const slice = buffer.toString('utf8')
      const firstNewline = slice.indexOf('\n')
      text = firstNewline === -1 ? '' : slice.slice(firstNewline + 1)
    }
  } finally {
    await handle.close()
  }
  const lines: RunLogLine[] = []
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${file}: run log line is not JSON: ${message}`)
    }
    if (!isRecord(value)) throw new Error(`${file}: run log line is not a JSON object`)
    lines.push({ value, raw })
  }
  return { lines, truncated }
}

/**
 * The desk run log path for one task.
 * @param deskRunsDir - directory holding `<task>.jsonl`.
 * @param name - desk task name.
 */
export function deskRunLogPath(deskRunsDir: string, name: string): string {
  return join(deskRunsDir, `${name}.jsonl`)
}

/**
 * Append one jsonl line. Writes are serialized per file so two outcomes cannot tear a line.
 * @param assetDir - asset library root.
 * @param name - pipeline name.
 * @param record - one JSON object. Existing python keys stay; runner-only keys are additions.
 */
export async function appendRunLine(assetDir: string, name: string, record: Record<string, unknown>): Promise<void> {
  await appendJsonlLine(runLogPath(assetDir, name), record)
}

/**
 * Append one JSON line to an absolute jsonl path.
 * Writes are serialized per file so two outcomes cannot tear a line.
 * @param file - absolute jsonl path. Parent directories are created.
 * @param record - one JSON object.
 */
export async function appendJsonlLine(file: string, record: Record<string, unknown>): Promise<void> {
  const pending = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
  })
  writes.set(file, pending)
  await pending
}

/** Parse a timestamp from a run line. Invalid timestamps throw. */
export function parseRecordTime(ts: string, file: string): number {
  const at = Date.parse(ts)
  if (Number.isNaN(at)) throw new Error(`${file}: run record ts is not a timestamp: ${ts}`)
  return at
}

const writes = new Map<string, Promise<void>>()

function runLogPath(assetDir: string, name: string): string {
  return join(assetDir, 'pipeline-runs', `${name}.jsonl`)
}

function readPipeline(path: string, stem: string): PipelineFile {
  let value: unknown
  try {
    value = parseYaml(readFileSync(path, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${path}: YAML parse failed: ${message}`)
  }
  if (!isRecord(value)) throw new Error(`${path}: top level must be a mapping`)
  const unknown = Object.keys(value).filter(key => !['name', 'description', 'trigger', 'steps'].includes(key))
  if (unknown.length > 0) throw new Error(`${path}: unknown top-level fields ${unknown.join(', ')}`)
  if (typeof value.name !== 'string' || !KEBAB.test(value.name)) {
    throw new Error(`${path}: name must be kebab-case`)
  }
  if (value.name !== stem) throw new Error(`${path}: name ${value.name} does not match filename ${stem}`)
  if (typeof value.description !== 'string' || value.description.trim() === '') {
    throw new Error(`${path}: description must be a non-empty string`)
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new Error(`${path}: steps must be a non-empty list`)
  }
  return { name: value.name, path, trigger: readTrigger(value.trigger, path) }
}

function readTrigger(value: unknown, file: string): AutomationTrigger {
  if (!isRecord(value)) throw new Error(`${file}: trigger must be an object`)
  const unknown = Object.keys(value).filter(key => !['kind', 'schedule', 'everySeconds'].includes(key))
  if (unknown.length > 0) throw new Error(`${file}: trigger has unknown fields ${unknown.join(', ')}`)
  if (value.kind === 'manual') {
    if ('schedule' in value || 'everySeconds' in value) {
      throw new Error(`${file}: manual trigger does not take schedule or everySeconds`)
    }
    return { kind: 'manual' }
  }
  if (value.kind === 'cron') {
    if (typeof value.schedule !== 'string' || value.schedule.trim() === '') {
      throw new Error(`${file}: cron trigger requires schedule`)
    }
    if ('everySeconds' in value) throw new Error(`${file}: cron trigger does not take everySeconds`)
    const schedule = value.schedule.trim()
    cronOf(schedule, file)
    return { kind: 'cron', schedule }
  }
  if (value.kind === 'interval') {
    const every = value.everySeconds
    if (typeof every !== 'number' || !Number.isSafeInteger(every) || every < 1) {
      throw new Error(`${file}: interval trigger requires a positive integer everySeconds`)
    }
    if ('schedule' in value) throw new Error(`${file}: interval trigger does not take schedule`)
    return { kind: 'interval', everySeconds: every }
  }
  throw new Error(`${file}: trigger.kind must be manual, cron, or interval`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
