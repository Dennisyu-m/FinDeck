/**
 * Host-visible automation task and run records.
 * @module @deepseek-ai/dsh-automation-runner
 */

/** How a pipeline task is armed. `manual` is listed and can be run now; it is not armed. */
export type AutomationTrigger =
  | { readonly kind: 'manual' }
  | { readonly kind: 'cron'; readonly schedule: string }
  | { readonly kind: 'interval'; readonly everySeconds: number }

/** One configured trigger of a desk task. */
export type DeskTrigger =
  | { readonly kind: 'cron'; readonly schedule: string }
  | { readonly kind: 'interval'; readonly everySeconds: number }
  | { readonly kind: 'event'; readonly name: string }
  | { readonly kind: 'thesis-due' }

/** Where one desk run came from; carried on every record of that run. */
export type DeskRunTrigger =
  | { readonly kind: 'manual' }
  | { readonly kind: 'cron'; readonly schedule: string }
  | { readonly kind: 'interval'; readonly everySeconds: number }
  | { readonly kind: 'event'; readonly name: string; readonly deliveryId?: string; readonly source?: string }
  | { readonly kind: 'thesis-due'; readonly theses: readonly string[] }

/** One desk task as the host service registers it with the shared scheduler. */
export interface DeskTaskRegistration {
  /** Kebab-case name; unique across pipelines and desk tasks. */
  readonly name: string
  /** Absolute path of the task yaml, used for diagnostics and the run snapshot. */
  readonly path: string
  /** Human-facing name. */
  readonly displayName: string
  /** Natural-language goal from the task file. */
  readonly goal: string
  /** Whether a report is produced every run or only when at least one signal moved. */
  readonly report: 'always' | 'changes'
  /** Configured triggers in file order. */
  readonly triggers: readonly DeskTrigger[]
  /** Wall-clock cap for the complete run, in milliseconds. */
  readonly wallMs: number
  /** Cumulative model-usage budget for the run, in input plus output tokens. */
  readonly tokens: number
  /** Per-request output cap; `null` uses the deployment default. */
  readonly maxOutputTokens: number | null
  /** False keeps the task listed but unarmed and refuses scheduled starts. */
  readonly enabled: boolean
  /**
   * Deterministic feedback summary to hand the model through a logged tool
   * call. The host service computes it at run start.
   */
  readonly preferences: () => string | Promise<string>
}

/** One signal row as `findeck.desk` writes it. Fields not listed stay available by index. */
export interface DeskSignalRow {
  readonly kind: string
  readonly ref: string
  readonly status: string
  readonly asset?: string
  readonly version?: number
  readonly note?: string
  readonly [key: string]: unknown
}

/** One asset version the signal step read. */
export interface DeskInputVersion {
  readonly asset: string
  readonly version: number
  readonly kind?: string
}

/** The deterministic signal record one run produced. */
export interface DeskSignalRecord {
  readonly runId: string
  readonly task: string
  readonly status: string
  readonly trigger: DeskRunTrigger
  readonly signals: readonly DeskSignalRow[]
  readonly inputs: readonly DeskInputVersion[]
  readonly summary: {
    readonly moves: number
    readonly quiet: number
    readonly stale: number
    readonly missing: number
    readonly due: number
    readonly recorded: number
  }
  readonly [key: string]: unknown
}

/** One archived report as the run record references it. */
export interface DeskRunReport {
  readonly asset: string
  readonly version: number
  readonly dir: string
  readonly tags: readonly string[]
  readonly fallback: boolean
}

/** Cumulative model usage one run counted. */
export interface DeskRunUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly reasoningTokens: number | null
  readonly requests: number
  /** True when at least one step reported no usage sample. */
  readonly unknown: boolean
}

/**
 * Final state of one desk run.
 * `degraded` means a no-interpretation report was archived because the AI
 * part did not finish; the process facts and `stopReason` stay separate.
 * `cancelled` is the headline when cancel, task removal, or unload ran,
 * even if the wall clock also expired or the child exited non-zero.
 * `timedOut`, `exitCode`, and `cancelled` stay independent of that headline.
 * A non-zero exit without a cancel is `failed`, or `timeout` when the wall
 * clock fired.
 */
export type DeskRunStatus =
  | 'running'
  | 'ok'
  | 'degraded'
  | 'no-change'
  | 'data-insufficient'
  | 'budget'
  | 'timeout'
  | 'cancelled'
  | 'failed'
  | 'skipped'

/** One complete desk run, built by merging its started/signal/report/finished lines. */
export interface DeskRun {
  readonly runId: string
  readonly task: string
  readonly trigger: DeskRunTrigger
  readonly status: DeskRunStatus
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly durationMs: number | null
  readonly sessionId: string | null
  readonly report: DeskRunReport | null
  readonly signals: readonly DeskSignalRow[]
  readonly inputs: readonly DeskInputVersion[]
  readonly summary: DeskSignalRecord['summary'] | null
  /** Why the run stopped: completed | failed | timeout | cancel | budget | no-report | no-change | data-insufficient. */
  readonly stopReason: string | null
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly cancelled: boolean
  readonly usage: DeskRunUsage | null
  readonly error: string | null
  readonly stderrTail: string | null
  /** True when the run owed a report (always, or changes with moves). */
  readonly reportExpected: boolean
}

/** Outcome of {@link AutomationRunner.runDeskTask}. */
export interface DeskRunOutcome {
  readonly runId: string
  readonly status: DeskRunStatus
  readonly report: DeskRunReport | null
  readonly stopReason: string
}

/**
 * One task the runner can list.
 * `kind` is a closed union: `pipeline` runs a pipeline yaml; `desk` runs a
 * registered desk task.
 */
export interface AutomationTaskSnapshot {
  readonly name: string
  readonly kind: 'pipeline' | 'desk'
  readonly trigger: AutomationTrigger
  /** Local-time ISO timestamp of the next armed fire, or `null` when the task is not armed. */
  readonly nextRunAt: string | null
  /** Latest run line for this task, or `null` when the file has no record. */
  readonly last: AutomationLastResult | null
}

/** Fields read back from the latest `pipeline-runs` line. */
export interface AutomationLastResult {
  readonly ts: string
  readonly status: string
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly signal: string | null
}

/** Outcome of {@link AutomationRunner.runNow} and of an armed pipeline fire. */
export interface AutomationRunResult {
  readonly name: string
  readonly status: 'ok' | 'failed' | 'skipped'
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly signal: string | null
}

/** Plugin configuration. Schemastery fills every field before the constructor runs. */
export interface Config {
  /** Directory holding desk run records; defaults to `<harness home>/desk/runs`. */
  readonly deskRunsDir?: string
  /** Working directory for the finance Python child and the desk profile. Relative paths resolve against the package default. */
  readonly repoRoot?: string
  /** Finance venv interpreter. Relative paths resolve against `repoRoot`. */
  readonly pythonPath?: string
  /** Path of the built dsh CLI entry used for the desk profile. Relative paths resolve against `repoRoot`. */
  readonly cliBin?: string
  /** Profile name of the desk execution composition. */
  readonly deskProfile?: string
  /**
   * Asset library root passed to the child as `FINDECK_ASSET_DIR`.
   * Relative paths resolve against the harness home default.
   */
  readonly assetDir?: string
  /** Wall-clock budget for one pipeline process, in milliseconds. */
  readonly timeoutMs?: number
  /** `latest` runs the single most recent missed pipeline fire on startup. `none` waits for the next future fire. */
  readonly catchUp?: 'latest' | 'none'
  /** Maximum stderr bytes copied onto a run record. */
  readonly stderrTailBytes?: number
  /** Grace given to `ctx.subprocess` after abort, in milliseconds. */
  readonly graceMs?: number
  /** Deployment default for one desk model request's output cap. */
  readonly deskMaxOutputTokens?: number
  /** Upper bound on one fallback report archive invocation, in milliseconds. */
  readonly archiveTimeoutMs?: number
  /** Captured stdout/stderr cap for the signal step and one fallback archive. */
  readonly deskSignalMaxBytes?: number
  /** Tail window used to find this run's report line, in bytes. */
  readonly deskLogReadMaxBytes?: number
  /** Deterministic threshold: absolute close-to-close move counted as a signal. */
  readonly deskMovePct?: number
  /** Deterministic threshold: volume multiple over the previous bar counted as a signal. */
  readonly deskVolumeRatio?: number
  /** Deterministic threshold: maximum age of an asset's declared `as_of`. */
  readonly deskFreshnessMaxAgeDays?: number
}
