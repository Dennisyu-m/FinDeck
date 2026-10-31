/**
 * Host scheduler for automation tasks.
 *
 * `pipeline` tasks come from `finance/pipelines/*.yaml` and run `python -m
 * findeck.pipeline run`. `desk` tasks are registered by the desk host service
 * from `~/.findeck/desk/tasks/*.yaml`; the same scheduler arms their cron and
 * interval triggers, while the desk service owns event and thesis-due triggers
 * and calls {@link AutomationRunner.runDeskTask} for them. The runner stays
 * mounted even when the desk layer is disabled, so turning the desk switch off
 * unregisters its tasks without stopping pipelines.
 *
 * One desk run writes a `started` line, then the Python signal line, then the
 * model child's report line, then the runner's `finished` line — all sharing
 * one run id. The finished line carries the process facts, the archived report,
 * the input asset versions, cumulative usage, and a stop reason, so a consumer
 * never infers a run's outcome from the file's last line.
 *
 * @module @deepseek-ai/dsh-automation-runner
 */

import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { missedFire, nextFire, SEGMENT_MS } from './clock.ts'
import {
  appendJsonlLine,
  appendRunLine,
  assertDeskTrigger,
  deskRunLogPath,
  localIso,
  parseRecordTime,
  readLastDeskResult,
  readLastResult,
  readRunLog,
} from './load.ts'
import type { PipelineFile } from './load.ts'
import type {
  AutomationLastResult,
  AutomationRunResult,
  AutomationTaskSnapshot,
  AutomationTrigger,
  Config,
  DeskInputVersion,
  DeskRunOutcome,
  DeskRunReport,
  DeskRunStatus,
  DeskRunTrigger,
  DeskRunUsage,
  DeskSignalRecord,
  DeskSignalRow,
  DeskTaskRegistration,
} from './types.ts'

export type {
  AutomationLastResult,
  AutomationRunResult,
  AutomationTaskSnapshot,
  AutomationTrigger,
  Config,
  DeskInputVersion,
  DeskRun,
  DeskRunOutcome,
  DeskRunReport,
  DeskRunStatus,
  DeskRunTrigger,
  DeskRunUsage,
  DeskSignalRecord,
  DeskSignalRow,
  DeskTaskRegistration,
  DeskTrigger,
} from './types.ts'

export { deskRunLogPath, readLastDeskResult, readRunLog } from './load.ts'
export { mergeDeskRuns } from './records.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live automation scheduler shared by pipelines and desk tasks. */
    automationRunner: AutomationRunner
  }
}

const VENV_PYTHON_REL = process.platform === 'win32'
  ? 'finance/python/.venv/Scripts/python.exe'
  : 'finance/python/.venv/bin/python'

const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const DEFAULT_PYTHON_PATH = fileURLToPath(new URL(`../../../../${VENV_PYTHON_REL}`, import.meta.url))
const DEFAULT_CLI_BIN = fileURLToPath(new URL('../../../../apps/cli/lib/bin.js', import.meta.url))

interface PipelineLoaded {
  readonly kind: 'pipeline'
  readonly name: string
  readonly path: string
  readonly trigger: AutomationTrigger
  nextAt: number | null
  last: AutomationLastResult | null
}

/** The desk triggers the shared scheduler arms; event and thesis-due live with the desk service. */
type ArmedDeskTrigger =
  | { readonly kind: 'cron'; readonly schedule: string }
  | { readonly kind: 'interval'; readonly everySeconds: number }

interface DeskLoaded {
  readonly kind: 'desk'
  readonly registration: DeskTaskRegistration
  readonly name: string
  readonly path: string
  /** Cron and interval triggers only; event and thesis-due are dispatched by the desk service. */
  readonly armed: readonly ArmedDeskTrigger[]
  /** The armed trigger that produced {@link nextAt}. */
  nextTrigger: ArmedDeskTrigger | null
  nextAt: number | null
  last: AutomationLastResult | null
}

type LoadedTask = PipelineLoaded | DeskLoaded

interface ResolvedConfig {
  readonly deskRunsDir: string
  readonly repoRoot: string
  readonly pythonPath: string
  readonly cliBin: string
  readonly deskProfile: string
  readonly assetDir: string
  readonly timeoutMs: number
  readonly catchUp: 'latest' | 'none'
  readonly stderrTailBytes: number
  readonly graceMs: number
  readonly deskMaxOutputTokens: number
  readonly archiveTimeoutMs: number
  readonly deskMovePct: number
  readonly deskVolumeRatio: number
  readonly deskFreshnessMaxAgeDays: number
  readonly deskSignalMaxBytes: number
  readonly deskLogReadMaxBytes: number
}

/** One active run, so cancellation can mark its own cause. */
interface ActiveRun {
  readonly controller: AbortController
  readonly kind: 'pipeline' | 'desk'
  cancel(): void
}

/** Cumulative usage derived from the child's `step_end` events. */
interface UsageAccumulator {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  reasoningTokens: number | null
  requests: number
  unknown: boolean
}

/** The `turn/end` reason one child reported. */
interface TurnReason {
  readonly kind: string
  readonly [key: string]: unknown
}

/** Facts collected from one `--json` child stream. */
interface ChildStream {
  sessionId: string | null
  turnReason: TurnReason | null
  errorMessage: string | null
  usage: UsageAccumulator
  stderrTail: string
}

/**
 * Schedules pipeline yaml files and registered desk tasks and runs them with
 * the finance venv and the desk profile.
 */
export default class AutomationRunner extends Service {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    deskRunsDir: z.string().default(''),
    repoRoot: z.string().default(DEFAULT_REPO_ROOT),
    pythonPath: z.string().default(DEFAULT_PYTHON_PATH),
    cliBin: z.string().default(''),
    deskProfile: z.string().default('desk'),
    assetDir: z.string().default(''),
    timeoutMs: z.natural().min(1).default(30 * 60 * 1000),
    catchUp: z.union(['latest', 'none'] as const).default('latest'),
    stderrTailBytes: z.natural().min(1).default(8192),
    graceMs: z.natural().min(1).default(15_000),
    deskMaxOutputTokens: z.natural().min(1).default(2048),
    archiveTimeoutMs: z.natural().min(1).default(120_000),
    deskMovePct: z.number().min(0).max(1).default(0.03),
    deskVolumeRatio: z.number().min(1).default(2),
    deskFreshnessMaxAgeDays: z.natural().min(0).default(7),
    deskSignalMaxBytes: z.natural().min(1).default(1024 * 1024),
    deskLogReadMaxBytes: z.natural().min(1024).default(8 * 1024 * 1024),
  })

  private readonly config: ResolvedConfig
  private pipelines: PipelineLoaded[] = []
  private readonly desks = new Map<string, DeskLoaded>()
  /** Catch up pipelines only on the first registration in this process, not when the switch is re-enabled. */
  private pipelinesArmedOnce = false
  private closing = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly inflight = new Set<Promise<void>>()
  private readonly active = new Map<string, ActiveRun>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'automationRunner')
    const repoRoot = resolve(config.repoRoot && config.repoRoot !== '' ? config.repoRoot : DEFAULT_REPO_ROOT)
    const assetDir = config.assetDir !== undefined && config.assetDir !== ''
      ? (isAbsolute(config.assetDir) ? config.assetDir : resolve(dshHomePath(), config.assetDir))
      : dshHomePath('asset-library')
    const deskRunsDir = config.deskRunsDir !== undefined && config.deskRunsDir !== ''
      ? (isAbsolute(config.deskRunsDir) ? config.deskRunsDir : resolve(repoRoot, config.deskRunsDir))
      : dshHomePath('desk', 'runs')
    this.config = {
      deskRunsDir,
      repoRoot,
      pythonPath: isAbsolute(config.pythonPath ?? '')
        ? config.pythonPath!
        : resolve(repoRoot, config.pythonPath && config.pythonPath !== '' ? config.pythonPath : DEFAULT_PYTHON_PATH),
      cliBin: isAbsolute(config.cliBin ?? '')
        ? config.cliBin!
        : resolve(repoRoot, config.cliBin && config.cliBin !== '' ? config.cliBin : DEFAULT_CLI_BIN),
      deskProfile: config.deskProfile && config.deskProfile !== '' ? config.deskProfile : 'desk',
      assetDir,
      timeoutMs: config.timeoutMs ?? 30 * 60 * 1000,
      catchUp: config.catchUp ?? 'latest',
      stderrTailBytes: config.stderrTailBytes ?? 8192,
      graceMs: config.graceMs ?? 15_000,
      deskMaxOutputTokens: config.deskMaxOutputTokens ?? 2048,
      archiveTimeoutMs: config.archiveTimeoutMs ?? 120_000,
      deskMovePct: config.deskMovePct ?? 0.03,
      deskVolumeRatio: config.deskVolumeRatio ?? 2,
      deskFreshnessMaxAgeDays: config.deskFreshnessMaxAgeDays ?? 7,
      deskSignalMaxBytes: config.deskSignalMaxBytes ?? 1024 * 1024,
      deskLogReadMaxBytes: config.deskLogReadMaxBytes ?? 8 * 1024 * 1024,
    }
    ctx.effect(() => {
      return async () => {
        this.closing = true
        for (const run of this.active.values()) {
          run.cancel()
          run.controller.abort()
        }
        await Promise.all([...this.inflight])
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.timer = undefined
      }
    })
  }

  /**
   * Every loaded task, with its next fire and the latest run line. The
   * scheduled-tasks page filters to `kind: 'pipeline'`; the desk page uses the
   * `desk` rows.
   * @returns a snapshot copied from the current timer state.
   */
  list(): AutomationTaskSnapshot[] {
    return [
      ...this.pipelines.map(task => ({
        name: task.name,
        kind: task.kind,
        trigger: task.trigger,
        nextRunAt: task.nextAt === null ? null : localIso(task.nextAt),
        last: task.last,
      } satisfies AutomationTaskSnapshot)),
      ...[...this.desks.values()].map(task => ({
        name: task.name,
        kind: task.kind,
        trigger: displayTriggerOf(task),
        nextRunAt: task.nextAt === null ? null : localIso(task.nextAt),
        last: task.last,
      } satisfies AutomationTaskSnapshot)),
    ]
  }

  /**
   * Run one pipeline now. A task that is already running is recorded as `skipped` and does not start a second process.
   * @param name - pipeline name, matching the yaml filename.
   * @returns the outcome. `timedOut` is independent of `exitCode`.
   */
  runNow(name: string): Promise<AutomationRunResult> {
    const task = this.pipelines.find(item => item.name === name)
    if (task === undefined) throw new Error(`automation task not found: ${name}`)
    return this.runPipeline(task)
  }

  /**
   * Replace the registered desk tasks. The desk service calls this on load,
   * after a task write or enable toggle, and with an empty list on unload.
   * A removed or renamed task's in-flight run is cancelled; editing a task
   * keeps its current run, which continues on the snapshot taken at start.
   * @param tasks - the complete desk task set.
   */
  setDeskTasks(tasks: readonly DeskTaskRegistration[]): void {
    if (this.closing) throw new Error('automation runner is closing')
    const next = new Map<string, DeskLoaded>()
    const pipelineNames = new Set(this.pipelines.map(task => task.name))
    for (const registration of tasks) {
      if (next.has(registration.name)) {
        throw new Error(`duplicate desk task name: ${registration.name}`)
      }
      if (pipelineNames.has(registration.name)) {
        throw new Error(`desk task name collides with a pipeline: ${registration.name}`)
      }
      for (const trigger of registration.triggers) assertDeskTrigger(trigger, registration.path)
      const previous = this.desks.get(registration.name)
      const armed = registration.triggers.filter((trigger): trigger is ArmedDeskTrigger =>
        trigger.kind === 'cron' || trigger.kind === 'interval')
      const loaded: DeskLoaded = {
        kind: 'desk',
        registration,
        name: registration.name,
        path: registration.path,
        armed,
        nextTrigger: null,
        nextAt: previous?.nextAt ?? null,
        last: previous?.last ?? readLastDeskResult(deskRunLogPath(this.config.deskRunsDir, registration.name)),
      }
      const changed = previous === undefined
        || JSON.stringify(previous.registration.triggers) !== JSON.stringify(registration.triggers)
        || previous.registration.enabled !== registration.enabled
      if (changed) {
        // A newly registered or edited trigger starts at its next future fire;
        // it does not replay a fire that passed while the layer was disabled.
        loaded.nextAt = registration.enabled ? this.advanceDeskAt(loaded, Date.now()) : null
      }
      if (!registration.enabled) loaded.nextAt = null
      next.set(registration.name, loaded)
    }
    for (const [name, previous] of this.desks) {
      if (next.has(name)) continue
      const run = this.active.get(name)
      if (run?.kind === 'desk') {
        run.cancel()
        run.controller.abort()
      }
      void previous
    }
    this.desks.clear()
    for (const [name, task] of next) this.desks.set(name, task)
    this.rearm()
  }

  /**
   * Whether one desk task currently has a run in flight.
   * @param name - desk task name.
   * @returns true while a run has not settled.
   */
  isDeskRunning(name: string): boolean {
    return this.active.get(name)?.kind === 'desk'
  }

  /**
   * Cancel the active run of one desk task.
   * @param name - desk task name.
   * @returns whether a run was active. The run records `cancelled` when it settles.
   */
  cancelDeskTask(name: string): boolean {
    const run = this.active.get(name)
    if (run === undefined || run.kind !== 'desk') return false
    run.cancel()
    run.controller.abort()
    return true
  }

  /**
   * Run one registered desk task now or from an external trigger.
   * @param name - desk task name.
   * @param trigger - run origin; defaults to `manual`.
   * @returns the settled run outcome.
   */
  async runDeskTask(name: string, trigger: DeskRunTrigger = { kind: 'manual' }): Promise<DeskRunOutcome> {
    const task = this.desks.get(name)
    if (task === undefined) throw new Error(`desk task not found: ${name}`)
    return this.runDesk(task, trigger)
  }

  private hydrate(file: PipelineFile, previous?: PipelineLoaded): PipelineLoaded {
    return {
      kind: 'pipeline',
      name: file.name,
      path: file.path,
      trigger: file.trigger,
      nextAt: previous?.nextAt ?? null,
      last: previous?.last ?? readLastResult(this.config.assetDir, file.name),
    }
  }

  /**
   * Replace the registered pipeline set. The pipeline-scheduler plugin owns
   * loading `finance/pipelines/*.yaml`; this method only schedules what it is
   * given, so unloading that plugin stops pipelines and leaves desk tasks
   * armed (and vice versa).
   * @param files - parsed pipeline definitions; their names must not collide
   * with a registered desk task.
   */
  setPipelineTasks(files: readonly PipelineFile[]): void {
    // A sibling fiber's dispose may run after the runner's own teardown; the
    // empty unregister is then a no-op because there is nothing left to arm.
    if (this.closing && files.length === 0) return
    if (this.closing) throw new Error('automation runner is closing')
    const next: PipelineLoaded[] = []
    const seen = new Set<string>()
    for (const file of files) {
      if (seen.has(file.name)) throw new Error(`duplicate pipeline name: ${file.name}`)
      if (this.desks.has(file.name)) {
        throw new Error(`pipeline name collides with a desk task: ${file.name}`)
      }
      seen.add(file.name)
      const previous = this.pipelines.find(task => task.name === file.name)
      const loaded = this.hydrate(file, previous)
      if (previous !== undefined
        && JSON.stringify(previous.trigger) === JSON.stringify(loaded.trigger)) {
        loaded.nextAt = previous.nextAt
        loaded.last = previous.last
      } else {
        const plan = this.pipelineFires(loaded, Date.now())
        // Startup catch-up runs only the single latest missed fire; a switch
        // turned back on starts at the next future fire.
        if (!this.pipelinesArmedOnce && this.config.catchUp === 'latest' && plan.missed) {
          this.track(this.runPipeline(loaded))
        }
        loaded.nextAt = this.pipelineFires(loaded, Date.now()).next
      }
      next.push(loaded)
    }
    for (const previous of this.pipelines) {
      if (seen.has(previous.name)) continue
      const run = this.active.get(previous.name)
      if (run?.kind === 'pipeline') {
        run.cancel()
        run.controller.abort()
      }
    }
    this.pipelinesArmedOnce = true
    this.pipelines = next
    this.rearm()
  }

  private rearm(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.schedule()
  }

  private schedule(): void {
    if (this.closing) return
    const now = Date.now()
    let soonest: number | null = null
    for (const task of this.pipelines) {
      if (task.nextAt !== null && task.nextAt <= now) {
        task.nextAt = nextFire(task.trigger, now, this.anchorOf(task), task.path)
        this.track(this.runPipeline(task))
      }
      if (task.nextAt !== null && (soonest === null || task.nextAt < soonest)) soonest = task.nextAt
    }
    for (const task of this.desks.values()) {
      if (task.nextAt !== null && task.nextAt <= now) {
        const trigger = task.nextTrigger
        if (trigger !== null) {
          this.track(this.runDesk(task, trigger))
        }
        task.nextAt = this.advanceDeskAt(task, Date.now())
      }
      if (task.nextAt !== null && (soonest === null || task.nextAt < soonest)) soonest = task.nextAt
    }
    if (soonest === null) return
    const delay = Math.min(SEGMENT_MS, Math.max(0, soonest - Date.now()))
    this.timer = setTimeout(() => this.schedule(), delay)
  }

  /** Advance one desk task to its next armed fire and remember which trigger owns it. */
  private advanceDeskAt(task: DeskLoaded, now: number): number | null {
    if (!task.registration.enabled) {
      task.nextTrigger = null
      return null
    }
    let best: { at: number; trigger: ArmedDeskTrigger } | null = null
    for (const trigger of task.armed) {
      const at = nextFire(trigger, now, this.anchorOf(task), task.path)
      if (at !== null && (best === null || at < best.at)) best = { at, trigger }
    }
    task.nextTrigger = best?.trigger ?? null
    return best?.at ?? null
  }

  private track(run: Promise<unknown>): void {
    const settled = run.then(() => undefined, (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`automation run failed to record: ${message}`)
    })
    this.inflight.add(settled)
    void settled.finally(() => this.inflight.delete(settled))
  }

  private pipelineFires(task: PipelineLoaded, now: number): { next: number | null, missed: boolean } {
    const anchor = this.anchorOf(task)
    const next = task.trigger.kind === 'manual' ? null : nextFire(task.trigger, now, anchor, task.path)
    const missed = task.trigger.kind !== 'manual' && missedFire(task.trigger, now, anchor, task.path) !== null
    return { next, missed }
  }

  private anchorOf(task: LoadedTask): number | null {
    if (task.last === null) return null
    const file = task.kind === 'desk'
      ? deskRunLogPath(this.config.deskRunsDir, task.name)
      : join(this.config.assetDir, 'pipeline-runs', `${task.name}.jsonl`)
    return parseRecordTime(task.last.ts, file)
  }

  private async runPipeline(task: PipelineLoaded): Promise<AutomationRunResult> {
    if (this.closing || this.active.has(task.name)) {
      const skipped: AutomationRunResult = {
        name: task.name, status: 'skipped', exitCode: null, timedOut: false, signal: null,
      }
      await this.record(task, skipped, 0, '')
      return skipped
    }
    const controller = new AbortController()
    this.active.set(task.name, { controller, kind: 'pipeline', cancel: () => {} })
    const started = Date.now()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.config.timeoutMs)
    try {
      const handle = this.ctx.subprocess.spawn({
        argv: [this.config.pythonPath, '-m', 'findeck.pipeline', 'run', task.path],
        cwd: this.config.repoRoot,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: this.config.stderrTailBytes },
          stderr: { maxBytes: this.config.stderrTailBytes },
        },
        graceMs: this.config.graceMs,
        signal: controller.signal,
        env: {
          FINDECK_ASSET_DIR: this.config.assetDir,
          FINDECK_HOME: dshHomePath(),
          PYTHONIOENCODING: 'utf-8',
        },
      })
      const outcome = await handle.done
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      const result: AutomationRunResult = {
        name: task.name,
        status: outcome.exitCode === 0 && !timedOut ? 'ok' : 'failed',
        exitCode: outcome.exitCode,
        timedOut,
        signal: outcome.signal,
      }
      await this.record(task, result, Date.now() - started, tailBytes(stderr, this.config.stderrTailBytes))
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const result: AutomationRunResult = {
        name: task.name, status: 'failed', exitCode: null, timedOut, signal: null,
      }
      await this.record(task, result, Date.now() - started, tailBytes(message, this.config.stderrTailBytes))
      return result
    } finally {
      clearTimeout(timeout)
      this.active.delete(task.name)
    }
  }

  /**
   * Execute one desk run: deterministic signal step, then the desk-profile
   * model turn, then report association or a no-interpretation fallback.
   */
  private async runDesk(task: DeskLoaded, trigger: DeskRunTrigger): Promise<DeskRunOutcome> {
    const snapshot = task.registration
    const runId = `${snapshot.name}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
    const runsFile = deskRunLogPath(this.config.deskRunsDir, snapshot.name)
    if (this.closing || this.active.has(snapshot.name)) {
      const skipped = {
        runId,
        task: snapshot.name,
        trigger,
        status: 'skipped' as const,
        startedAt: localIso(Date.now()),
        finishedAt: localIso(Date.now()),
        durationMs: 0,
        sessionId: null,
        report: null,
        signals: [],
        inputs: [],
        summary: null,
        stopReason: 'already-running',
        exitCode: null,
        signal: null,
        timedOut: false,
        cancelled: false,
        usage: null,
        error: null,
        stderrTail: null,
        reportExpected: false,
      }
      await appendJsonlLine(runsFile, {
        ts: skipped.finishedAt, runId, task: snapshot.name, step: 'runner', event: 'started',
        trigger, startedAt: skipped.startedAt, status: 'running',
      })
      await appendJsonlLine(runsFile, {
        step: 'runner', event: 'finished', ...skipped,
      })
      return { runId, status: 'skipped', report: null, stopReason: 'already-running' }
    }
    const controller = new AbortController()
    // Wall-clock expiry aborts `controller` only. `cancelController` is the
    // user, removal, and unload path, so a timeout can still archive a
    // fallback while a cancel cannot start another child.
    const cancelController = new AbortController()
    let cancelled = false
    this.active.set(snapshot.name, {
      controller,
      kind: 'desk',
      cancel: () => {
        cancelled = true
        cancelController.abort()
      },
    })
    const startedAt = localIso(Date.now())
    const startedMs = Date.now()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, snapshot.wallMs)
    const scratch = await mkdtemp(join(tmpdir(), `findeck-desk-${snapshot.name}-`))
    const preferencesFile = join(scratch, 'preferences.txt')
    const auditFile = join(scratch, 'audit.jsonl')
    const sourcesFile = join(scratch, 'sources.jsonl')
    let signalRecord: DeskSignalRecord | null = null
    let report: DeskRunReport | null = null
    let reportSources: readonly DeskInputVersion[] | null = null
    let child: ChildStream = {
      sessionId: null,
      turnReason: null,
      errorMessage: null,
      usage: emptyUsage(),
      stderrTail: '',
    }
    let processStop: 'completed' | 'failed' | 'timeout' | 'budget' | 'cancel' = 'failed'
    let exitCode: number | null = null
    let exitSignal: string | null = null
    let errorMessage: string | null = null
    let stderrTail = ''
    let reportExpected = false
    try {
      await appendJsonlLine(runsFile, {
        ts: startedAt, runId, task: snapshot.name, step: 'runner', event: 'started',
        trigger, startedAt, status: 'running',
      })
      const signalRun = await this.spawnCollected(
        [
          this.config.pythonPath, '-m', 'findeck.desk', 'run', snapshot.path,
          '--run-id', runId,
          '--trigger-json', JSON.stringify(trigger),
          '--runs-dir', this.config.deskRunsDir,
          '--move-pct', String(this.config.deskMovePct),
          '--volume-ratio', String(this.config.deskVolumeRatio),
          '--freshness-max-age-days', String(this.config.deskFreshnessMaxAgeDays),
        ],
        'ignore',
        controller.signal,
        {
          FINDECK_ASSET_DIR: this.config.assetDir,
          FINDECK_HOME: dshHomePath(),
          FINDECK_DESK_DIR: dirnameOf(this.config.deskRunsDir),
          PYTHONIOENCODING: 'utf-8',
        },
        this.config.deskSignalMaxBytes,
      )
      exitCode = signalRun.exitCode
      exitSignal = signalRun.signal
      stderrTail = tailBytes(signalRun.stderr, this.config.stderrTailBytes)
      if (cancelled) {
        return await this.finishDesk({
          task, trigger, runId, runsFile, startedAt, startedMs, snapshot, sessionId: null,
          status: 'cancelled', stopReason: 'cancel',
          signalRecord: null, report: null, reportExpected: false, sources: null,
          exitCode, exitSignal, timedOut, cancelled, usage: null,
          error: null, stderrTail,
        })
      }
      if (timedOut || signalRun.exitCode !== 0) {
        processStop = timedOut ? 'timeout' : 'failed'
        errorMessage = `signal step failed: ${signalRun.stderr.trim() || `exit code ${String(signalRun.exitCode)}`}`
        return await this.finishDesk({
          task, trigger, runId, runsFile, startedAt, startedMs, snapshot, sessionId: child.sessionId,
          status: processStop === 'timeout' ? 'timeout' : 'failed',
          stopReason: processStop === 'timeout' ? 'timeout' : 'failed',
          signalRecord: null, report: null, reportExpected: false, sources: null,
          exitCode, exitSignal, timedOut, cancelled, usage: null,
          error: errorMessage, stderrTail,
        })
      }
      const parsed = parseSignalRecord(signalRun.stdout)
      if (parsed === null) {
        errorMessage = 'signal step produced no readable record'
        return await this.finishDesk({
          task, trigger, runId, runsFile, startedAt, startedMs, snapshot, sessionId: child.sessionId,
          status: 'failed', stopReason: 'failed',
          signalRecord: null, report: null, reportExpected: false, sources: null,
          exitCode, exitSignal, timedOut, cancelled, usage: null,
          error: errorMessage, stderrTail,
        })
      }
      signalRecord = parsed
      if (cancelled) {
        return await this.finishDesk({
          task, trigger, runId, runsFile, startedAt, startedMs, snapshot, sessionId: null,
          status: 'cancelled', stopReason: 'cancel',
          signalRecord, report: null, reportExpected: false, sources: signalRecord.inputs,
          exitCode, exitSignal, timedOut, cancelled, usage: null,
          error: null, stderrTail,
        })
      }
      // `changes` still reports a due-thesis recheck: the due date is the change
      // that justified this run, and the report carries the recheck outcome.
      reportExpected = snapshot.report === 'always' || parsed.summary.moves > 0 || parsed.summary.due > 0
      if (!reportExpected) {
        const status: DeskRunStatus = parsed.summary.moves === 0
          && parsed.summary.missing + parsed.summary.stale > 0
          && parsed.summary.quiet === 0
          && parsed.summary.recorded === 0
          && parsed.summary.due === 0
          ? 'data-insufficient'
          : 'no-change'
        return await this.finishDesk({
          task, trigger, runId, runsFile, startedAt, startedMs, snapshot, sessionId: child.sessionId,
          status, stopReason: status,
          signalRecord, report: null, reportExpected: false, sources: signalRecord.inputs,
          exitCode: 0, exitSignal: null, timedOut, cancelled, usage: null,
          error: null, stderrTail,
        })
      }
      let preferences = ''
      try {
        preferences = await snapshot.preferences()
      } catch (error) {
        // The preference summary is advisory; its failure must not abort a run
        // whose signal step already succeeded.
        preferences = ''
        this.ctx.logger.warn(`desk preferences failed for ${snapshot.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
      await writeFile(preferencesFile, preferences, { mode: 0o600 })
      const prompt = deskPrompt(snapshot, runId, trigger, parsed)
      // Cancel wins over the wall clock for the headline. A timeout that
      // lands before the model child still archives a fallback below; a
      // cancel does not start that child.
      const childRun = cancelled || timedOut || controller.signal.aborted
        ? undefined
        : await this.runDeskChild(
          runId,
          prompt,
          controller.signal,
          {
            FINDECK_ASSET_DIR: this.config.assetDir,
            FINDECK_HOME: dshHomePath(),
            FINDECK_DESK_DIR: dirnameOf(this.config.deskRunsDir),
            FINDECK_DESK_TASK: snapshot.name,
            FINDECK_DESK_RUN_ID: runId,
            FINDECK_DESK_RUNS_DIR: this.config.deskRunsDir,
            FINDECK_DESK_AUDIT_FILE: auditFile,
            FINDECK_DESK_PREFERENCES_FILE: preferencesFile,
            FINDECK_DESK_SOURCES_FILE: sourcesFile,
            FINDECK_DESK_BUDGET_TOKENS: String(snapshot.tokens),
            FINDECK_DESK_MAX_OUTPUT_TOKENS: String(snapshot.maxOutputTokens ?? this.config.deskMaxOutputTokens),
            PYTHONIOENCODING: 'utf-8',
          },
        )
      if (childRun !== undefined) {
        child = childRun.stream
        exitCode = childRun.exitCode
        exitSignal = childRun.signal
        stderrTail = tailBytes(childRun.stderr, this.config.stderrTailBytes)
      }
      if (cancelled) {
        processStop = 'cancel'
      } else if (childRun === undefined || timedOut) {
        processStop = 'timeout'
      } else if ((child.turnReason !== null && isBudgetStop(child.turnReason))
        || child.usage.inputTokens + child.usage.outputTokens >= snapshot.tokens) {
        // The child cancels the turn at the cap; a race where the cap was
        // crossed on the final step still reports the budget stop here.
        processStop = 'budget'
      } else if (childRun.exitCode === 0 && child.turnReason?.kind === 'completed') {
        processStop = 'completed'
      } else {
        processStop = 'failed'
      }
      errorMessage = processStop === 'failed'
        ? (child.errorMessage ?? describeTurnFailure(child.turnReason) ?? `desk profile exited with code ${String(childRun?.exitCode ?? null)}`)
        : null
      const lines = await readRunLog(runsFile, this.config.deskLogReadMaxBytes)
      report = findReport(lines.lines.map(line => line.value), runId)
      reportSources = findReportSources(lines.lines.map(line => line.value), runId)
      if (processStop === 'cancel') {
        return await this.finishDesk({
          task, trigger, runId, runsFile, startedAt, startedMs, snapshot, sessionId: child.sessionId,
          status: 'cancelled', stopReason: 'cancel',
          signalRecord, report, reportExpected: true, sources: reportSources,
          exitCode, exitSignal, timedOut, cancelled, usage: toUsage(child.usage),
          error: null, stderrTail,
        })
      }
      if (report === null && !cancelled) {
        report = await this.archiveFallback(
          snapshot, runId, parsed, processStop, child.sessionId, sourcesFile, cancelController.signal,
        )
        if (report !== null) {
          const fallbackLines = await readRunLog(runsFile, this.config.deskLogReadMaxBytes)
          reportSources = findReportSources(fallbackLines.lines.map(line => line.value), runId) ?? reportSources
        }
      }
      if (cancelled) {
        return await this.finishDesk({
          task, trigger, runId, runsFile, startedAt, startedMs, snapshot, sessionId: child.sessionId,
          status: 'cancelled', stopReason: 'cancel',
          signalRecord, report, reportExpected: true, sources: reportSources,
          exitCode, exitSignal, timedOut, cancelled, usage: toUsage(child.usage),
          error: null, stderrTail,
        })
      }
      if (report === null) {
        return await this.finishDesk({
          task, trigger, runId, runsFile, startedAt, startedMs, snapshot, sessionId: child.sessionId,
          status: 'failed',
          stopReason: processStop === 'completed' ? 'no-report' : processStop,
          signalRecord, report: null, reportExpected: true, sources: reportSources,
          exitCode, exitSignal, timedOut, cancelled, usage: toUsage(child.usage),
          error: errorMessage ?? 'the run produced no report and the fallback archive failed',
          stderrTail,
        })
      }
      const status: DeskRunStatus = report.fallback
        ? 'degraded'
        : processStop === 'completed' ? 'ok' : 'degraded'
      return await this.finishDesk({
        task, trigger, runId, runsFile, startedAt, startedMs, snapshot, sessionId: child.sessionId,
        status,
        stopReason: report.fallback
          ? (processStop === 'completed' ? 'no-report' : processStop)
          : processStop,
        signalRecord, report, reportExpected: true, sources: reportSources,
        exitCode, exitSignal, timedOut, cancelled, usage: toUsage(child.usage),
        error: errorMessage, stderrTail,
      })
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
      stderrTail = tailBytes(errorMessage, this.config.stderrTailBytes)
      return await this.finishDesk({
        task, trigger, runId, runsFile, startedAt, startedMs, snapshot, sessionId: child.sessionId,
        status: cancelled ? 'cancelled' : timedOut ? 'timeout' : 'failed',
        stopReason: cancelled ? 'cancel' : timedOut ? 'timeout' : 'failed',
        signalRecord, report, reportExpected, sources: reportSources,
        exitCode, exitSignal, timedOut, cancelled, usage: toUsage(child.usage),
        error: cancelled ? null : errorMessage, stderrTail,
      })
    } finally {
      clearTimeout(timeout)
      this.active.delete(snapshot.name)
      await rm(scratch, { recursive: true, force: true })
    }
  }

  /** Spawn the desk-profile child and fold its NDJSON stream. */
  private async runDeskChild(
    runId: string,
    prompt: string,
    signal: AbortSignal,
    env: Record<string, string>,
  ): Promise<{ exitCode: number | null, signal: string | null, stderr: string, stream: ChildStream }> {
    const handle = this.ctx.subprocess.spawn({
      argv: [process.execPath, this.config.cliBin, '--profile', this.config.deskProfile, '--json', '-'],
      cwd: this.config.repoRoot,
      stdio: {
        stdin: { data: prompt },
        stdout: 'pipe',
        stderr: { maxBytes: this.config.stderrTailBytes },
      },
      graceMs: this.config.graceMs,
      signal,
      env,
    })
    const stream: ChildStream = {
      sessionId: null,
      turnReason: null,
      errorMessage: null,
      usage: emptyUsage(),
      stderrTail: '',
    }
    const stdout = handle.stdout
    if (stdout === undefined) {
      throw new Error(`desk run ${runId} spawned without a stdout pipe`)
    }
    const onEvent = parseChildEvent(stream, runId)
    let buffer = ''
    let failed = false
    const consume = (chunk: string): void => {
      if (failed) return
      buffer += chunk
      try {
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (line.trim() !== '') onEvent(line)
          newline = buffer.indexOf('\n')
        }
      } catch (error) {
        // A child that breaks the projected-event contract is terminated; its
        // recorded error is the diagnostic, and teardown still reaches quiescence.
        failed = true
        stream.errorMessage = error instanceof Error ? error.message : String(error)
        handle.terminate()
        return
      }
      // The child bounds every projected line; an unbounded buffer would mean a
      // broken stream contract rather than protocol data.
      if (buffer.length > 256 * 1024) buffer = ''
    }
    stdout.setEncoding('utf8')
    stdout.on('data', (chunk: string) => { consume(chunk) })
    const streamDone = new Promise<void>((resolveStream) => {
      stdout.once('end', () => { resolveStream() })
      stdout.once('close', () => { resolveStream() })
      stdout.once('error', () => { resolveStream() })
    })
    const outcome = await handle.done
    // The provider drains collected pipes, but a raw pipe belongs to this
    // caller; a bounded race keeps teardown from hanging on a survivor.
    await Promise.race([
      streamDone,
      new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, 2000)
        timer.unref?.()
      }),
    ])
    if (!failed && buffer.trim() !== '') {
      try {
        onEvent(buffer)
      } catch (error) {
        stream.errorMessage = error instanceof Error ? error.message : String(error)
      }
    }
    stream.stderrTail = handle.collected.stderr?.readFrom(0).text ?? ''
    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      stderr: stream.stderrTail,
      stream,
    }
  }

  /**
   * Archive a no-interpretation report from the run's signal table.
   * The child is confined to the asset library. Python returns the run line
   * instead of writing the desk log, and this method appends that line.
   * `cancelSignal` aborts this attempt before `sandbox.confine`, including a
   * cancel that arrives while the temp directory is being created. The
   * wall-clock limit stays a separate `archiveTimeoutMs` timer.
   */
  private async archiveFallback(
    snapshot: DeskTaskRegistration,
    runId: string,
    signal: DeskSignalRecord,
    processStop: string,
    sessionId: string | null,
    sourcesFile: string,
    cancelSignal: AbortSignal,
  ): Promise<DeskRunReport | null> {
    const reason = processStop === 'completed'
      ? '运行结束但没有归档报告'
      : processStop === 'budget'
        ? '模型用量达到本次运行预算'
        : processStop === 'timeout'
          ? '本次运行超过墙钟上限'
          : '模型部分失败'
    const payload = {
      title: `${snapshot.displayName} ${localIso(Date.now()).slice(0, 10)} 无解读版`,
      fallback: true,
      fallbackReason: reason,
      sessionId,
    }
    const controller = new AbortController()
    const onCancel = (): void => { controller.abort() }
    // Subscribe before any await. addEventListener does not replay an abort
    // that already happened, so the following read closes that gap, including
    // a cancel that lands while mkdtemp is in flight.
    cancelSignal.addEventListener('abort', onCancel)
    if (cancelSignal.aborted) controller.abort()
    const timeout = setTimeout(() => controller.abort(), this.config.archiveTimeoutMs)
    let scratch: string | undefined
    try {
      if (controller.signal.aborted) return null
      scratch = await mkdtemp(join(tmpdir(), 'findeck-desk-fallback-'))
      if (controller.signal.aborted) return null
      const payloadFile = join(scratch, 'payload.json')
      await writeFile(payloadFile, JSON.stringify(payload, null, 2), { mode: 0o600 })
      const sandbox = this.ctx.get('sandbox') as SandboxProvider | undefined
      if (sandbox === undefined) {
        throw new Error('desk fallback archive requires the sandbox service, but this composition has none; refusing to write unconfined')
      }
      const policy: SandboxPolicy = {
        mode: 'workspace-write',
        workspaceRoot: this.config.assetDir,
      }
      const confined = await sandbox.confine([
        this.config.pythonPath, '-m', 'findeck.desk', 'archive-report',
        '--task', snapshot.name, '--run-id', runId,
        '--runs-dir', this.config.deskRunsDir,
        '--asset-dir', this.config.assetDir,
        '--payload', payloadFile,
        '--sources-file', sourcesFile,
        '--no-record',
      ], policy, controller.signal)
      const run = await this.spawnCollected(
        confined.argv,
        'ignore',
        controller.signal,
        {
          FINDECK_ASSET_DIR: this.config.assetDir,
          FINDECK_HOME: dshHomePath(),
          FINDECK_DESK_DIR: dirnameOf(this.config.deskRunsDir),
          PYTHONIOENCODING: 'utf-8',
        },
        this.config.deskSignalMaxBytes,
      )
      if (run.exitCode !== 0) {
        this.ctx.logger.warn(`desk fallback report failed for ${snapshot.name}: ${run.stderr.trim()}`)
        return null
      }
      const line = run.stdout.trim().split(/\r?\n/u).at(-1) ?? ''
      const parsed = JSON.parse(line) as {
        asset?: unknown
        version?: unknown
        dir?: unknown
        tags?: unknown
        fallback?: unknown
        line?: unknown
      }
      if (typeof parsed.asset !== 'string' || typeof parsed.version !== 'number' || typeof parsed.dir !== 'string') {
        this.ctx.logger.warn(`desk fallback report returned malformed result for ${snapshot.name}: ${line}`)
        return null
      }
      if (typeof parsed.line !== 'object' || parsed.line === null || Array.isArray(parsed.line)) {
        this.ctx.logger.warn(`desk fallback report returned no run record line for ${snapshot.name}: ${line}`)
        return null
      }
      await appendJsonlLine(
        deskRunLogPath(this.config.deskRunsDir, snapshot.name),
        parsed.line as Record<string, unknown>,
      )
      void signal
      return {
        asset: parsed.asset,
        version: parsed.version,
        dir: parsed.dir,
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        fallback: parsed.fallback === true,
      }
    } catch (error) {
      this.ctx.logger.warn(`desk fallback report failed for ${snapshot.name}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    } finally {
      clearTimeout(timeout)
      cancelSignal.removeEventListener('abort', onCancel)
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
    }
  }

  /** Write the finished line, update the task's last result, and return the outcome. */
  private async finishDesk(input: {
    task: DeskLoaded
    trigger: DeskRunTrigger
    runId: string
    runsFile: string
    startedAt: string
    startedMs: number
    snapshot: DeskTaskRegistration
    sessionId: string | null
    status: DeskRunStatus
    stopReason: string
    signalRecord: DeskSignalRecord | null
    report: DeskRunReport | null
    reportExpected: boolean
    sources: readonly DeskInputVersion[] | null
    exitCode: number | null
    exitSignal: string | null
    timedOut: boolean
    cancelled: boolean
    usage: DeskRunUsage | null
    error: string | null
    stderrTail: string
  }): Promise<DeskRunOutcome> {
    const finishedAt = localIso(Date.now())
    const durationMs = Date.now() - input.startedMs
    const record = {
      ts: finishedAt,
      runId: input.runId,
      task: input.snapshot.name,
      step: 'runner',
      event: 'finished',
      status: input.status,
      trigger: input.trigger,
      startedAt: input.startedAt,
      finishedAt,
      durationMs,
      sessionId: input.sessionId,
      report: input.report,
      signals: input.signalRecord?.signals ?? [],
      inputs: input.sources ?? input.signalRecord?.inputs ?? [],
      summary: input.signalRecord?.summary ?? null,
      stopReason: input.stopReason,
      exitCode: input.exitCode,
      signal: input.exitSignal,
      timedOut: input.timedOut,
      cancelled: input.cancelled,
      usage: input.usage,
      error: input.error,
      stderrTail: input.stderrTail,
      reportExpected: input.reportExpected,
    }
    await appendJsonlLine(input.runsFile, record)
    input.task.last = {
      ts: finishedAt,
      status: input.status,
      exitCode: input.exitCode,
      timedOut: input.timedOut,
      signal: input.exitSignal,
    }
    if (!this.closing && input.task.registration.enabled) {
      input.task.nextAt = this.advanceDeskAt(input.task, Date.now())
      this.rearm()
    }
    return { runId: input.runId, status: input.status, report: input.report, stopReason: input.stopReason }
  }

  private async spawnCollected(
    argv: readonly string[],
    stdin: 'ignore' | { readonly data: string },
    signal: AbortSignal,
    env: Record<string, string>,
    maxBytes: number,
  ): Promise<{ exitCode: number | null, signal: string | null, stdout: string, stderr: string }> {
    const handle = this.ctx.subprocess.spawn({
      argv,
      cwd: this.config.repoRoot,
      stdio: {
        stdin,
        stdout: { maxBytes },
        stderr: { maxBytes },
      },
      graceMs: this.config.graceMs,
      signal,
      env,
    })
    const outcome = await handle.done
    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
      stderr: handle.collected.stderr?.readFrom(0).text ?? '',
    }
  }

  private async record(
    task: PipelineLoaded,
    result: AutomationRunResult,
    durationMs: number,
    stderrTail: string,
  ): Promise<void> {
    const ts = localIso(Date.now())
    const failedStep = /步骤 ([a-z0-9-]+) 失败/.exec(stderrTail)?.[1] ?? 'runner'
    await appendRunLine(this.config.assetDir, task.name, {
      ts,
      pipeline: task.name,
      step: result.status === 'skipped' ? 'runner' : failedStep,
      status: result.status,
      produced: null,
      inputs: [],
      duration_s: Math.round(durationMs / 10) / 100,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      signal: result.signal,
      stderrTail,
    })
    task.last = {
      ts,
      status: result.status,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      signal: result.signal,
    }
  }
}

/** Report location for the outcome that started the run. */
function dirnameOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '')
}

/** The trigger the scheduled-tasks shape can express, for a desk row. */
function displayTriggerOf(task: DeskLoaded): AutomationTrigger {
  const armed = task.armed[0]
  if (armed === undefined) return { kind: 'manual' }
  return armed.kind === 'cron'
    ? { kind: 'cron', schedule: armed.schedule }
    : { kind: 'interval', everySeconds: armed.everySeconds }
}

function emptyUsage(): UsageAccumulator {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    requests: 0,
    unknown: false,
  }
}

function toUsage(usage: UsageAccumulator): DeskRunUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: usage.reasoningTokens,
    requests: usage.requests,
    unknown: usage.unknown,
  }
}

/** Add one step's usage to the running total; a missing sample makes the total incomplete. */
function addUsage(total: UsageAccumulator, usage: unknown): void {
  if (typeof usage !== 'object' || usage === null) {
    total.unknown = true
    return
  }
  const record = usage as Record<string, unknown>
  const input = record.inputTokens
  const output = record.outputTokens
  if (typeof input !== 'number' || typeof output !== 'number') {
    total.unknown = true
    return
  }
  total.inputTokens += input
  total.outputTokens += output
  const bucket = (key: string): void => {
    const value = record[key]
    if (typeof value !== 'number') return
    const current = key === 'cacheReadTokens'
      ? total.cacheReadTokens
      : key === 'cacheWriteTokens'
        ? total.cacheWriteTokens
        : total.reasoningTokens
    const next = (current ?? 0) + value
    if (key === 'cacheReadTokens') total.cacheReadTokens = next
    else if (key === 'cacheWriteTokens') total.cacheWriteTokens = next
    else total.reasoningTokens = next
  }
  bucket('cacheReadTokens')
  bucket('cacheWriteTokens')
  bucket('reasoningTokens')
}

/** Fold one NDJSON line from the child into {@link ChildStream}. */
function parseChildEvent(stream: ChildStream, runId: string): (line: string) => void {
  return (line: string): void => {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line) as Record<string, unknown>
    } catch (error) {
      throw new Error(`desk run ${runId}: child emitted a non-JSON line: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (event.type === 'session' && typeof event.sessionId === 'string') {
      stream.sessionId = event.sessionId
      return
    }
    if (event.type === 'status' && event.phase === 'step_end') {
      stream.usage.requests += 1
      if (event.usage === undefined) stream.usage.unknown = true
      else addUsage(stream.usage, event.usage)
      return
    }
    if (event.type === 'status' && event.phase === 'turn_end') {
      const reason = event.reason
      stream.turnReason = typeof reason === 'object' && reason !== null
        ? reason as TurnReason
        : null
      return
    }
    if (event.type === 'error' && typeof event.message === 'string') {
      stream.errorMessage = event.message
    }
  }
}

/** Whether a turn ended because the cumulative budget stopped it. */
function isBudgetStop(reason: TurnReason): boolean {
  if (reason.kind !== 'aborted') return false
  const nested = reason.reason
  return typeof nested === 'object' && nested !== null
    && (nested as { kind?: unknown }).kind === 'hook'
    && (nested as { reason?: unknown }).reason === 'budget'
}

/** Human-readable failure text for one turn reason. */
function describeTurnFailure(reason: TurnReason | null): string | null {
  if (reason === null) return null
  if (reason.kind === 'error') {
    const error = reason.error
    return typeof error === 'object' && error !== null
      ? `${String((error as { code?: unknown }).code ?? 'UNKNOWN')}: ${String((error as { message?: unknown }).message ?? '')}`
      : 'turn failed'
  }
  if (reason.kind === 'aborted') return 'turn aborted'
  if (reason.kind === 'max-tokens') return 'turn reached its output-token ceiling'
  return null
}

/** Parse the signal step's last JSON line. */
function parseSignalRecord(stdout: string): DeskSignalRecord | null {
  const line = stdout.trim().split(/\r?\n/u).at(-1) ?? ''
  if (line === '') return null
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.runId !== 'string' || typeof record.task !== 'string') return null
  if (!Array.isArray(record.signals) || typeof record.summary !== 'object' || record.summary === null) return null
  const summary = record.summary as Record<string, unknown>
  const count = (key: string): number => (typeof summary[key] === 'number' ? summary[key] as number : 0)
  const inputs: DeskInputVersion[] = Array.isArray(record.inputs)
    ? record.inputs.flatMap((item): DeskInputVersion[] => {
      if (typeof item !== 'object' || item === null) return []
      const entry = item as Record<string, unknown>
      return typeof entry.asset === 'string' && typeof entry.version === 'number'
        ? [{ asset: entry.asset, version: entry.version, ...typeof entry.kind === 'string' ? { kind: entry.kind } : {} }]
        : []
    })
    : []
  return {
    ...record,
    runId: record.runId,
    task: record.task,
    status: typeof record.status === 'string' ? record.status : 'ok',
    trigger: (record.trigger ?? { kind: 'manual' }) as DeskRunTrigger,
    signals: record.signals as DeskSignalRow[],
    inputs,
    summary: {
      moves: count('moves'),
      quiet: count('quiet'),
      stale: count('stale'),
      missing: count('missing'),
      due: count('due'),
      recorded: count('recorded'),
    },
  }
}

/** Find this run's archived report in the parsed run-log lines. */
function findReport(lines: readonly Record<string, unknown>[], runId: string): DeskRunReport | null {
  let found: DeskRunReport | null = null
  for (const line of lines) {
    if (line.runId !== runId || line.step !== 'report') continue
    const report = line.report
    if (typeof report !== 'object' || report === null) continue
    const entry = report as Record<string, unknown>
    if (typeof entry.asset !== 'string' || typeof entry.version !== 'number' || typeof entry.dir !== 'string') continue
    found = {
      asset: entry.asset,
      version: entry.version,
      dir: entry.dir,
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      fallback: entry.fallback === true,
    }
  }
  return found
}

/** Read the report line's merged signal+AI sources for one run. */
function findReportSources(
  lines: readonly Record<string, unknown>[],
  runId: string,
): readonly DeskInputVersion[] | null {
  let found: readonly DeskInputVersion[] | null = null
  for (const line of lines) {
    if (line.runId !== runId || line.step !== 'report') continue
    if (!Array.isArray(line.sources)) continue
    found = line.sources.flatMap((entry): DeskInputVersion[] => {
      if (typeof entry !== 'object' || entry === null) return []
      const row = entry as Record<string, unknown>
      if (typeof row.asset !== 'string' || typeof row.version !== 'number') return []
      return [{
        asset: row.asset,
        version: row.version,
        ...typeof row.kind === 'string' ? { kind: row.kind } : {},
      }]
    })
  }
  return found
}

/** The task text for the desk child: goal, run identity, and the deterministic signal table. */
function deskPrompt(
  task: DeskTaskRegistration,
  runId: string,
  trigger: DeskRunTrigger,
  signal: DeskSignalRecord,
): string {
  const triggerText = trigger.kind === 'manual'
    ? '手动触发'
    : trigger.kind === 'cron'
      ? `cron ${trigger.schedule}`
      : trigger.kind === 'interval'
        ? `每 ${String(trigger.everySeconds)} 秒`
        : trigger.kind === 'event'
          ? `webhook 事件 ${trigger.name}`
          : `命题到期 ${trigger.theses.join(', ')}`
  const signalJson = JSON.stringify(signal, null, 2)
  const boundedSignal = signalJson.length > 30000
    ? `${signalJson.slice(0, 30000)}\n…（已截断；完整记录见运行日志）`
    : signalJson
  return [
    `值班任务 ${task.name}（${task.displayName}）。`,
    `目标：${task.goal}`,
    `运行 id：${runId}；触发来源：${triggerText}；报告模式：${task.report === 'always' ? '每次都出' : '只在有异动时出'}。`,
    `本次累计 token 预算：${String(task.tokens)}（输入+输出）；单次请求输出上限：${String(task.maxOutputTokens ?? '执行器默认值')}。预算耗尽时执行器会中止本次运行，不要自行估算额度。`,
    '第一步必须调用 desk_preferences，读取用户近期的确定性反馈汇总；把它的结论用于安排解读重点。',
    '下面是本次运行的确定性信号记录（不含任何解读）：',
    '```json',
    boundedSignal,
    '```',
    '纪律：只展开 status=move 的标的；status=stale 写「数据未更新」，status=missing-source 写「缺少数据来源」，status=recorded 不展开无依据的推断。',
    '全部数字必须来自上面的记录或你本次通过工具实际读到的资产版本；不要补造数字，不要执行 shell，不要新建数据集/模型/代码/工具/Work。',
    '完成解读后调用一次 desk_report 归档四段式报告（要点≤5、异动解读、命题复检、待你决策），然后结束；不要在其它位置写报告文件。',
    '这个运行没有人在场：不要向用户提问，把需要用户决定的事写进报告的 decisions。',
  ].join('\n')
}

/** Keep only the last `max` bytes of a diagnostic string. */
function tailBytes(text: string, max: number): string {
  const bytes = Buffer.from(text)
  if (bytes.length <= max) return text
  return bytes.subarray(bytes.length - max).toString('utf8')
}
