/**
 * Model-facing tools over the FinDeck global asset workspace: discovery,
 * inspection, and execution of archived research assets, plus a durable
 * session catalog published through the session-catalog machinery this
 * repository's skill catalog established.
 *
 * The library layout and `manifest.yaml` format are owned by
 * `finance/python/findeck/assets.py`; this plugin reads the machine-readable
 * `index.json` (version 2, which adds `origin`, `verbs`, `freshness`,
 * `lineage`, `tags`, and `face` to every asset summary, and still reads
 * version 1)
 * that module rebuilds on every archive. `asset_run` executes the
 * asset's entry function inside the finance Python virtual environment through
 * the subprocess Service Definition, behind the harness approval seam;
 * `asset_run_bg` submits the same kind of work as a detached background run
 * without the approval seam, and reports the accepted run to the roundtable
 * engine when that service is composed. Every successful
 * `asset_search`/`asset_show`/`asset_run`/`asset_run_bg` call also appends one
 * line to `<assetDir>/usage.jsonl` (`{ts, tool, asset?, session?}`), the
 * durable call log the library's hit-rate and activity statistics are computed
 * from.
 *
 * @module @deepseek-ai/dsh-tool-asset-library
 */

import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { defineTool, type InferValue } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { catalogDescription, escapeText, publishSessionCatalog, type SessionCatalog } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type {
  AssetFreshness,
  AssetKind,
  AssetLibraryIndex,
  AssetLineage,
  AssetManifest,
  AssetOrigin,
  AssetProducer,
  AssetSummary,
} from './types.ts'

/**
 * Durable record for the model-facing asset catalog message, mirroring the
 * rendered catalog lines: a consumer presenting the list reads these entries
 * instead of re-parsing the `<available_assets>` block.
 */
export interface AssetCatalogSource {
  readonly kind: 'asset-library-catalog'
  readonly form: 'catalog'
  /** Marks a replacement catalog rather than this session's first publication. */
  readonly update?: true
  /** Exactly the entries this message published, in catalog order. */
  readonly entries: readonly {
    readonly name: string
    readonly kind: string
    readonly version: number
    readonly description: string
  }[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'asset-library-catalog': AssetCatalogSource
  }
}

export const name = 'tool-asset-library'
export const inject = ['tools', 'subprocess']

/**
 * The default asset-library root, `<harness home>/asset-library`, under the
 * configured home, `$DSH_HOME`, or the default `~/.findeck`.
 * @returns the absolute default library root.
 */
function defaultAssetDir(): string {
  return dshHomePath('asset-library')
}

/* v8 ignore start -- POSIX lanes exercise the venv bin/ peer; Windows always resolves the Scripts/ path. */
const VENV_PYTHON_REL = process.platform === 'win32'
  ? 'finance/python/.venv/Scripts/python.exe'
  : 'finance/python/.venv/bin/python'
/* v8 ignore stop */
const DEFAULT_PYTHON_PATH = fileURLToPath(new URL(`../../../../${VENV_PYTHON_REL}`, import.meta.url))

const CATALOG_DESCRIPTION_MAX_LENGTH = 240
const CODE_PREVIEW_MAX_BYTES = 1200
const CODE_PREVIEW_MAX_FILES = 2

/** Exit codes of the in-venv driver, parsed by {@link parseDriverOutput}. */
const EXIT_MISSING_DEPS = 3
const EXIT_DRIVER_ERROR = 4

/**
 * Runs inside the finance venv: loads the asset's manifest, refuses on missing
 * dependencies (listing them, never installing), imports the asset's `.py`
 * files, and calls the entry with the decoded keyword arguments. Result or
 * failure travels on a marker line so asset prints ahead of it stay readable.
 */
const DRIVER = [
  'import importlib.util, json, sys',
  'from pathlib import Path',
  'MARK_RESULT = "###FINDECK_RESULT###"',
  'MARK_MISSING = "###FINDECK_MISSING###"',
  'MARK_ERROR = "###FINDECK_ERROR###"',
  'asset_dir, entry, args_json = sys.argv[1], sys.argv[2], sys.argv[3]',
  'try:',
  '    args = json.loads(args_json)',
  'except Exception as e:',
  `    print(MARK_ERROR); print(f"args_json is not valid JSON: {e}"); sys.exit(${EXIT_DRIVER_ERROR})`,
  'if not isinstance(args, dict):',
  `    print(MARK_ERROR); print("args_json must be a JSON object of keyword arguments"); sys.exit(${EXIT_DRIVER_ERROR})`,
  'import yaml',
  'manifest = yaml.safe_load((Path(asset_dir) / "manifest.yaml").read_text(encoding="utf-8"))',
  'missing = []',
  'for dep in manifest.get("dependencies") or []:',
  '    try:',
  '        if importlib.util.find_spec(dep) is None:',
  '            missing.append(dep)',
  '    except Exception:',
  '        missing.append(dep)',
  'if missing:',
  `    print(MARK_MISSING); print(json.dumps(sorted(set(missing)), ensure_ascii=False)); sys.exit(${EXIT_MISSING_DEPS})`,
  'fn = None',
  'for py in sorted(Path(asset_dir).glob("*.py")):',
  '    spec = importlib.util.spec_from_file_location(py.stem, py)',
  '    mod = importlib.util.module_from_spec(spec)',
  '    spec.loader.exec_module(mod)',
  '    if hasattr(mod, entry):',
  '        fn = getattr(mod, entry)',
  '        break',
  'if fn is None:',
  `    print(MARK_ERROR); print(f"entry \\"{entry}\\" not found in any .py file of the asset"); sys.exit(${EXIT_DRIVER_ERROR})`,
  'result = fn(**args)',
  'print(MARK_RESULT)',
  'print(json.dumps(result, ensure_ascii=False, default=str))',
].join('\n')

/** Model-facing asset-library tool configuration. */
export interface Config {
  /** Asset library root; defaults to `<harness home>/asset-library` (`$DSH_HOME`, else `~/.findeck`; mirrors `findeck.assets`). */
  readonly assetDir?: string
  /** Finance venv interpreter used by `asset_run`; defaults to the repository's `finance/python/.venv`. */
  readonly pythonPath?: string
  /** Whether `asset_run` must pass the approval seam (user-visible, rejectable); default `true`. */
  readonly requireApproval?: boolean
  /**
   * Whether this composition registers `asset_run_bg`. Default `true`; the
   * unattended desk composition sets `false` because its permission preset
   * allows a foreground library run and not a detached submission.
   */
  readonly background?: boolean
  /**
   * Whether `asset_run` and `asset_run_bg` must execute inside the composed
   * sandbox with the asset library as their only writable root. Default
   * `false`, which leaves the ordinary interactive research semantics alone;
   * the unattended desk composition sets `true` so an asset function cannot
   * write outside the library.
   */
  readonly sandbox?: boolean
  /** Per-stream collected output cap for one `asset_run` call, in bytes. */
  readonly maxOutputBytes?: number
  /** Termination grace for `asset_run` child processes, in milliseconds. */
  readonly graceMs?: number
}

/** Validate and default the asset-library tool configuration. */
export const Config: z<Config> = z.object({
  assetDir: z.string(),
  pythonPath: z.string().default(DEFAULT_PYTHON_PATH),
  requireApproval: z.boolean().default(true),
  background: z.boolean().default(true),
  sandbox: z.boolean().default(false),
  maxOutputBytes: z.number().default(256 * 1024),
  graceMs: z.number().default(15_000),
})

/** Read the library index; undefined when absent or not a valid index file. */
async function readIndex(assetDir: string): Promise<AssetLibraryIndex | undefined> {
  try {
    return parseIndex(JSON.parse(await readFile(join(assetDir, 'index.json'), 'utf-8')))
  } catch {
    return undefined
  }
}

/**
 * Sentinel an optional version-2 field parser returns for a field that is
 * present with the wrong type; one such field voids the whole index file.
 */
const MALFORMED_FIELD = Symbol('malformed index field')

/** Parse an optional `string[]` index field: absent yields `undefined`, a non-string element voids the file. */
function parseStringArrayField(value: unknown): readonly string[] | undefined | typeof MALFORMED_FIELD {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) return MALFORMED_FIELD
  return [...value] as string[]
}

/**
 * Parse the optional `origin` field. Absent yields `undefined` and JSON `null`
 * yields `null` — a version-1 entry may record either — while any other value
 * voids the file.
 */
function parseOriginField(value: unknown): AssetOrigin | null | undefined | typeof MALFORMED_FIELD {
  if (value === undefined || value === null) return value
  return value === 'agent' || value === 'user' || value === 'imported' ? value : MALFORMED_FIELD
}

/** Parse the optional `freshness` field; absent and JSON `null` both yield `null`. */
function parseFreshnessField(value: unknown): AssetFreshness | null | typeof MALFORMED_FIELD {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return MALFORMED_FIELD
  const { as_of, update_frequency } = value as Record<string, unknown>
  if (typeof as_of !== 'string') return MALFORMED_FIELD
  if (update_frequency !== undefined && typeof update_frequency !== 'string') return MALFORMED_FIELD
  return update_frequency === undefined ? { as_of } : { as_of, update_frequency }
}

/** Parse the optional `lineage` field; absent and JSON `null` both yield `null`. */
function parseLineageField(value: unknown): AssetLineage | null | typeof MALFORMED_FIELD {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return MALFORMED_FIELD
  const { producer, inputs } = value as Record<string, unknown>
  const parsedInputs = parseStringArrayField(inputs)
  if (parsedInputs === MALFORMED_FIELD) return MALFORMED_FIELD
  let parsedProducer: AssetProducer | undefined
  if (producer !== undefined) {
    if (typeof producer !== 'object' || Array.isArray(producer)) return MALFORMED_FIELD
    const { script, params, session } = producer as Record<string, unknown>
    if (script !== undefined && typeof script !== 'string') return MALFORMED_FIELD
    if (session !== undefined && typeof session !== 'string') return MALFORMED_FIELD
    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
      return MALFORMED_FIELD
    }
    parsedProducer = {
      ...(script === undefined ? {} : { script }),
      ...(params === undefined ? {} : { params: params as Record<string, unknown> }),
      ...(session === undefined ? {} : { session }),
    }
  }
  return {
    ...(parsedProducer === undefined ? {} : { producer: parsedProducer }),
    ...(parsedInputs === undefined ? {} : { inputs: parsedInputs }),
  }
}

/**
 * Parse the optional `face` field. Absent yields `undefined` and JSON `null`
 * yields `null` — an asset that declares no visualization — while any other
 * value voids the file.
 */
function parseFaceField(value: unknown): string | null | undefined | typeof MALFORMED_FIELD {
  if (value === undefined || value === null) return value
  return typeof value === 'string' ? value : MALFORMED_FIELD
}

/**
 * Defensive parse of the durable on-disk index: index version 1 and 2 are
 * readable, any other version and any malformed entry void the file. Version-1
 * entries carry none of the version-2 fields and parse to their defaults
 * (`origin`/`face` stay unset, `verbs`/`tags` become `[]`,
 * `freshness`/`lineage` become `null`).
 */
function parseIndex(data: unknown): AssetLibraryIndex | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const { version, updated, assets } = data as { version?: unknown; updated?: unknown; assets?: unknown }
  if ((version !== 1 && version !== 2) || typeof updated !== 'string' || !Array.isArray(assets)) return undefined
  const parsed: AssetSummary[] = []
  for (const asset of assets) {
    if (typeof asset !== 'object' || asset === null) return undefined
    const summary = asset as Record<string, unknown>
    if (typeof summary.name !== 'string' || typeof summary.kind !== 'string') return undefined
    if (typeof summary.latest_version !== 'number' || typeof summary.description !== 'string') return undefined
    if (typeof summary.validation !== 'string' || !Array.isArray(summary.depends_on)) return undefined
    if (!Array.isArray(summary.versions)) return undefined
    const origin = parseOriginField(summary.origin)
    const verbs = parseStringArrayField(summary.verbs)
    const freshness = parseFreshnessField(summary.freshness)
    const lineage = parseLineageField(summary.lineage)
    const tags = parseStringArrayField(summary.tags)
    const face = parseFaceField(summary.face)
    if (origin === MALFORMED_FIELD || verbs === MALFORMED_FIELD || freshness === MALFORMED_FIELD
      || lineage === MALFORMED_FIELD || tags === MALFORMED_FIELD || face === MALFORMED_FIELD) return undefined
    parsed.push({
      name: summary.name,
      kind: summary.kind as AssetSummary['kind'],
      latest_version: summary.latest_version,
      description: summary.description,
      validation: summary.validation,
      depends_on: summary.depends_on.filter((d): d is string => typeof d === 'string'),
      versions: summary.versions.filter((v): v is AssetSummary['versions'][number] =>
        typeof v === 'object' && v !== null && typeof (v as { version?: unknown }).version === 'number'),
      ...(origin === undefined ? {} : { origin }),
      verbs: verbs ?? [],
      freshness,
      lineage,
      tags: tags ?? [],
      ...(face === undefined ? {} : { face }),
    })
  }
  return { version, updated, assets: parsed }
}

/** Resolve one asset version's directory from the index, or throw a loud error. */
function resolveVersion(
  index: AssetLibraryIndex,
  name: string,
  version: number | undefined,
  assetDir: string,
): { dir: string; version: number; manifest: AssetSummary['versions'][number]['manifest'] } {
  const asset = index.assets.find(entry => entry.name === name)
  if (!asset) {
    const available = index.assets.map(entry => entry.name)
    throw new Error(`asset "${name}" is not in the library; available: ${JSON.stringify(available)}`)
  }
  const wanted = version ?? asset.latest_version
  const entry = asset.versions.find(candidate => candidate.version === wanted)
  if (!entry) {
    throw new Error(`asset "${name}" has no version v${wanted}; versions: ${JSON.stringify(asset.versions.map(candidate => candidate.version))}`)
  }
  return { dir: join(assetDir, name, `v${wanted}`), version: wanted, manifest: entry.manifest }
}

/** Relative file list of a version directory (depth ≤ 2, sorted). */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (current: string, depth: number): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name)
      if (entry.isDirectory() && depth < 2) await walk(child, depth + 1)
      else out.push(relative(dir, child).replaceAll('\\', '/'))
    }
  }
  await walk(dir, 0)
  return out.sort()
}

/** Concatenated head of the asset's Python files, for the model to read before running. */
async function codePreview(dir: string): Promise<string> {
  const files = (await listFiles(dir)).filter(file => file.endsWith('.py')).slice(0, CODE_PREVIEW_MAX_FILES)
  const parts: string[] = []
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf-8')
    parts.push(`# ${file}\n${text.length > CODE_PREVIEW_MAX_BYTES ? `${text.slice(0, CODE_PREVIEW_MAX_BYTES)}…` : text}`)
  }
  return parts.join('\n\n')
}

/** Driver stdout split at its marker: the payload after the last marker line. */
function parseDriverOutput(stdout: string, marker: string): string | undefined {
  const at = stdout.lastIndexOf(marker)
  if (at === -1) return undefined
  return stdout.slice(at + marker.length).trim()
}

/**
 * Parse the background submission's stdout: the bridge prints one JSON line
 * with the accepted run's id. Any other output is a refusal the caller reports
 * as a failed submission, and warnings a dependency printed earlier on the
 * stream do not hide the last line's JSON.
 */
function parseRunId(stdout: string): string | undefined {
  const line = stdout.trim().split(/\r?\n/u).at(-1) ?? ''
  try {
    const parsed = JSON.parse(line) as { run_id?: unknown }
    return typeof parsed.run_id === 'string' && parsed.run_id !== '' ? parsed.run_id : undefined
  } catch {
    // The parse is the only statement in the `try`, so this swallows exactly
    // one non-JSON stdout; the caller reports the missing id with that output.
    return undefined
  }
}

/** One row of a dependency closure: the asset (or a missing name) at its BFS depth. */
interface ClosureRow {
  readonly name: string
  readonly depth: number
  readonly kind?: string
  readonly latest_version?: number
  readonly missing?: boolean
}

/**
 * Direct `depends_on` of one asset version: the named version's manifest when
 * `version` is given, else the latest-version summary. An unknown name or
 * version has no direct dependencies of its own here — the caller's
 * `resolveVersion` already refused unknown roots loudly.
 */
function directDependenciesOf(index: AssetLibraryIndex, name: string, version: number | undefined): string[] {
  const asset = index.assets.find(entry => entry.name === name)
  if (asset === undefined) return []
  if (version === undefined) return [...asset.depends_on]
  const entry = asset.versions.find(candidate => candidate.version === version)
  return entry === undefined ? [...asset.depends_on] : [...entry.manifest.depends_on]
}

/**
 * BFS closure of what `name@version` transitively depends on. The root's
 * direct dependencies honor `version`; every deeper asset walks at its latest
 * version. Names absent from the library surface as `missing` rows instead of
 * ending the walk. First discovery fixes the minimal depth; a visited set
 * makes cyclic graphs terminate.
 */
function dependencyClosureOf(index: AssetLibraryIndex, name: string, version: number | undefined): ClosureRow[] {
  const rows = new Map<string, ClosureRow>()
  const queue: { name: string; depth: number }[] =
    directDependenciesOf(index, name, version).map(dep => ({ name: dep, depth: 1 }))
  while (queue.length > 0) {
    const item = queue.shift()
    /* v8 ignore next 2 -- the queue is only ever extended with non-empty dep names, so shift() always yields. */
    if (item === undefined) break
    if (rows.has(item.name)) continue
    const asset = index.assets.find(entry => entry.name === item.name)
    rows.set(item.name, asset === undefined
      ? { name: item.name, depth: item.depth, missing: true }
      : { name: item.name, depth: item.depth, kind: asset.kind, latest_version: asset.latest_version })
    if (asset !== undefined) {
      for (const dep of asset.depends_on) queue.push({ name: dep, depth: item.depth + 1 })
    }
  }
  return [...rows.values()].sort((left, right) => left.depth - right.depth || left.name.localeCompare(right.name))
}

/** Every asset whose latest-version dependency closure contains `target`, at reverse-BFS depth. */
function reverseDependentsOf(index: AssetLibraryIndex, target: string): {
  name: string
  depth: number
  kind: string
  latest_version: number
}[] {
  const dependentsOf = new Map<string, string[]>()
  for (const asset of index.assets) {
    for (const dep of asset.depends_on) {
      const list = dependentsOf.get(dep) ?? []
      list.push(asset.name)
      dependentsOf.set(dep, list)
    }
  }
  const rows: { name: string; depth: number; kind: string; latest_version: number }[] = []
  const seen = new Set<string>([target])
  let frontier = [target]
  let depth = 0
  while (frontier.length > 0) {
    depth += 1
    const next: string[] = []
    for (const node of frontier) {
      for (const dependent of dependentsOf.get(node) ?? []) {
        if (seen.has(dependent)) continue
        seen.add(dependent)
        next.push(dependent)
        const asset = index.assets.find(entry => entry.name === dependent)
        /* v8 ignore next 2 -- reverse edges are built from index assets, so the dependent always resolves. */
        if (asset === undefined) continue
        rows.push({ name: dependent, depth, kind: asset.kind, latest_version: asset.latest_version })
      }
    }
    frontier = next
  }
  return rows.sort((left, right) => left.depth - right.depth || left.name.localeCompare(right.name))
}

/**
 * Structured retrieval conditions of `asset_search`. Every condition present
 * must match (AND); case-insensitive fields arrive already trimmed and
 * lowercased, and an empty value means "no condition".
 */
interface AssetSearchFilters {
  readonly query?: string | undefined
  readonly kind?: AssetKind | undefined
  readonly origin?: AssetOrigin | undefined
  readonly tag?: string | undefined
  readonly verb?: string | undefined
  readonly dependsOn?: string | undefined
}

/** Whether one index summary satisfies every present `asset_search` condition. */
function matchesSearchFilters(asset: AssetSummary, filters: AssetSearchFilters): boolean {
  const { query, kind, origin, tag, verb, dependsOn } = filters
  if (query !== undefined && !(
    asset.name.toLowerCase().includes(query)
    || asset.description.toLowerCase().includes(query)
    || (asset.tags ?? []).some(entry => entry.toLowerCase().includes(query))
  )) return false
  if (kind !== undefined && asset.kind !== kind) return false
  if (origin !== undefined && asset.origin !== origin) return false
  if (tag !== undefined && !(asset.tags ?? []).some(entry => entry.toLowerCase() === tag)) return false
  if (verb !== undefined && !(asset.verbs ?? []).some(entry => entry.toLowerCase() === verb)) return false
  if (dependsOn !== undefined && !asset.depends_on.includes(dependsOn)) return false
  return true
}

/** Trim and lowercase one optional string condition; empty means "no condition". */
function normalizeCondition(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized === undefined || normalized === '' ? undefined : normalized
}

/** Lossless JSON object value, spelled through the schema DSL so no extra package dependency is needed. */
type JsonValue = InferValue<{ type: 'json' }>

/**
 * Project one version manifest into the loose JSON the `asset_show` output
 * schema accepts: readonly arrays are detached, and the typed version-2
 * extensions (whose `params` values are `unknown`) are handed over as the
 * plain JSON they already are on disk.
 */
function jsonManifestOf(manifest: AssetManifest): Record<string, JsonValue> {
  return {
    ...manifest,
    dependencies: [...manifest.dependencies],
    depends_on: [...manifest.depends_on],
    ...(manifest.verbs === undefined ? {} : { verbs: [...manifest.verbs] }),
    ...(manifest.tags === undefined ? {} : { tags: [...manifest.tags] }),
  } as unknown as Record<string, JsonValue>
}

/** Tools whose successful calls append a usage record. */
type UsageTool = 'asset_search' | 'asset_show' | 'asset_run' | 'asset_run_bg'

/**
 * The roundtable engine surface a background submission reports to, resolved
 * opportunistically: the tool knows the run it submitted but not which speaker
 * asked for it, so the engine files the ledger entry against the turn that is
 * speaking. Absent when the deployment composes no roundtable, and a table
 * that is not open ignores the note.
 */
interface RoundtableNote {
  /**
   * File one submitted background run in the open table's ledger.
   * @param entry - the run to follow: id, record path, asset, verb, and
   *   submission instant; `speaker` is only a fallback, the engine fills it
   *   from the speaking turn.
   */
  noteBackgroundRun(entry: {
    readonly runId: string
    readonly recordPath: string
    readonly asset: string
    readonly verb: string
    readonly speaker?: string
    readonly submittedAt: string
  }): void
}

/** One line of `<assetDir>/usage.jsonl`: one successful asset-library tool call. */
interface UsageRecord {
  /** ISO-8601 timestamp of the successful call. */
  readonly ts: string
  /** The tool that ran. */
  readonly tool: UsageTool
  /** Asset the call named; absent for a library-wide `asset_search`. */
  readonly asset?: string
  /** Session the call belongs to; absent when the call has no owning agent. */
  readonly session?: string
}

/**
 * Create the library directory when absent and append one usage line. Split
 * from {@link recordUsage} so its `try` covers the single call that can fail.
 */
async function appendUsageLine(assetDir: string, record: UsageRecord): Promise<void> {
  await mkdir(assetDir, { recursive: true })
  await appendFile(join(assetDir, 'usage.jsonl'), `${JSON.stringify(record)}\n`, 'utf-8')
}

/**
 * Record one successful call for the library's hit-rate and activity
 * statistics. Usage is a side channel: a directory that cannot be created or
 * appended to (read-only library, permissions) leaves those statistics stale
 * and never fails the tool call that produced the record.
 * @param assetDir - library root holding `usage.jsonl`.
 * @param tool - the tool that succeeded.
 * @param asset - asset the call named, or `undefined` for a library-wide call.
 * @param agent - calling agent, when the call has one, naming its session.
 */
async function recordUsage(
  assetDir: string,
  tool: UsageTool,
  asset: string | undefined,
  agent: Agent | undefined,
): Promise<void> {
  try {
    await appendUsageLine(assetDir, {
      ts: new Date().toISOString(),
      tool,
      ...(asset === undefined ? {} : { asset }),
      ...(agent === undefined ? {} : { session: agent.session.id }),
    })
  } catch {
    // The append is the only statement in the `try`, so this swallows exactly
    // one usage-record write; the result the caller already computed stays
    // unaffected.
  }
}

/**
 * Append one asset version the model actually read to the current desk run's
 * source ledger. The desk runner sets `FINDECK_DESK_SOURCES_FILE`; ordinary
 * sessions have no ledger and this is a no-op. A failure to record is thrown,
 * because a report that silently omits a source it used is worse than a tool
 * error.
 * @param tool - the tool that read the version.
 * @param asset - asset name.
 * @param version - the exact resolved version.
 * @param extra - tool-specific facts such as the entry name.
 */
async function recordDeskSource(
  tool: 'asset_show' | 'asset_run',
  asset: string,
  version: number,
  extra: Record<string, string> = {},
): Promise<void> {
  const file = process.env.FINDECK_DESK_SOURCES_FILE
  if (file === undefined || file === '') return
  const line = JSON.stringify({ ts: new Date().toISOString(), tool, asset, version, ...extra })
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await appendFile(file, `${line}\n`, 'utf-8')
}

/**
 * Wrap an asset child argv for the unattended desk policy, or return it
 * unchanged for an ordinary interactive composition.
 *
 * The desk policy is explicit: `workspace-write` rooted at the asset library,
 * not the session workspace, so an asset function may update the library but
 * cannot write the repository, the desk task directory, or the user's home.
 * The provider governs file effects only; it is not an executable allowlist.
 * Missing sandbox availability fails closed instead of running the child
 * unconfined.
 * @param ctx - plugin context.
 * @param enabled - the tool's `sandbox` configuration.
 * @param argv - the exact child argv.
 * @param assetDir - the only writable root.
 * @param signal - caller cancellation.
 * @param sessionId - owning session, when there is one.
 * @returns the argv to spawn.
 */
async function confineAssetArgv(
  ctx: Context,
  enabled: boolean,
  argv: readonly string[],
  assetDir: string,
  signal: AbortSignal | undefined,
  sessionId: Agent['session']['id'] | undefined,
): Promise<readonly string[]> {
  if (!enabled) return argv
  const sandbox = ctx.get('sandbox') as SandboxProvider | undefined
  if (sandbox === undefined) {
    throw new Error('asset execution requires the sandbox service, but this composition has none; refusing to run unconfined')
  }
  const policy: SandboxPolicy = {
    mode: 'workspace-write',
    workspaceRoot: assetDir,
    ...sessionId === undefined ? {} : { sessionId },
  }
  const confined = await sandbox.confine(argv, policy, signal)
  return confined.argv
}

/**
 * Register the seven asset tools and the durable session catalog. The catalog
 * publishes only when the calling agent resolves this plugin's exact
 * `asset_list` registration, so a preset that omits the tools also omits the
 * list, exactly like the skill catalog.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const assetDir = resolve(config.assetDir ?? defaultAssetDir())
  // Python's own default can disagree with this root; every spawn passes it explicitly.
  const pythonPath = config.pythonPath !== undefined && isAbsolute(config.pythonPath)
    ? config.pythonPath
    : config.pythonPath ?? DEFAULT_PYTHON_PATH

  const assetDirTool = defineTool({
    name: 'asset_dir',
    description: 'Return the root directory of this user\'s FinDeck asset library, where research assets (models, code modules, weights) are archived for reuse.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          exists: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Asset library: ${value.dir}${value.exists ? '' : ' (not created yet — assets appear after the first `archive`)'}`,
      }],
    },
    execute() {
      return Promise.resolve({ dir: assetDir, exists: existsSync(assetDir) })
    },
    presentCall: () => ({ card: 'generic', title: 'Show asset library directory', kind: 'read', rawInput: '' }),
  })
  ctx.tools.register(assetDirTool)

  const assetListTool = defineTool({
    name: 'asset_list',
    description:
      'List the reusable research assets in this user\'s FinDeck asset library: name, kind '
      + '(model/code/weights/dataset/chart/report), '
      + 'latest version, purpose, validation metrics, and asset dependencies. Optional `query` filters by '
      + 'case-insensitive substring over name, description, and dependency names; optional `kind` keeps one kind.',
    parameters: {
      query: { type: 'string', description: 'Case-insensitive substring matched against name, description, and depends_on entries; omit for all assets.' },
      kind: { type: 'string', enum: ['model', 'code', 'weights', 'dataset', 'chart', 'report'] satisfies readonly AssetKind[], description: 'Keep only this asset kind; omit for all kinds.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          exists: { type: 'boolean', required: true },
          assets: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                latest_version: { type: 'number', required: true },
                description: { type: 'string', required: true },
                validation: { type: 'string', required: true },
                depends_on: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: value.assets.length === 0
          ? `Asset library ${value.dir} has no assets${args.query !== undefined || args.kind !== undefined ? ' matching the filter' : ' yet'}.`
          : value.assets.map(asset =>
            `- ${asset.name} (${asset.kind} v${asset.latest_version}): ${asset.description} [${asset.validation}]`,
          ).join('\n'),
      }],
    },
    async execute(args) {
      const query = args.query?.trim().toLowerCase()
      const index = await readIndex(assetDir)
      return {
        dir: assetDir,
        exists: index !== undefined,
        assets: index === undefined ? [] : index.assets
          .filter(asset => args.kind === undefined || asset.kind === args.kind)
          .filter(asset => query === undefined || query === ''
            || asset.name.toLowerCase().includes(query)
            || asset.description.toLowerCase().includes(query)
            || asset.depends_on.some(dep => dep.toLowerCase().includes(query)))
          .map(asset => ({
            name: asset.name,
            kind: asset.kind,
            latest_version: asset.latest_version,
            description: asset.description,
            validation: asset.validation,
            depends_on: [...asset.depends_on],
          })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'List asset library', kind: 'read', rawInput: args.query ?? '' }),
  })
  ctx.tools.register(assetListTool)

  ctx.tools.register(defineTool({
    name: 'asset_search',
    description:
      'Search the FinDeck asset library by structured conditions and return each matching asset\'s path and '
      + 'manifest summary. Every condition is optional and they combine with AND: `query` is a case-insensitive '
      + 'substring over name, description, and tags; `kind` and `origin` select one value; `tag` and `verb` match '
      + 'one tag or declared verb exactly (case-insensitive); `depends_on` keeps assets whose dependencies name '
      + 'that asset exactly. Use it to find assets by purpose, provenance, capability, or dependency before '
      + '`asset_show` or `asset_run`; use `asset_list` when every asset should be listed.',
    parameters: {
      query: { type: 'string', description: 'Case-insensitive substring matched against name, description, and tags; omit to skip.' },
      kind: { type: 'string', enum: ['model', 'code', 'weights', 'dataset', 'chart', 'report'] satisfies readonly AssetKind[], description: 'Keep only this asset kind; omit to skip.' },
      origin: { type: 'string', enum: ['agent', 'user', 'imported'] satisfies readonly AssetOrigin[], description: 'Keep only assets introduced by this origin; omit to skip. Assets with an unrecorded origin never match.' },
      tag: { type: 'string', description: 'Keep only assets carrying this tag (exact, case-insensitive); omit to skip.' },
      verb: { type: 'string', description: 'Keep only assets declaring this verb (exact, case-insensitive); omit to skip.' },
      depends_on: { type: 'string', description: 'Keep only assets that depend on this asset (exact asset name); omit to skip.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          exists: { type: 'boolean', required: true },
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                origin: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                latest_version: { type: 'number', required: true },
                verbs: { type: 'array', required: true, items: { type: 'string' } },
                face: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                freshness: {
                  oneOf: [
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        as_of: { type: 'string', required: true },
                        update_frequency: { type: 'string' },
                      },
                    },
                    { type: 'null' },
                  ],
                  required: true,
                },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                description: { type: 'string', required: true },
                validation: { type: 'string', required: true },
                depends_on: { type: 'array', required: true, items: { type: 'string' } },
                path: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (args, value) => {
        const conditions = [
          args.query === undefined || args.query === '' ? undefined : `query "${args.query}"`,
          args.kind === undefined ? undefined : `kind ${args.kind}`,
          args.origin === undefined ? undefined : `origin ${args.origin}`,
          args.tag === undefined || args.tag === '' ? undefined : `tag ${args.tag}`,
          args.verb === undefined || args.verb === '' ? undefined : `verb ${args.verb}`,
          args.depends_on === undefined || args.depends_on === '' ? undefined : `depends_on ${args.depends_on}`,
        ].filter((condition): condition is string => condition !== undefined)
        if (value.results.length === 0) {
          return [{
            type: 'text',
            text: `Asset library ${value.dir} has no assets${value.exists ? '' : ' (no readable index.json)'}`
              + `${conditions.length === 0 ? '' : ` matching ${conditions.join(', ')}`}.`,
          }]
        }
        return [{
          type: 'text',
          text: value.results.map(result =>
            `- ${result.name} (${result.kind}, ${result.origin ?? 'origin unknown'}, v${result.latest_version}): `
            + `${result.description} [${result.validation}] → ${result.path}`,
          ).join('\n'),
        }]
      },
    },
    async execute(args, exec) {
      const index = await readIndex(assetDir)
      const filters: AssetSearchFilters = {
        query: normalizeCondition(args.query),
        kind: args.kind,
        origin: args.origin,
        tag: normalizeCondition(args.tag),
        verb: normalizeCondition(args.verb),
        dependsOn: normalizeCondition(args.depends_on),
      }
      const results = index === undefined ? [] : index.assets
        .filter(asset => matchesSearchFilters(asset, filters))
        .map(asset => ({
          name: asset.name,
          kind: asset.kind,
          origin: asset.origin ?? null,
          latest_version: asset.latest_version,
          verbs: [...asset.verbs ?? []],
          face: asset.face ?? null,
          freshness: asset.freshness === undefined || asset.freshness === null
            ? null
            : {
              as_of: asset.freshness.as_of,
              ...(asset.freshness.update_frequency === undefined
                ? {}
                : { update_frequency: asset.freshness.update_frequency }),
            },
          tags: [...asset.tags ?? []],
          description: asset.description,
          validation: asset.validation,
          depends_on: [...asset.depends_on],
          path: join(assetDir, asset.name, `v${asset.latest_version}`),
        }))
      await recordUsage(assetDir, 'asset_search', undefined, exec.agent)
      return { dir: assetDir, exists: index !== undefined, results }
    },
    presentCall: args => ({ card: 'generic', title: 'Search asset library', kind: 'read', rawInput: args.query ?? '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'asset_show',
    description: 'Show one asset\'s full manifest, file list, and Python code preview. Omit `version` for the latest.',
    parameters: {
      name: { type: 'string', required: true, description: 'Exact asset name from `asset_list`.' },
      version: { type: 'number', description: 'Asset version; omit for the latest.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          manifest: { type: 'object', additionalProperties: true, required: true },
          files: { type: 'array', required: true, items: { type: 'string' } },
          code_preview: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Asset ${args.name} at ${value.dir}\n${JSON.stringify(value.manifest, null, 2)}`,
      }],
    },
    async execute(args, exec) {
      const index = await readIndex(assetDir)
      if (index === undefined) {
        throw new Error(`asset library ${assetDir} has no readable index.json — archive an asset first (findeck.assets.archive)`)
      }
      const { dir, version, manifest } = resolveVersion(index, args.name, args.version, assetDir)
      const files = await listFiles(dir)
      const preview = await codePreview(dir)
      await recordUsage(assetDir, 'asset_show', args.name, exec.agent)
      await recordDeskSource('asset_show', args.name, version)
      return { dir, manifest: jsonManifestOf(manifest), files, code_preview: preview }
    },
    presentCall: args => ({ card: 'generic', title: `Show asset ${args.name}`, kind: 'read', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'asset_graph',
    description:
      'Show one asset\'s dependency graph. Forward: the transitive closure of assets it depends on (each with '
      + 'kind and latest version, at its BFS depth; names missing from the library are flagged). Reverse: every '
      + 'asset whose dependency closure contains this one. Walks follow each dependency at its latest version; '
      + 'the root\'s direct dependencies honor the requested `version`. Use it before `asset_run` to see '
      + 'everything a call pulls in, or before archiving a new version to see who depends on this asset.',
    parameters: {
      name: { type: 'string', required: true, description: 'Exact asset name from `asset_list`.' },
      version: { type: 'number', description: 'Root asset version whose direct dependencies are walked; omit for the latest.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          name: { type: 'string', required: true },
          version: { type: 'number', required: true },
          dependencies: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                depth: { type: 'number', required: true },
                kind: { type: 'string' },
                latest_version: { type: 'number' },
                missing: { type: 'boolean' },
              },
            },
          },
          dependents: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                depth: { type: 'number', required: true },
                kind: { type: 'string', required: true },
                latest_version: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Dependency graph of ${value.name}@v${String(value.version)}:`,
          ...(value.dependencies.length === 0
            ? ['- (no dependencies)']
            : value.dependencies.map(dep => dep.missing === true
              ? `- ${'  '.repeat(dep.depth - 1)}${dep.name} — MISSING from the library`
              : `- ${'  '.repeat(dep.depth - 1)}${dep.name} (${dep.kind ?? '?'} v${String(dep.latest_version)}, depth ${String(dep.depth)})`)),
          value.dependents.length === 0
            ? 'No assets depend on this one.'
            : `Depended on by: ${value.dependents.map(dep => `${dep.name} (depth ${String(dep.depth)})`).join(', ')}`,
        ].join('\n'),
      }],
    },
    async execute(args) {
      const index = await readIndex(assetDir)
      if (index === undefined) {
        throw new Error(`asset library ${assetDir} has no readable index.json — archive an asset first (findeck.assets.archive)`)
      }
      // resolveVersion performs the loud unknown-name/unknown-version refusal.
      const { version } = resolveVersion(index, args.name, args.version, assetDir)
      return {
        dir: assetDir,
        name: args.name,
        version,
        dependencies: dependencyClosureOf(index, args.name, args.version),
        dependents: reverseDependentsOf(index, args.name),
      }
    },
    presentCall: args => ({ card: 'generic', title: `Asset graph ${args.name}`, kind: 'read', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'asset_run',
    description: 'Run an asset entry in the finance Python environment: `entry` names a function declared in the asset\'s interface (model assets usually expose `predict`). Data-sized arguments are session file paths, not inline data. Declared dependencies must already be installed in the venv; missing ones are reported, never auto-installed.',
    parameters: {
      name: { type: 'string', required: true, description: 'Exact asset name from `asset_list`.' },
      version: { type: 'number', description: 'Asset version; omit for the latest.' },
      entry: { type: 'string', required: true, description: 'Function name from the manifest interface, or `predict` for model assets.' },
      args_json: { type: 'string', required: true, description: 'JSON object of keyword arguments for the entry function.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stdout: { type: 'string', required: true },
          result_json: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: value.error !== undefined
          ? `asset_run ${args.name} failed: ${value.error}`
          : `asset_run ${args.name} → ${value.result_json ?? '(no result payload)'}`,
      }],
    },
    async execute(args, exec) {
      const index = await readIndex(assetDir)
      if (index === undefined) {
        throw new Error(`asset library ${assetDir} has no readable index.json — archive an asset first (findeck.assets.archive)`)
      }
      const { dir, version } = resolveVersion(index, args.name, args.version, assetDir)

      if (config.requireApproval ?? true) {
        if (!exec.agent) throw new Error('asset_run requires an owning agent session to request approval')
        const approval = ctx.get('approval')
        if (approval === undefined) {
          throw new Error('asset_run requires approval but no approval service is composed (fail closed)')
        }
        const outcome = await approval.request({
          agent: exec.agent,
          callId: exec.callId,
          toolName: 'asset_run',
          reason: `Run asset ${args.name}@v${version} entry "${args.entry}" in the finance Python environment`,
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') {
          throw new Error(`asset_run ${args.name}@v${version} was ${outcome}`)
        }
      }

      if (!existsSync(pythonPath)) {
        throw new Error(`finance Python environment not found at ${pythonPath} — run finance/python/setup-env.(ps1|sh) first`)
      }

      const argv = await confineAssetArgv(
        ctx,
        config.sandbox ?? false,
        [pythonPath, '-c', DRIVER, dir, args.entry, args.args_json],
        assetDir,
        exec.signal,
        exec.agent?.session.id,
      )
      const handle = ctx.subprocess.spawn({
        argv,
        cwd: dir,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: config.maxOutputBytes ?? 256 * 1024 },
          stderr: { maxBytes: config.maxOutputBytes ?? 256 * 1024 },
        },
        graceMs: config.graceMs ?? 15_000,
        signal: exec.signal,
        env: { FINDECK_ASSET_DIR: assetDir },
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      if (outcome.exitCode === EXIT_MISSING_DEPS) {
        const missing = parseDriverOutput(stdout, '###FINDECK_MISSING###')
        throw new Error(`missing dependencies (install them in the finance venv first): ${missing ?? 'unknown'}`)
      }
      if (outcome.exitCode !== 0) {
        const message = parseDriverOutput(stdout, '###FINDECK_ERROR###')
          ?? (stderr.trim() || `exit code ${String(outcome.exitCode)}`)
        throw new Error(`asset_run driver failed: ${message}`)
      }
      const result = parseDriverOutput(stdout, '###FINDECK_RESULT###')
      if (result === undefined) {
        throw new Error(`driver produced no result marker; stderr: ${stderr.trim() || '(empty)'}`)
      }
      await recordUsage(assetDir, 'asset_run', args.name, exec.agent)
      await recordDeskSource('asset_run', args.name, version, { entry: args.entry })
      return { stdout, result_json: result }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Run asset ${args.name}.${args.entry}`,
      kind: 'other',
      rawInput: { name: args.name, entry: args.entry },
    }),
  }))

  if (config.background ?? true) ctx.tools.register(defineTool({
    name: 'asset_run_bg',
    description: 'Submit an asset verb as a background run and return as soon as it is accepted: the verb executes detached in the finance Python environment and writes its result to a run record, so the calling turn continues instead of waiting. Use it for long work (data pulls, training, backtests); it always runs the asset\'s latest version and takes no approval.',
    parameters: {
      asset: { type: 'string', required: true, description: 'Exact asset name from `asset_list`.' },
      verb: { type: 'string', required: true, description: 'Verb declared in the asset manifest; the latest version runs.' },
      params: { type: 'object', additionalProperties: true, description: 'Verb parameters as a JSON object; omit for none.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          run_id: { type: 'string', required: true },
          record_path: { type: 'string', required: true },
          asset: { type: 'string', required: true },
          verb: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `asset_run_bg ${args.asset}.${args.verb} → run ${value.run_id} (running); record: ${value.record_path}`,
      }],
    },
    async execute(args, exec) {
      const index = await readIndex(assetDir)
      if (index === undefined) {
        throw new Error(`asset library ${assetDir} has no readable index.json — archive an asset first (findeck.assets.archive)`)
      }
      // Resolving the latest version gives the run its working directory and
      // refuses an unknown asset here, rather than as a detached run that dies
      // after this call has already answered.
      const { dir } = resolveVersion(index, args.asset, undefined, assetDir)

      if (!existsSync(pythonPath)) {
        throw new Error(`finance Python environment not found at ${pythonPath} — run finance/python/setup-env.(ps1|sh) first`)
      }

      const argv = await confineAssetArgv(
        ctx,
        config.sandbox ?? false,
        [
          pythonPath, '-m', 'findeck.verb_bridge', '--background',
          JSON.stringify({ asset: args.asset, verb: args.verb, params: args.params ?? {} }),
        ],
        assetDir,
        exec.signal,
        exec.agent?.session.id,
      )
      const handle = ctx.subprocess.spawn({
        argv,
        cwd: dir,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: config.maxOutputBytes ?? 256 * 1024 },
          stderr: { maxBytes: config.maxOutputBytes ?? 256 * 1024 },
        },
        graceMs: config.graceMs ?? 15_000,
        signal: exec.signal,
        env: { FINDECK_ASSET_DIR: assetDir },
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      // The bridge refuses a submission with exit 1 and its own message; a
      // detached run's own failure is written to the record instead.
      if (outcome.exitCode !== 0) {
        throw new Error(`asset_run_bg could not submit ${args.asset}.${args.verb}: ${stderr.trim() || stdout.trim() || `exit code ${String(outcome.exitCode)}`}`)
      }
      const runId = parseRunId(stdout)
      if (runId === undefined) {
        throw new Error(`asset_run_bg submitted no readable run id; stdout: ${stdout.trim() || '(empty)'}`)
      }
      const recordPath = join(assetDir, 'runs', `${runId}.json`)
      await recordUsage(assetDir, 'asset_run_bg', args.asset, exec.agent)
      // The roundtable engine is optional in this composition and outside this
      // package's declared service surface, so its call shape is asserted here;
      // a deployment without it submits the run and leaves the record on disk.
      const roundtable = ctx.get('roundtable') as RoundtableNote | undefined
      roundtable?.noteBackgroundRun({
        runId,
        recordPath,
        asset: args.asset,
        verb: args.verb,
        submittedAt: new Date().toISOString(),
      })
      return { run_id: runId, record_path: recordPath, asset: args.asset, verb: args.verb, status: 'running' }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Submit background run ${args.asset}.${args.verb}`,
      kind: 'other',
      rawInput: { asset: args.asset, verb: args.verb },
    }),
  }))

  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    signal.throwIfAborted()
    const toolVisible = ctx.tools.get(assetListTool.name, agent) === assetListTool
    const index = toolVisible ? await readIndex(assetDir) : undefined
    const entries: AssetCatalogSource['entries'] = index === undefined
      ? []
      : index.assets.map(asset => ({
        name: asset.name,
        kind: asset.kind,
        version: asset.latest_version,
        description: catalogDescription(asset.description, CATALOG_DESCRIPTION_MAX_LENGTH),
      }))
    const messages = publishSessionCatalog(ASSET_CATALOG, agent.session, decision.messages, entries)
    return messages === undefined ? decision : { ...decision, messages: [...messages] }
  })
}

/** One durable entry of this catalog's `asset-library-catalog` source record. */
type AssetCatalogEntry = AssetCatalogSource['entries'][number]

/** The session asset catalog: published name/kind/version/description entries. */
const ASSET_CATALOG: SessionCatalog<AssetCatalogEntry> = {
  kind: 'asset-library-catalog',
  name: 'asset',
  digestOf: entry => [entry.name, entry.kind, entry.version, entry.description],
  readEntries: readCatalogEntries,
  render: renderCatalogMessage,
  renderUpdate: renderCatalogUpdate,
}

function renderCatalogMessage(entries: AssetCatalogSource['entries']): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'Reusable research assets from this user\'s FinDeck asset library are available:',
        '',
        '<available_assets>',
        ...renderCatalogEntries(entries),
        '</available_assets>',
        '',
        'Call `asset_list` for validation metrics and dependencies, `asset_show` to inspect an asset\'s manifest and code, and `asset_run` to execute an asset entry in the finance Python environment. Assets are versioned; calls default to the latest version.',
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: 'asset-library-catalog',
      form: 'catalog',
      entries,
    },
  })
}

function renderCatalogUpdate(entries: AssetCatalogSource['entries']): UserMessage {
  const availability = entries.length === 0
    ? 'No assets are currently available. Do not use names from earlier asset catalogs.'
    : 'Use only names in this replacement list.'
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'The asset library changed. This complete list replaces every earlier available-assets list:',
        '',
        '<available_assets>',
        ...renderCatalogEntries(entries),
        '</available_assets>',
        '',
        availability,
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: 'asset-library-catalog',
      form: 'catalog',
      update: true,
      entries,
    },
  })
}

function renderCatalogEntries(entries: AssetCatalogSource['entries']): string[] {
  return entries.map(entry => `- \`${entry.name}\` (${entry.kind} v${entry.version}): ${escapeText(entry.description)}`)
}

/** Entries of one durable `asset-library-catalog` record, or undefined when unreadable. */
function readCatalogEntries(source: unknown): AssetCatalogSource['entries'] | undefined {
  const entries = (source as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return undefined
  const readable: AssetCatalogSource['entries'][number][] = []
  for (const entry of entries as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const { name, kind, version, description } = entry as Record<string, unknown>
    if (typeof name !== 'string' || name === '') return undefined
    if (typeof kind !== 'string' || typeof version !== 'number' || typeof description !== 'string') return undefined
    readable.push({ name, kind, version, description })
  }
  return readable
}
