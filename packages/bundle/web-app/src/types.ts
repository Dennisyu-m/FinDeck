/**
 * Plugin-page patch vocabulary: the user-layer cordis.patch.yml rows the
 * plugin list's toggles edit, crossing the Remote boundary. Host-side
 * reading/writing lives in the `@deepseek-ai/dsh-web-app` runtime glue.
 * @module @deepseek-ai/dsh-web-app/types
 */

import type {
  ScheduleManagementResult as ScheduleManagementOutcome,
  ScheduleRemovalResult as ScheduleRemovalOutcome,
} from '@deepseek-ai/dsh-schedule/client'

/** One user-layer patch row the plugin page's toggle edits. */
export interface PluginPatchRow {
  /** Loader entry id the row targets. */
  id: string
  /** True/False when the user layer names the row; absent = untouched. */
  disabled?: boolean
}

/** One loader id in a user-layer patch write. */
export interface PluginPatchWriteEntry {
  /** Loader entry id to target. */
  id: string
  /** The next user-layer disable fact: true/false, or null to drop the row. */
  disabled: boolean | null
}

/**
 * A patch write: one entry, or a group applied in one file write.
 * A single entry is the one-element form of the group.
 */
export type PluginPatchWriteRequest = PluginPatchWriteEntry | readonly PluginPatchWriteEntry[]

/**
 * Research-asset page vocabulary: the read-only overview the page's
 * four tabs render — tool assets, theses, mode flows, and workspace reports.
 * @module types
 */

/** One archived tool asset as the asset tab's card renders. */
export interface AssetOverviewAsset {
  /** Asset name (kebab-case identity). */
  name: string
  /** model | code | weights. */
  kind: string
  /** Latest archived version number. */
  latest_version: number
  /** One-line purpose from the manifest. */
  description: string
  /** Validation metrics line from the manifest. */
  validation: string
  /** Other asset names this one declares it depends on. */
  depends_on: string[]
  /** Latest version's creation date when the manifest states one. */
  created?: string
}

/** One tracked thesis as the thesis view renders. */
export interface AssetOverviewThesis {
  id: string
  conclusion: string
  metric: string
  threshold: string
  due_date: string
  report: string
  assets: string[]
  /** open | hit | miss, derived from the newest check. */
  status: string
  overdue: boolean
  check_count: number
}

/** Registry-level thesis score: hits/(hits+misses) over every check. */
export interface AssetOverviewThesisScore {
  hits: number
  misses: number
  /** null while nothing has been checked. */
  hit_rate: number | null
}

/** One flow step of a work mode. */
export interface AssetOverviewFlowStep {
  id: string
  label: string
  /** 'default' follows the session model; else provider/model. */
  model: string
  /** What this step does, in the model's own instructions; absent when unstated. */
  prompt?: string
  /**
   * The AI-cluster declaration: when present, this step is executed by several
   * parallel subagents and their outputs combined. Absent means the step runs
   * as a single agent, which is how every flow declared before this field reads.
   */
  cluster?: { perspectives?: string[]; strategy?: string }
}

/** One preset's mode and flow as the mode/flow tab renders. */
export interface AssetOverviewFlow {
  presetId: string
  name: string
  /** work | free. */
  modeKind: string
  /** Steps in order; absent for free modes (rendered 自由模式). */
  steps: AssetOverviewFlowStep[]
}

/** One research report file found under a workspace. */
export interface AssetOverviewReport {
  workspaceId: string
  workspaceTitle: string
  /** Path relative to the workspace root, forward slashes. */
  file: string
  /** First markdown heading, or the file name when none. */
  title: string
  /** Last-modified ISO instant. */
  modifiedAt: string
  bytes: number
}

/** The complete read-only research-asset overview. */
export interface AssetOverview {
  assets: AssetOverviewAsset[]
  theses: { items: AssetOverviewThesis[]; score: AssetOverviewThesisScore }
  flows: AssetOverviewFlow[]
  reports: AssetOverviewReport[]
  /** Per-item read failures the page shows instead of hiding data loss. */
  problems: string[]
}

/**
 * Asset-hub page vocabulary: the asset-library, asset-face, asset-file,
 * verb-bridge, and seed payloads the `assetOverview` Remote namespace answers.
 * The verb-bridge request and response fields follow
 * `finance/face-spec/verb-bridge.md`; the host gateway forwards them unchanged.
 */

/**
 * Failure vocabulary of the `assetOverview` namespace's asset-hub operations.
 * Asset and version lookup failures are the caller's to correct, so they carry
 * their own codes instead of the carrier's `gateway/internal`.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No library directory holds the requested asset, or the requested version of it, or the requested file. */
    'asset/not-found': { readonly name: string; readonly version?: number }
    /** The version's manifest or face file is unreadable, malformed, or not the declared type. */
    'asset/face-invalid': { readonly name: string; readonly version: number; readonly reason: string }
    /** The requested version-directory file exceeds the host's read bound. */
    'asset/file-too-large': { readonly name: string; readonly version: number; readonly path: string }
    /** The requested version-directory file is not UTF-8 text. */
    'asset/file-not-text': { readonly name: string; readonly version: number; readonly path: string }
    /** A schedule-control request omitted an id, or sent one empty or padded with whitespace. */
    'gateway/invalid-request': {}
  }
}

/**
 * Any JSON value, spelled as a type the Remote codec can constrain — an
 * unconstrained `unknown` is refused at a Remote boundary.
 */
export type RemoteJson =
  | string
  | number
  | boolean
  | null
  | RemoteJson[]
  | { [key: string]: RemoteJson }

/** One asset version directory's freshness declaration, as the index records it. */
export interface AssetLibraryFreshness {
  /** The data's own currency date, `YYYY-MM-DD`. */
  as_of: string
  /** daily | weekly | monthly | quarterly | another deployment-chosen word; absent when unstated. */
  update_frequency?: string
}

/** One asset as the asset-hub grid, list, and graph views read it. */
export interface AssetLibraryAsset {
  /** Asset name (kebab-case identity). */
  name: string
  /** model | code | weights | dataset | chart | report. */
  kind: string
  /** agent | user | imported. */
  origin: string
  /** Highest archived version number. */
  latest_version: number
  /** One-line purpose from the manifest. */
  description: string
  /** Validation metrics line from the manifest. */
  validation: string
  /** Verbs the version's manifest declares; the graph's action set. */
  verbs: string[]
  /** Retrieval tags, as declared. */
  tags: string[]
  /** Freshness declaration, or null when the manifest declares none. */
  freshness: AssetLibraryFreshness | null
  /** The manifest's face path relative to the version directory, or null when undeclared. */
  face: string | null
  /** Other asset names this asset consumes; may name the asset itself for an incremental refresh. */
  depends_on: string[]
  /**
   * Whether this server judged the asset past its update deadline as of today.
   * Always false for a non-dataset, or for one with no freshness declaration.
   */
  stale: boolean
  /** Absolute path of the version directory `latest_version` names. */
  versionDir: string
}

/** The whole library index plus the reader's per-entry problems. */
export interface AssetLibrary {
  assets: AssetLibraryAsset[]
  /** Read failures the page shows instead of hiding data loss. */
  problems: string[]
}

/**
 * One version's manifest, every field it declares, as the face view reads it.
 * Field types follow the reading path's own tolerance: any field a manifest
 * states with another type is reported here as absent rather than coerced.
 */
export interface AssetFaceManifest {
  name: string
  kind: string
  version: number
  created: string
  source_session: string
  description: string
  interface: string
  dependencies: string[]
  depends_on: string[]
  /** The superseded version label (`<asset>@vN`), or null when nothing is superseded. */
  supersedes: string | null
  validation: string
  origin: string
  verbs: string[]
  freshness: AssetLibraryFreshness | null
  lineage: { producer?: { [key: string]: RemoteJson }; inputs?: string[] } | null
  tags: string[]
  /** The manifest's face path relative to the version directory, or null when undeclared. */
  face: string | null
}

/** One asset version's face: the parsed face.json, its manifest, and its directory. */
export interface AssetFaceResult {
  /** The parsed face.json exactly as written, or null when the manifest declares no face. */
  face: { [key: string]: RemoteJson } | null
  /** The version's manifest fields. */
  manifest: AssetFaceManifest
  /** Absolute path of the resolved version directory. */
  dir: string
  /** The resolved version number (the latest when the request omitted one). */
  version: number
}

/** One version-directory text file read request. */
export interface AssetFileRequest {
  /** Library asset name; never a path. */
  asset: string
  /** Target version; omitted means the asset's latest. */
  version?: number
  /** Path relative to the version directory, with a whitelisted text suffix. */
  path: string
}

/**
 * One version-directory text file, decoded as UTF-8. The asset page's `embed`
 * block renders it; the file is the asset's own content, not host content.
 */
export interface AssetFileResult {
  /** The file's decoded text. */
  content: string
  /** The path as requested, relative to the version directory. */
  path: string
}

/** One verb-bridge request, exactly as `finance/face-spec/verb-bridge.md` defines it. */
export interface RunVerbRequest {
  /** Library asset name; never a path. */
  asset: string
  /** Target version; omitted means the asset's latest. */
  version?: number
  /** Verb name; must be declared in that version's manifest `verbs`. */
  verb: string
  /** Verb arguments; omitted is the bridge's `{}`. */
  params?: RemoteJson
}

/**
 * One verb-bridge response, field for field as the bridge emits it. The host
 * gateway forwards the parsed stdout line unchanged, so this is the protocol's
 * own vocabulary — `status` is the only success verdict and both optional
 * fields carry whatever the verb returned.
 */
export interface RunVerbResult {
  /** ok | error. */
  status: string
  /** Echoed request value; null when the request could not be parsed. */
  asset: string | null
  /** The version actually resolved; null when the request could not be parsed. */
  version: number | null
  /** Echoed request value; null when the request could not be parsed. */
  verb: string | null
  /** Wall-clock seconds to four decimals. */
  duration_s: number
  /** The verb's return value; present when `status` is `ok`. */
  result?: RemoteJson
  /** The verb script's captured stdout, marker line included; present for script verbs. */
  stdout?: string
  /** Human-readable failure reason; present when `status` is `error`. */
  error?: string
}

/**
 * The seed text handed to a new session so its first message can drive this
 * asset directly. Chinese prose: it is copied verbatim into a prompt.
 */
export interface AssetBriefResult {
  seed: string
}

/** The data-environment probe the data-env page renders. */
export interface DataEnvReport {
  /** The finance venv interpreter path this deployment probes. */
  venvPath: string
  /** Whether the venv interpreter exists. */
  venvExists: boolean
  /** The venv's Python version, when it answered; cached ~10 minutes. */
  pythonVersion?: string
  /** Key finance packages and whether the venv can import them. */
  modules: { name: string; ok: boolean }[]
  /** The asset-library root and whether it exists yet. */
  assetLibraryPath: string
  assetLibraryExists: boolean
  /** Why the probe could not run (venv missing is not an error). */
  problem?: string
}

/**
 * Component-catalog vocabulary: the six downloadable runtime components the
 * data-environment page lists, one install job at a time, and the event stream
 * that carries its progress. `ComponentInfo` is what a probe observed, never
 * what an install intends.
 */

/** Stable identifiers of downloadable runtime components. */
export type ComponentId = 'python-venv' | 'python-ml' | 'uv' | 'pnpm' | 'playwright-chromium' | 'sensevoice-models'

/** Observed state of one downloadable component. */
export interface ComponentInfo {
  id: ComponentId
  installed: boolean
  version?: string
  /** Install path, for display. */
  location?: string
  /** Approximate download+install size. */
  estimateBytes?: number
  /** Components that must be installed before this one. */
  requires?: ComponentId[]
  /** Why the probe failed, when relevant. */
  problem?: string
}

/** One progress update from a running install job. */
export interface ComponentProgress {
  id: ComponentId
  stage: 'download' | 'install' | 'verify'
  /** Human-readable step, e.g. "pandas (12/15)". */
  message?: string
  completedBytes?: number
  totalBytes?: number
}

/** Events published on the componentCatalog.follow stream. */
export type ComponentEvent =
  | { type: 'progress'; progress: ComponentProgress }
  | { type: 'installed'; info: ComponentInfo }
  | { type: 'failed'; id: ComponentId; error: string }

/**
 * Failure vocabulary of the `componentCatalog` namespace. Refusals the caller
 * can act on before any work starts carry their own codes; a job that fails
 * after it started reports through the `failed` event instead, because its
 * caller has already been answered. An id outside {@link ComponentId} is not
 * one of these: the wire boundary validates the parameter against the literal
 * union and refuses it as `gateway/input-invalid` before any method runs.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Another install job is already running; the catalog runs one at a time. */
    'component/busy': { readonly running: ComponentId }
    /** The component declares prerequisites that are not installed yet. */
    'component/requires': { readonly id: ComponentId; readonly missing: readonly ComponentId[] }
    /** No install job is running for this component. */
    'component/not-running': { readonly id: ComponentId }
    /** The component has no installation path on this platform. */
    'component/unsupported': { readonly id: ComponentId }
  }
}

/** One scheduled run as the schedule page renders it. */
export interface ScheduleOverviewEntry {
  /** Owning session id. */
  sessionId: string
  /** Owning session title, or the id when untitled. */
  sessionTitle: string
  /** Schedule id inside the session. */
  id: string
  /** after | at | every. */
  kind: string
  /** The task prompt the schedule delivers. */
  prompt: string
  /** Next due instant, RFC 3339. */
  scheduledAt: string
  /** Fixed-rate interval in seconds, when kind is `every`. */
  everySeconds?: number
  /**
   * True when the schedule is paused. Absent means it is not paused: the field
   * is optional so records written before pause support stay readable.
   */
  paused?: boolean
  /** True when the due instant has passed. */
  overdue: boolean
  /** True when the owning session is currently open (delivery is possible). */
  live: boolean
}

/** The schedule page's read-only overview. */
export interface ScheduleOverview {
  entries: ScheduleOverviewEntry[]
  /** Stored sessions whose schedule state had no readable projection row. */
  unreadable: number
}

/** One automation task as the scheduled-tasks page renders it. */
export interface AutomationTaskView {
  /** Pipeline name. */
  name: string
  /** Task kind. This generation is `pipeline`. */
  kind: string
  /** `manual`, `cron`, or `interval`. */
  triggerKind: string
  /** Cron expression, when `triggerKind` is `cron`. */
  schedule?: string
  /** Interval in seconds, when `triggerKind` is `interval`. */
  everySeconds?: number
  /** Next armed fire, local ISO. Absent when the task is not armed. */
  nextRunAt?: string
  /** Timestamp of the latest pipeline-runs line. */
  lastTs?: string
  /** Status of that line: `ok`, `failed`, `skipped`, or a python step status. */
  lastStatus?: string
  /** Process exit code when the runner recorded one. */
  lastExitCode?: number | null
  /** True when the runner aborted the process for its own timeout. */
  lastTimedOut?: boolean
}

/** The scheduled-tasks page's task list. */
export interface AutomationTaskList {
  tasks: AutomationTaskView[]
}

/** Outcome of one remote immediate run. */
export interface AutomationRunResultView {
  name: string
  /** `ok`, `failed`, or `skipped`. */
  status: string
  exitCode: number | null
  timedOut: boolean
  signal: string | null
}

/** One schedule-control operation target. */
export interface ScheduleControlRequest {
  /** Owning session id (opaque string). */
  readonly sessionId: string
  /** Schedule id within that session. */
  readonly scheduleId: string
}

/**
 * Outcome of one remote schedule pause or resume. Same type as the schedule
 * package's management result, taken from its browser-safe client vocabulary so
 * this Remote boundary type stays importable without the package's host face.
 */
export type ScheduleManagementResult = ScheduleManagementOutcome

/**
 * Outcome of one remote schedule deletion. Same type as the schedule package's
 * removal result, taken from its browser-safe client vocabulary so this Remote
 * boundary type stays importable without the package's host face.
 */
export type ScheduleRemovalResult = ScheduleRemovalOutcome

/**
 * Desk wire vocabulary: task definitions, runs, reports, feedback, templates,
 * and the scorecard. Every field is plain JSON so the Remote codec carries it
 * without importing the host service's domain types.
 */

/** One desk trigger as the task editor and task list carry it. */
export interface DeskTriggerWire {
  /** cron | interval | event | thesis-due. */
  kind: string
  /** Cron expression when `kind` is `cron`. */
  schedule?: string
  /** Interval seconds when `kind` is `interval`. */
  everySeconds?: number
  /** Webhook adapter kind when `kind` is `event`. */
  name?: string
}

/** One refresh declaration before the deterministic signal step. */
export interface DeskRefreshWire {
  /** verb | pipeline. */
  kind: string
  /** Asset name for a verb refresh. */
  asset?: string
  /** Verb name for a verb refresh. */
  verb?: string
  /** Pipeline name for a pipeline refresh. */
  name?: string
}

/** One watched object. */
export interface DeskTargetWire {
  /** symbol | theme | thesis | asset | workbench. */
  kind: string
  /** Symbol, theme text, thesis id, asset name, or workbench name. */
  ref: string
  /** Refresh declaration; absent when the target has no deterministic refresh. */
  refresh?: DeskRefreshWire
}

/** One task budget. */
export interface DeskBudgetWire {
  /** Cumulative run budget across model requests. */
  tokens: number
  /** Wall-clock cap for the whole run. */
  wallSeconds: number
  /** Per-request output cap; absent uses the runner default. */
  maxOutputTokens?: number
}

/** One complete task definition on the wire. */
export interface DeskTaskInputWire {
  name: string
  display_name: string
  goal: string
  enabled?: boolean
  targets: DeskTargetWire[]
  triggers: DeskTriggerWire[]
  /** always | changes. */
  report: string
  budget: DeskBudgetWire
}

/** One task row the desk page renders. */
export interface DeskTaskViewWire {
  name: string
  displayName: string
  goal: string
  enabled: boolean
  /** always | changes. */
  report: string
  targets: DeskTargetWire[]
  triggers: DeskTriggerWire[]
  budget: DeskBudgetWire
  path: string
  nextRunAt: string | null
  running: boolean
  last: {
    ts: string
    status: string
    exitCode: number | null
    timedOut: boolean
  } | null
}

/** Task-list result. */
export interface DeskListValue {
  tasks: DeskTaskViewWire[]
  problems: string[]
}

/** One task detail result. */
export interface DeskShowValue {
  task: DeskTaskViewWire
  recent: DeskRunWire[]
  problems: string[]
}

/** One signal row from a desk run. */
export interface DeskSignalWire {
  kind: string
  ref: string
  /** move | quiet | stale | recorded | missing-source | due. */
  status: string
  asset?: string
  version?: number
  note?: string
  /** Latest bar date or declared data currency date. */
  asOf?: string | null
  /** Close-to-close change, as a fraction. */
  change?: number | null
  /** Last close. */
  close?: number | null
  /** Volume relative to the previous bar. */
  volumeRatio?: number | null
  /** Thesis facts when the target kind is thesis. */
  thesisStatus?: string
  conclusion?: string
  dueDate?: string
  overdue?: boolean
}

/** One input asset version a run read. */
export interface DeskInputWire {
  asset: string
  version: number
  kind?: string
}

/** Cumulative usage one run counted. */
export interface DeskUsageWire {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  reasoningTokens: number | null
  requests: number
  unknown: boolean
}

/** One run record as the list and detail show it. */
export interface DeskRunWire {
  runId: string
  task: string
  trigger: {
    kind: string
    schedule?: string
    everySeconds?: number
    name?: string
    deliveryId?: string
    source?: string
    theses?: string[]
  }
  /** running | ok | degraded | no-change | data-insufficient | budget | timeout | cancelled | failed | skipped. */
  status: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  sessionId: string | null
  report: {
    asset: string
    version: number
    dir: string
    tags: string[]
    fallback: boolean
  } | null
  signals: DeskSignalWire[]
  inputs: DeskInputWire[]
  summary: {
    moves: number
    quiet: number
    stale: number
    missing: number
    due: number
    recorded: number
  } | null
  stopReason: string | null
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  cancelled: boolean
  usage: DeskUsageWire | null
  error: string | null
  stderrTail: string | null
  reportExpected: boolean
}

/** Report sections as the report card renders them. */
export interface DeskReportSectionsWire {
  points: string[]
  moves: string
  theses: string
  decisions: { kind: string; text: string }[]
}

/** One archived report plus its text and sources. */
export interface DeskReportValue {
  asset: string
  version: number
  dir: string
  tags: string[]
  fallback: boolean
  title: string | null
  sections: DeskReportSectionsWire | null
  markdown: string | null
  sources: DeskInputWire[]
  sourcesComplete: boolean
}

/** One decision row with its handled state. */
export interface DeskDecisionWire {
  id: string
  kind: string
  text: string
  /** open | handled. */
  status: string
  handledAt: string | null
}

/** One run with its decoded report and decisions. */
export interface DeskRunDetailValue {
  run: DeskRunWire
  report: DeskReportValue | null
  decisions: DeskDecisionWire[]
}

/** Run-list query. */
export interface DeskRunQueryWire {
  task?: string
  since?: string
  statuses?: string[]
  limit?: number
}

/** Run-list result. */
export interface DeskRunListValue {
  runs: DeskRunWire[]
  truncated: boolean
  problems: string[]
}

/** One feedback mark. */
export interface DeskFeedbackWire {
  id: string
  ts: string
  task: string
  runId: string
  reportAsset: string
  reportVersion: number
  /** useful | useless | handled. */
  kind: string
  note: string | null
  active: boolean
  revokedAt: string | null
}

/** One template the page can prefill. */
export interface DeskTemplateWire {
  id: string
  name: string
  description: string
  available: boolean
  task: DeskTaskInputWire
}

/** One scorecard metric with its window, denominator, and samples. */
export interface DeskScoreMetricWire {
  numerator: number
  denominator: number
  rate: number | null
  samples: number
}

/** The value-desk scorecard. */
export interface DeskScorecardValue {
  window: { days: number; from: string; to: string }
  theses: DeskScoreMetricWire & { hits: number; misses: number }
  reports: DeskScoreMetricWire & { useful: number; useless: number; handled: number }
  assets: DeskScoreMetricWire & { libraryAssets: number; touched: number }
  problems: string[]
}

/** Follow-up seed for one report. */
export interface DeskReportBriefValue {
  seed: string
  missingSources: string[]
  /** False for older reports that predate AI-stage source recording. */
  sourcesComplete: boolean
}

/**
 * Workbench (Work mode) vocabulary: the workbench definition list and the
 * multi-asset creation entry the research-assets page uses.
 */

/** One workbench definition as the Work tab lists it. */
export interface WorkbenchView {
  name: string
  displayName: string
  description: string
  assets: string[]
  hasConventions: boolean
  path: string
  /** True when the definition lives in the user's own directory. */
  userDefined: boolean
}

/** The workbench list and any unreadable definition. */
export interface WorkbenchListValue {
  workbenches: WorkbenchView[]
  problems: string[]
}

/** One user-authored Work mode definition from selected assets. */
export interface CreateWorkRequest {
  /** Kebab-case name; the file is `<name>.yaml`. */
  name: string
  displayName: string
  description: string
  /** Selected library asset names; at least one, all must exist. */
  assets: string[]
  /** Optional execution conventions copied into the definition. */
  conventions?: {
    verbs?: string[]
    notes?: string
  }
}

/** Result of creating one Work mode definition. */
export interface CreateWorkResult {
  name: string
  path: string
  /** The generated session seed (the workbench brief). */
  seed: string
}
