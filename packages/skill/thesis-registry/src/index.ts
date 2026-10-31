/**
 * Durable thesis registry: one YAML manifest per testable conclusion under
 * `<harness home>/asset-library/theses`, with derived status, overdue flags,
 * and a registry-wide hit/miss score.
 *
 * The registry is the one owner of the manifest file format. `tool-thesis`
 * exposes it to the model, the desk service adopts report conclusions and
 * computes the scorecard, and the research-asset page reads the same records.
 * Status derives from the newest check; an absent check leaves the thesis
 * open. A thesis is due when its due date passed with no check dated at or
 * after it.
 *
 * @module @deepseek-ai/dsh-thesis
 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { parseDocument } from 'yaml'
import type {
  Config,
  ThesisCheck,
  ThesisManifest,
  ThesisRecord,
  ThesisScore,
  ThesisStatus,
  ThesisWriteInput,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable thesis registry. */
    thesis: ThesisRegistry
  }
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** The default registry root, `<harness home>/asset-library/theses`. */
function defaultThesesDir(): string {
  return dshHomePath('asset-library', 'theses')
}

/** Validate a thesis id; the pattern doubles as the traversal guard. */
function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`thesis id must be kebab-case (lowercase letters, digits and hyphens), got "${id}"`)
  }
}

/** Validate a `YYYY-MM-DD` string is a real calendar date, not just a pattern match. */
function assertDueDate(value: string): void {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`due_date must be YYYY-MM-DD, got "${value}"`)
  }
  const [year, month, day] = value.split('-').map(Number)
  /* v8 ignore next -- DATE_PATTERN admits exactly two dashes */
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`due_date must be YYYY-MM-DD, got "${value}"`)
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`due_date is not a real calendar date: "${value}"`)
  }
}

/** Parse one manifest YAML; malformed content fails loud rather than silently skipping the thesis. */
function parseManifest(fileId: string, text: string): ThesisManifest {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) {
    /* v8 ignore next -- a YAML error entry is an Error, whose message is always a string */
    throw new Error(`thesis "${fileId}" is not valid YAML: ${doc.errors[0]?.message ?? 'unknown parse error'}`)
  }
  const data = doc.toJS() as Record<string, unknown> | null
  if (typeof data !== 'object' || data === null) {
    throw new Error(`thesis "${fileId}" must be a YAML mapping`)
  }
  const stringField = (key: string): string => {
    const value = data[key]
    if (typeof value !== 'string' || value === '') {
      throw new Error(`thesis "${fileId}" field "${key}" must be a non-empty string`)
    }
    return value
  }
  const id = stringField('id')
  if (id !== fileId) throw new Error(`thesis "${fileId}" declares a different id: "${id}"`)
  const assets = data.assets
  if (!Array.isArray(assets)) throw new Error(`thesis "${id}" field "assets" must be an array`)
  const rawChecks = data.checks ?? []
  if (!Array.isArray(rawChecks)) throw new Error(`thesis "${id}" field "checks" must be an array`)
  const checks: ThesisCheck[] = []
  for (const raw of rawChecks) {
    const check = raw as Record<string, unknown> | null
    if (typeof check !== 'object' || check === null) throw new Error(`thesis "${id}" has a malformed check entry`)
    const outcome = check.outcome
    if (outcome !== 'hit' && outcome !== 'miss') throw new Error(`thesis "${id}" check outcome must be hit or miss`)
    if (typeof check.checked_at !== 'string' || typeof check.evidence !== 'string') {
      throw new Error(`thesis "${id}" check must carry checked_at and evidence`)
    }
    checks.push({ checkedAt: check.checked_at, outcome, evidence: check.evidence })
  }
  return {
    id,
    conclusion: stringField('conclusion'),
    metric: stringField('metric'),
    threshold: stringField('threshold'),
    dueDate: stringField('due_date'),
    report: stringField('report'),
    assets: assets.filter((asset): asset is string => typeof asset === 'string'),
    createdAt: stringField('created_at'),
    checks,
  }
}

/**
 * Serialize one manifest with stable field order. Hand-written rather than
 * `yaml` stringify: the record is small, and a hand-written mapping stays
 * byte-stable for the same manifest across library versions.
 */
function serializeManifest(manifest: ThesisManifest): string {
  const entries: [string, string | number | boolean | readonly unknown[]][] = [
    ['id', manifest.id],
    ['conclusion', manifest.conclusion],
    ['metric', manifest.metric],
    ['threshold', manifest.threshold],
    ['due_date', manifest.dueDate],
    ['report', manifest.report],
    ['assets', manifest.assets],
    ['created_at', manifest.createdAt],
  ]
  if (manifest.checks.length > 0) {
    entries.push(['checks', manifest.checks.map(check => ({
      checked_at: check.checkedAt,
      outcome: check.outcome,
      evidence: check.evidence,
    }))])
  }
  const lines: string[] = []
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`)
      } else if (value.every(item => typeof item === 'object' && item !== null)) {
        lines.push(`${key}:`)
        for (const item of value) {
          /* v8 ignore next -- parseManifest rejects non-string check fields */
          const fields = Object.entries(item as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
            .join(', ')
          lines.push(`  - { ${fields} }`)
        }
      } else {
        /* v8 ignore next -- parseManifest filters assets to strings */
        lines.push(`${key}: [${value.map(item => typeof item === 'string' ? JSON.stringify(item) : String(item)).join(', ')}]`)
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** Derived status: no checks yet is open; the newest check decides the rest. */
function statusOf(manifest: ThesisManifest): ThesisStatus {
  const last = manifest.checks.at(-1)
  return last === undefined ? 'open' : last.outcome
}

/** Local `YYYY-MM-DD` for today. */
function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Whether the due date passed with no check dated at or after it. */
function overdueOf(manifest: ThesisManifest, today: string = localToday()): boolean {
  if (manifest.checks.some(check => check.checkedAt.slice(0, 10) >= manifest.dueDate)) return false
  return manifest.dueDate < today
}

/** Hit/miss counts over a set of checks. */
function scoreOfChecks(checks: readonly ThesisCheck[]): ThesisScore {
  let hits = 0
  let misses = 0
  for (const check of checks) {
    if (check.outcome === 'hit') hits += 1
    else misses += 1
  }
  return { hits, misses, hitRate: hits + misses === 0 ? null : hits / (hits + misses) }
}

/** One stored manifest plus its derived facts. */
function recordOf(manifest: ThesisManifest, today?: string): ThesisRecord {
  return {
    ...manifest,
    status: statusOf(manifest),
    overdue: overdueOf(manifest, today ?? localToday()),
    score: scoreOfChecks(manifest.checks),
  }
}

/**
 * Durable thesis registry. Reads parse strictly; one unreadable manifest
 * fails the whole listing rather than disappearing from the score.
 */
export class ThesisRegistry extends Service {
  static Config: z<Config> = z.object({
    thesesDir: z.string(),
  })

  private readonly thesesDir: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'thesis')
    this.thesesDir = resolve(config.thesesDir ?? defaultThesesDir())
  }

  /** The registry root this instance reads and writes. */
  get dir(): string {
    return this.thesesDir
  }

  /**
   * Every thesis, sorted by due date then id.
   * @returns the records with derived status and overdue flags.
   */
  async list(): Promise<ThesisRecord[]> {
    let names: string[]
    try {
      names = await readdir(this.thesesDir)
    } catch {
      return []
    }
    const records: ThesisRecord[] = []
    for (const name of names.sort()) {
      if (!name.endsWith('.yaml')) continue
      const id = name.slice(0, -'.yaml'.length)
      records.push(recordOf(parseManifest(id, await readFile(join(this.thesesDir, name), 'utf-8'))))
    }
    return records.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id))
  }

  /**
   * One thesis by id.
   * @param id - thesis id.
   * @returns the record, or `undefined` when the registry has no such file.
   */
  async get(id: string): Promise<ThesisRecord | undefined> {
    assertId(id)
    let text: string
    try {
      text = await readFile(join(this.thesesDir, `${id}.yaml`), 'utf-8')
    } catch {
      return undefined
    }
    return recordOf(parseManifest(id, text))
  }

  /**
   * Upsert one thesis. Re-writing an id updates the stated fields and keeps its check history.
   * @param input - the complete stated fields.
   * @returns the stored record.
   */
  async write(input: ThesisWriteInput): Promise<ThesisRecord> {
    assertId(input.id)
    assertDueDate(input.dueDate)
    for (const key of ['conclusion', 'metric', 'threshold', 'report'] as const) {
      if (typeof input[key] !== 'string' || input[key].trim() === '') {
        throw new Error(`thesis ${key} must be a non-empty string`)
      }
    }
    const existing = await this.get(input.id)
    const manifest: ThesisManifest = {
      id: input.id,
      conclusion: input.conclusion,
      metric: input.metric,
      threshold: input.threshold,
      dueDate: input.dueDate,
      report: input.report,
      assets: [...(input.assets ?? [])].filter(asset => asset !== ''),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      checks: existing?.checks ?? [],
    }
    await this.writeManifest(manifest)
    return recordOf(manifest)
  }

  /**
   * Append one recheck outcome.
   * @param id - stored thesis id.
   * @param outcome - whether the metric met its threshold.
   * @param evidence - what the recheck actually measured.
   * @returns the updated record.
   * @throws when the thesis does not exist or the evidence is empty.
   */
  async mark(id: string, outcome: 'hit' | 'miss', evidence: string): Promise<ThesisRecord> {
    assertId(id)
    if (outcome !== 'hit' && outcome !== 'miss') {
      throw new Error(`outcome must be "hit" or "miss", got "${String(outcome)}"`)
    }
    if (evidence.trim() === '') throw new Error('evidence must not be empty — record what the recheck actually measured')
    const manifest = await this.get(id)
    if (manifest === undefined) throw new Error(`thesis "${id}" is not registered — call thesis_write first`)
    const updated: ThesisManifest = {
      ...manifest,
      checks: [...manifest.checks, {
        checkedAt: new Date().toISOString(),
        outcome,
        evidence,
      }],
    }
    await this.writeManifest(updated)
    return recordOf(updated)
  }

  /**
   * Registry-wide score over every check.
   * @returns the hit/miss counts and rate (`null` with no checks).
   */
  async score(): Promise<ThesisScore> {
    const records = await this.list()
    return scoreOfChecks(records.flatMap(record => [...record.checks]))
  }

  /**
   * Theses that need a recheck today: the due date passed with no check at or after it.
   * @param today - local `YYYY-MM-DD`; defaults to today.
   * @returns the overdue records in due-date order.
   */
  async due(today: string = localToday()): Promise<ThesisRecord[]> {
    const records = await this.list()
    return records.filter(record => overdueOf(record, today))
  }

  /** Atomically replace one manifest file. */
  private async writeManifest(manifest: ThesisManifest): Promise<void> {
    assertId(manifest.id)
    await mkdir(this.thesesDir, { recursive: true })
    const file = join(this.thesesDir, `${manifest.id}.yaml`)
    const tmp = `${file}.tmp`
    await writeFile(tmp, serializeManifest(manifest), 'utf-8')
    await rename(tmp, file)
  }
}

export default ThesisRegistry
