/**
 * Desk task YAML read and write, mirroring the field names
 * `finance/python/findeck/desk.py` validates. The Python validator is the
 * authority for a write; these functions only project a file it accepted into
 * the typed spec and serialize the spec back in stable key order.
 * @module @deepseek-ai/dsh-desk/tasks
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { DeskBudget, DeskRefresh, DeskTarget, DeskTaskSpec } from './types.ts'
import type { DeskTrigger } from './types.ts'

const TOP_KEYS = new Set([
  'name', 'display_name', 'goal', 'enabled', 'targets', 'trigger', 'report', 'budget', 'proposed_by',
])
const TARGET_KINDS = new Set(['symbol', 'theme', 'thesis', 'asset', 'workbench'])
const TRIGGER_KINDS = new Set(['cron', 'interval', 'event', 'thesis-due'])

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${where} must be a non-empty string`)
  return value
}

function asPositiveInt(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${where} must be a positive integer`)
  }
  return value
}

function parseRefresh(value: unknown, where: string): DeskRefresh {
  const record = asRecord(value, where)
  if (record.kind === 'verb') {
    return {
      kind: 'verb',
      asset: asString(record.asset, `${where}.asset`),
      verb: asString(record.verb, `${where}.verb`),
    }
  }
  if (record.kind === 'pipeline') {
    return { kind: 'pipeline', name: asString(record.name, `${where}.name`) }
  }
  throw new Error(`${where}.kind must be verb or pipeline`)
}

function parseTarget(value: unknown, index: number): DeskTarget {
  const where = `targets[${String(index)}]`
  const record = asRecord(value, where)
  const kind = asString(record.kind, `${where}.kind`)
  if (!TARGET_KINDS.has(kind)) throw new Error(`${where}.kind is not one of symbol/theme/thesis/asset/workbench`)
  return {
    kind: kind as DeskTarget['kind'],
    ref: asString(record.ref, `${where}.ref`),
    ...record.refresh === undefined ? {} : { refresh: parseRefresh(record.refresh, `${where}.refresh`) },
  }
}

function parseTrigger(value: unknown, index: number): DeskTrigger {
  const where = `trigger[${String(index)}]`
  const record = asRecord(value, where)
  const kind = asString(record.kind, `${where}.kind`)
  if (!TRIGGER_KINDS.has(kind)) throw new Error(`${where}.kind is not a desk trigger`)
  if (kind === 'cron') return { kind: 'cron', schedule: asString(record.schedule, `${where}.schedule`) }
  if (kind === 'interval') return { kind: 'interval', everySeconds: asPositiveInt(record.everySeconds, `${where}.everySeconds`) }
  if (kind === 'event') return { kind: 'event', name: asString(record.name, `${where}.name`) }
  return { kind: 'thesis-due' }
}

function parseBudget(value: unknown): DeskBudget {
  const record = asRecord(value, 'budget')
  return {
    tokens: asPositiveInt(record.tokens, 'budget.tokens'),
    wallSeconds: asPositiveInt(record.wallSeconds, 'budget.wallSeconds'),
    ...record.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: asPositiveInt(record.maxOutputTokens, 'budget.maxOutputTokens') },
  }
}

/**
 * Project one validated task file into the typed spec.
 * @param text - complete YAML text.
 * @param path - file path named in diagnostics.
 * @returns the parsed spec.
 * @throws when the document is not the mapping the Python validator accepted.
 */
export function parseTaskYaml(text: string, path: string): DeskTaskSpec {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (error) {
    throw new Error(`${path}: YAML parse failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const record = asRecord(raw, `${path}: top level`)
  const unknown = Object.keys(record).filter(key => !TOP_KEYS.has(key))
  if (unknown.length > 0) throw new Error(`${path}: unknown top-level fields ${unknown.join(', ')}`)
  const targets = record.targets
  if (!Array.isArray(targets) || targets.length === 0) throw new Error(`${path}: targets must be a non-empty list`)
  const triggers = record.trigger
  if (!Array.isArray(triggers) || triggers.length === 0) throw new Error(`${path}: trigger must be a non-empty list`)
  const report = record.report
  if (report !== 'always' && report !== 'changes') throw new Error(`${path}: report must be always or changes`)
  if (record.proposed_by !== 'user') throw new Error(`${path}: proposed_by must be user`)
  const enabled = record.enabled === undefined ? true : record.enabled
  if (typeof enabled !== 'boolean') throw new Error(`${path}: enabled must be a boolean`)
  return {
    name: asString(record.name, `${path}: name`),
    displayName: asString(record.display_name, `${path}: display_name`),
    goal: asString(record.goal, `${path}: goal`),
    enabled,
    targets: targets.map(parseTarget),
    triggers: triggers.map(parseTrigger),
    report,
    budget: parseBudget(record.budget),
    proposedBy: 'user',
  }
}

/**
 * Serialize one spec in the field order the Python validator documents.
 * @param spec - complete task spec.
 * @returns YAML text with a trailing newline.
 */
export function serializeTask(spec: DeskTaskSpec): string {
  const document = {
    name: spec.name,
    display_name: spec.displayName,
    goal: spec.goal,
    enabled: spec.enabled,
    targets: spec.targets.map(target => ({
      kind: target.kind,
      ref: target.ref,
      ...target.refresh === undefined
        ? {}
        : target.refresh.kind === 'verb'
          ? { refresh: { kind: 'verb', asset: target.refresh.asset, verb: target.refresh.verb } }
          : { refresh: { kind: 'pipeline', name: target.refresh.name } },
    })),
    trigger: spec.triggers.map(trigger =>
      trigger.kind === 'cron'
        ? { kind: 'cron', schedule: trigger.schedule }
        : trigger.kind === 'interval'
          ? { kind: 'interval', everySeconds: trigger.everySeconds }
          : trigger.kind === 'event'
            ? { kind: 'event', name: trigger.name }
            : { kind: 'thesis-due' }),
    report: spec.report,
    budget: {
      tokens: spec.budget.tokens,
      wallSeconds: spec.budget.wallSeconds,
      ...spec.budget.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: spec.budget.maxOutputTokens },
    },
    proposed_by: spec.proposedBy,
  }
  return `${stringifyYaml(document, { lineWidth: 0 })}`
}
