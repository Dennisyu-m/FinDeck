/**
 * Desk task management, run reading, feedback, and the scorecard.
 *
 * This service is the one writer and reader of `~/.findeck/desk`: the
 * `desk_list` / `desk_show` / `desk_write` model tools and the Web desk page
 * both call it, so validation, atomic writes, enable toggles, immediate runs,
 * and cancellation have a single implementation. Task files are validated by
 * `python -m findeck.desk validate` before an atomic replacement; the shared
 * automation runner schedules them and executes them with the desk profile.
 *
 * The service also owns the two triggers the shared scheduler does not arm:
 * authenticated webhook deliveries (registered as trusted rules on
 * `ctx.webhookRuntime`) and thesis due dates (one consumption per task,
 * thesis, and due date, recorded in a ledger). Both call the runner's single
 * run entry, so concurrency and accounting stay in one place.
 *
 * Runs, reports, feedback, decisions, and the scorecard are read from disk on
 * demand. A run's outcome comes from its merged record, never from the last
 * line of a log file.
 *
 * @module @deepseek-ai/dsh-desk
 */

import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-thesis'
import type {} from '@deepseek-ai/dsh-webhook'
import { WebhookRuleId, type VerifiedWebhookDelivery, type WebhookRuntime } from '@deepseek-ai/dsh-webhook'
import {
  mergeDeskRuns,
  readRunLog,
  type DeskRun,
  type DeskRunOutcome,
  type DeskTaskRegistration,
} from '@deepseek-ai/dsh-automation-runner'
import type {
  AdoptThesisInput,
  Config,
  DecisionActionInput,
  DeskBudget,
  DeskDecisionView,
  DeskFeedbackInput,
  DeskFeedbackRow,
  DeskListResult,
  DeskReportBrief,
  DeskReportDetail,
  DeskReportSections,
  DeskRunDetail,
  DeskRunList,
  DeskRunQuery,
  DeskScorecard,
  DeskTarget,
  DeskTaskSpec,
  DeskTaskView,
  DeskTemplate,
  DeskTrigger,
} from './types.ts'
import { parseTaskYaml, serializeTask } from './tasks.ts'
import {
  appendFeedback,
  feedbackPaths,
  readFeedbackRows,
  readResetAt,
  resetPreferences as resetFeedbackState,
  revokeFeedback as revokeFeedbackRow,
} from './feedback.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Desk task management, run reading, feedback, and scorecard. */
    desk: DeskService
  }
}

/* v8 ignore start -- POSIX lanes exercise the venv bin/ peer; Windows always resolves the Scripts/ path. */
const VENV_PYTHON_REL = process.platform === 'win32'
  ? 'finance/python/.venv/Scripts/python.exe'
  : 'finance/python/.venv/bin/python'
/* v8 ignore stop */
const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const DEFAULT_PYTHON_PATH = fileURLToPath(new URL(`../../../../${VENV_PYTHON_REL}`, import.meta.url))

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_REPORT_BYTES = 512 * 1024

interface ResolvedConfig {
  readonly tasksDir: string
  readonly deskDir: string
  readonly runsDir: string
  readonly decisionsFile: string
  readonly dueLedgerFile: string
  readonly assetDir: string
  readonly pythonPath: string
  readonly repoRoot: string
  readonly maxRunsReadBytes: number
  readonly maxRunRecords: number
  readonly preferenceWindowDays: number
  readonly preferenceSuppressionMin: number
  readonly thesisCheckSeconds: number
  readonly thesisMaxAttempts: number
  readonly templateTokens: number
  readonly templateWallSeconds: number
}

/** One entry of `<deskDir>/decisions.jsonl`. */
interface DecisionAction {
  readonly ts: string
  readonly task: string
  readonly runId: string
  readonly decisionId: string
  readonly status: 'open' | 'handled'
}

/** One entry of `<deskDir>/triggers.jsonl`. */
interface DueLedgerRow {
  readonly ts: string
  readonly task: string
  readonly thesis: string
  readonly dueDate: string
  /** `started` is retryable after a crash/restart; `consumed` is final. */
  readonly state: 'started' | 'consumed' | 'failed'
  readonly attempt: number
  readonly runId?: string
  readonly status?: string
}

/** The last ledger state for one task/thesis/due-date. */
interface DueLedgerState {
  readonly state: 'started' | 'consumed' | 'failed'
  readonly attempts: number
}

/** One parsed task file plus its path. */
interface LoadedSpec {
  readonly spec: DeskTaskSpec
  readonly path: string
}

/** Assets summary read from the library index. */
interface LibraryAsset {
  readonly name: string
  readonly kind: string
  readonly latest_version: number
  readonly verbs: readonly string[]
  readonly freshnessAsOf: string | null
}

/** Run the finance Python module; throws when the interpreter cannot start. */
interface PythonRun {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * The desk host service. All public methods wait for the initial task load,
 * so a page opened immediately after the switch flips sees a settled state.
 */
export default class DeskService extends Service {
  static inject = ['automationRunner', 'thesis', 'subprocess', 'tools', 'timer']

  static Config: z<Config> = z.object({
    tasksDir: z.string().default(''),
    deskDir: z.string().default(''),
    assetDir: z.string().default(''),
    pythonPath: z.string().default(DEFAULT_PYTHON_PATH),
    repoRoot: z.string().default(DEFAULT_REPO_ROOT),
    maxRunsReadBytes: z.natural().min(1024).default(8 * 1024 * 1024),
    maxRunRecords: z.natural().min(1).default(500),
    preferenceWindowDays: z.natural().min(1).default(30),
    preferenceSuppressionMin: z.natural().min(1).default(2),
    thesisCheckSeconds: z.natural().min(30).default(300),
    thesisMaxAttempts: z.natural().min(1).default(3),
    templateTokens: z.natural().min(1).default(20_000),
    templateWallSeconds: z.natural().min(1).default(600),
  })

  private readonly config: ResolvedConfig
  private specs = new Map<string, LoadedSpec>()
  private problems: string[] = []
  private signature = ''
  private ready: Promise<void>
  private reloadChain: Promise<void> = Promise.resolve()
  private closing = false
  private thesisTickRunning = false
  private webhookRuntime: WebhookRuntime | undefined
  private readonly webhookRules = new Map<string, () => Promise<void>>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'desk')
    const repoRoot = resolve(config.repoRoot ?? DEFAULT_REPO_ROOT)
    const deskDir = config.deskDir !== undefined && config.deskDir !== ''
      ? (isAbsolute(config.deskDir) ? config.deskDir : resolve(repoRoot, config.deskDir))
      : dshHomePath('desk')
    const tasksDir = config.tasksDir !== undefined && config.tasksDir !== ''
      ? (isAbsolute(config.tasksDir) ? config.tasksDir : resolve(repoRoot, config.tasksDir))
      : join(deskDir, 'tasks')
    this.config = {
      tasksDir,
      deskDir,
      runsDir: join(deskDir, 'runs'),
      decisionsFile: join(deskDir, 'decisions.jsonl'),
      dueLedgerFile: join(deskDir, 'triggers.jsonl'),
      assetDir: config.assetDir !== undefined && config.assetDir !== ''
        ? (isAbsolute(config.assetDir) ? config.assetDir : resolve(dshHomePath(), config.assetDir))
        : dshHomePath('asset-library'),
      pythonPath: config.pythonPath !== undefined && config.pythonPath !== ''
        ? (isAbsolute(config.pythonPath) ? config.pythonPath : resolve(repoRoot, config.pythonPath))
        : DEFAULT_PYTHON_PATH,
      repoRoot,
      maxRunsReadBytes: config.maxRunsReadBytes ?? 8 * 1024 * 1024,
      maxRunRecords: config.maxRunRecords ?? 500,
      preferenceWindowDays: config.preferenceWindowDays ?? 30,
      preferenceSuppressionMin: config.preferenceSuppressionMin ?? 2,
      thesisCheckSeconds: config.thesisCheckSeconds ?? 300,
      thesisMaxAttempts: config.thesisMaxAttempts ?? 3,
      templateTokens: config.templateTokens ?? 20_000,
      templateWallSeconds: config.templateWallSeconds ?? 600,
    }
    this.ready = this.reloadNow().catch((error: unknown) => {
      this.problems = [`task load failed: ${error instanceof Error ? error.message : String(error)}`]
    })
    ctx.effect(() => {
      const stopTicker = ctx.interval(() => {
        void this.checkThesisDue().catch((error: unknown) => {
          this.ctx.logger.warn(`desk thesis-due tick failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }, this.config.thesisCheckSeconds * 1000)
      return async () => {
        this.closing = true
        stopTicker()
        await this.ready.catch(() => undefined)
        await this.disposeWebhookRules()
        // Unregistering the desk set is what stops desk scheduling and cancels
        // its in-flight runs; pipelines stay armed on the shared runner.
        this.ctx.automationRunner.setDeskTasks([])
      }
    }, 'desk: thesis-due ticker and runner registration')
    ctx.inject(['webhookRuntime'], (webhookCtx) => {
      this.webhookRuntime = webhookCtx.webhookRuntime
      void this.syncWebhookRules()
      return () => {
        this.webhookRuntime = undefined
        void this.disposeWebhookRules()
      }
    })
    this.registerTools()
  }

  /** The resolved desk data directory (runs, feedback, ledgers). */
  get dir(): string {
    return this.config.deskDir
  }

  /** The configured task directory. */
  get tasksDirectory(): string {
    return this.config.tasksDir
  }

  /**
   * Every task file plus the current runtime state.
   * @returns the task views and per-file problems.
   */
  async list(): Promise<DeskListResult> {
    await this.ensureFresh()
    return { tasks: [...this.specs.values()].map(({ spec }) => this.viewOf(spec)), problems: [...this.problems] }
  }

  /**
   * One task's complete definition.
   * @param name - task name.
   * @returns the spec and its view.
   * @throws when the task does not exist.
   */
  async show(name: string): Promise<{ spec: DeskTaskSpec; view: DeskTaskView; recent: readonly DeskRun[] }> {
    await this.ensureFresh()
    const loaded = this.specs.get(name)
    if (loaded === undefined) throw new Error(`desk task not found: ${name}`)
    const runs = await this.runs({ task: name, limit: 5 })
    return { spec: loaded.spec, view: this.viewOf(loaded.spec), recent: runs.runs }
  }

  /**
   * Create or replace one task file after the Python validator accepts it.
   * @param spec - complete definition.
   * @returns the stored view.
   * @throws when the definition is invalid, the name collides with a pipeline
   * or an unrelated file, or the atomic write fails.
   */
  async write(spec: DeskTaskSpec): Promise<DeskTaskView> {
    this.assertSpecShape(spec)
    await this.ensureFresh()
    if (!KEBAB.test(spec.name)) throw new Error(`task name must be kebab-case: ${spec.name}`)
    const pipelineNames = new Set(
      this.ctx.automationRunner.list().filter(task => task.kind === 'pipeline').map(task => task.name),
    )
    if (pipelineNames.has(spec.name)) {
      throw new Error(`task name "${spec.name}" is already a pipeline; choose another name`)
    }
    const file = join(this.config.tasksDir, `${spec.name}.yaml`)
    const loadedNames = new Set([...this.specs.keys()])
    const fileExists = await exists(file)
    if (fileExists && !loadedNames.has(spec.name)) {
      throw new Error(`${file} already exists but is not a valid loaded task; repair or rename it instead of overwriting`)
    }
    const text = serializeTask(spec)
    await mkdir(this.config.tasksDir, { recursive: true, mode: 0o700 })
    const scratch = await mkdtemp(join(this.config.tasksDir, '.validate-'))
    try {
      const candidate = join(scratch, `${spec.name}.yaml`)
      await writeFileAtomic(candidate, text, { mode: 0o600, dirMode: 0o700 })
      const failure = await this.validatePython(candidate)
      if (failure !== null) throw new Error(failure)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
    await writeFileAtomic(file, text, { mode: 0o600, dirMode: 0o700 })
    await this.reloadNow()
    const loaded = this.specs.get(spec.name)
    if (loaded === undefined) throw new Error(`task ${spec.name} was written but did not reload; run desk_list for problems`)
    return this.viewOf(loaded.spec)
  }

  /**
   * Toggle one task's scheduling without touching its other fields.
   * @param name - task name.
   * @param enabled - next enabled state.
   * @returns the stored view.
   */
  async setEnabled(name: string, enabled: boolean): Promise<DeskTaskView> {
    await this.ensureFresh()
    const loaded = this.specs.get(name)
    if (loaded === undefined) throw new Error(`desk task not found: ${name}`)
    return this.write({ ...loaded.spec, enabled })
  }

  /**
   * Start one task now, regardless of its enabled state. The schedule is not
   * rewritten; a disabled task runs once and stays unarmed.
   * @param name - task name.
   * @returns the settled run outcome.
   */
  async runNow(name: string): Promise<DeskRunOutcome> {
    await this.ensureFresh()
    if (!this.specs.has(name)) throw new Error(`desk task not found: ${name}`)
    return this.ctx.automationRunner.runDeskTask(name, { kind: 'manual' })
  }

  /**
   * Cancel the active run of one task.
   * @param name - task name.
   * @returns whether a run was active.
   */
  cancel(name: string): boolean {
    return this.ctx.automationRunner.cancelDeskTask(name)
  }

  /**
   * Merged run records, newest first.
   * @param query - task, start time, status, and limit filters.
   * @returns the runs, plus whether the byte window cut older history.
   */
  async runs(query: DeskRunQuery = {}): Promise<DeskRunList> {
    await this.ensureFresh()
    const files = query.task === undefined
      ? await this.runFiles()
      : [join(this.config.runsDir, `${query.task}.jsonl`)]
    const problems: string[] = []
    const lines = []
    let truncated = false
    for (const file of files) {
      try {
        const read = await readRunLogFile(file, this.config.maxRunsReadBytes)
        lines.push(...read.lines)
        truncated ||= read.truncated
      } catch (error) {
        problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const merged = mergeRuns(lines, Math.max(this.config.maxRunRecords, query.limit ?? 0) * 4)
    const since = query.since === undefined ? null : Date.parse(query.since)
    const filtered = merged.filter(run =>
      (query.task === undefined || run.task === query.task)
      && (since === null || Number.isNaN(since) || Date.parse(run.startedAt) >= since)
      && (query.statuses === undefined || query.statuses.includes(run.status)))
    return { runs: filtered.slice(0, query.limit ?? this.config.maxRunRecords), truncated, problems }
  }

  /**
   * One run with its report sections and decision state.
   * @param task - task name.
   * @param runId - exact run id.
   * @returns the run detail.
   * @throws when the run is not in the read window.
   */
  async runDetail(task: string, runId: string): Promise<DeskRunDetail> {
    await this.ensureFresh()
    const file = join(this.config.runsDir, `${task}.jsonl`)
    const read = await readRunLogFile(file, this.config.maxRunsReadBytes)
    const run = mergeRuns(read.lines, 1_000_000).find(candidate => candidate.runId === runId)
    if (run === undefined) {
      throw new Error(read.truncated
        ? `run ${runId} is outside the retained read window of ${file}`
        : `run ${runId} was not found in ${file}`)
    }
    const report = run.report === null ? null : await this.readReport(run.report, run.inputs)
    const actions = await this.readDecisionActions()
    const decisions = decisionsOf(report, actions, task, runId)
    return { run, report, decisions }
  }

  /**
   * The two starter templates built from the current asset library.
   * @returns the templates; `available` is false when no usable asset exists.
   */
  async templates(): Promise<DeskTemplate[]> {
    const assets = await this.readLibrary()
    const refreshable = assets.filter(asset => asset.verbs.includes('update') || asset.verbs.includes('refresh'))
    const reportLike = assets.filter(asset => asset.kind === 'report' || asset.kind === 'chart')
    const dailyTargets = (reportLike.length > 0 ? reportLike : assets).slice(0, 3).map(asset => this.targetFor(asset))
    const intradayTargets = (refreshable.length > 0 ? refreshable : assets).slice(0, 5).map(asset => this.targetFor(asset))
    return [
      {
        id: 'morning-brief',
        name: '每日晨报',
        description: '工作日早上汇总库内最新报告与数据，出一份四段式晨报。',
        available: dailyTargets.length > 0,
        task: {
          name: 'morning-brief',
          displayName: '每日晨报',
          goal: '每个工作日早上汇总资产库最新报告与数据，指出值得关注的异动与到期命题。',
          enabled: true,
          targets: dailyTargets,
          triggers: [{ kind: 'cron', schedule: '0 8 * * 1-5' }],
          report: 'always',
          budget: { tokens: this.config.templateTokens, wallSeconds: this.config.templateWallSeconds },
          proposedBy: 'user',
        },
      },
      {
        id: 'intraday-watch',
        name: '盘中盯盘',
        description: '盘中按小时检查可刷新的资产，只在出现异动时出报告。',
        available: intradayTargets.length > 0,
        task: {
          name: 'intraday-watch',
          displayName: '盘中盯盘',
          goal: '盘中每小时检查可刷新资产的变化，有异动时解读，无异动时不出报告。',
          enabled: true,
          targets: intradayTargets,
          triggers: [{ kind: 'interval', everySeconds: 3600 }],
          report: 'changes',
          budget: { tokens: this.config.templateTokens, wallSeconds: 300 },
          proposedBy: 'user',
        },
      },
    ]
  }

  /**
   * Build the first message for a follow-up session from one report: the exact
   * report version, run id, and input asset versions, with missing sources
   * named rather than replaced by the latest version.
   * @param task - task name.
   * @param runId - exact run id.
   * @returns the seed text and the sources the library can no longer serve.
   */
  async reportBrief(task: string, runId: string): Promise<DeskReportBrief> {
    const detail = await this.runDetail(task, runId)
    const report = detail.report
    if (report === null || detail.run.report === null) throw new Error(`run ${runId} has no archived report`)
    const assets = await this.readLibrary()
    const byName = new Map(assets.map(asset => [asset.name, asset]))
    const lines = [
      `# 值班报告追问`,
      '',
      `报告资产：\`${report.asset}\` @v${String(report.version)}`,
      `报告目录：${report.dir}`,
      `报告正文：${join(report.dir, 'report.md')}`,
      `运行 id：\`${runId}\``,
      `任务：${task}`,
      '',
      '## 本次运行读取的输入资产版本',
      '',
    ]
    const missing: string[] = []
    if (!report.sourcesComplete) {
      lines.push('本报告是旧运行记录，未记录 AI 阶段读取的资产版本；下面只列出当时的信号输入版本，不猜测缺失来源。')
    }
    if (report.sources.length === 0) {
      lines.push('（本次运行没有读取到资产版本）')
    }
    for (const input of report.sources) {
      const asset = byName.get(input.asset)
      const versionDir = join(this.config.assetDir, input.asset, `v${String(input.version)}`)
      if (asset === undefined || !(await exists(versionDir))) {
        missing.push(`${input.asset}@v${String(input.version)}`)
        lines.push(`- 源版本不可用：\`${input.asset}\` @v${String(input.version)}（资产库已没有该资产或该版本）`)
        continue
      }
      lines.push(
        `- \`${input.asset}\` @v${String(input.version)}（${asset.kind}，verbs：${asset.verbs.join('、') || '无'}）目录：${versionDir}`,
      )
    }
    lines.push(
      '',
      '## 怎么接着做',
      '',
      '1. 先读报告正文，确认你要追问的是哪一条结论。',
      '2. 只使用上面列出的确切版本；缺少的源版本如实说明，不要用最新版本替换。',
      '3. 需要运行资产时用 `asset_run` 执行该版本的已声明 verb，不要从零重做。',
      '4. 修改资产前说明意图，修改后经归档落新版本并汇报前后对比。',
    )
    if (missing.length > 0) lines.push(`\n缺失的源版本：${missing.join('、')}`)
    return { seed: lines.join('\n'), missingSources: missing, sourcesComplete: report.sourcesComplete }
  }

  /**
   * Record one useful/useless/handled mark bound to a task, run, and report version.
   * @param input - task, run, kind, and optional note.
   * @returns the stored row.
   */
  async feedback(input: DeskFeedbackInput): Promise<DeskFeedbackRow> {
    const detail = await this.runDetail(input.task, input.runId)
    if (detail.run.report === null) throw new Error(`run ${input.runId} has no archived report to rate`)
    const kind = input.kind
    if (kind !== 'useful' && kind !== 'useless' && kind !== 'handled') {
      throw new Error(`feedback kind must be useful, useless, or handled: ${String(kind)}`)
    }
    const paths = feedbackPaths(this.config.deskDir)
    const id = await appendFeedback(paths, {
      task: input.task,
      runId: input.runId,
      reportAsset: detail.run.report.asset,
      reportVersion: detail.run.report.version,
      kind,
      ...input.note === undefined || input.note.trim() === '' ? {} : { note: input.note.trim() },
    })
    const rows = await readFeedbackRows(paths)
    const row = rows.find(candidate => candidate.id === id)
    /* v8 ignore next -- appendFeedback just appended the row this read returns */
    if (row === undefined) throw new Error(`feedback ${id} was written but could not be read back`)
    return row
  }

  /**
   * Every feedback mark with its active state, newest first.
   * @returns the rows.
   */
  async feedbackList(): Promise<DeskFeedbackRow[]> {
    return readFeedbackRows(feedbackPaths(this.config.deskDir))
  }

  /**
   * Revoke one feedback mark without deleting its history.
   * @param id - set row id.
   * @returns whether the mark existed.
   */
  async revokeFeedback(id: string): Promise<boolean> {
    return revokeFeedbackRow(feedbackPaths(this.config.deskDir), id)
  }

  /**
   * Reset the preference summary: earlier feedback stays visible but stops
   * shaping interpretation.
   * @returns the reset instant.
   */
  async resetPreferences(): Promise<string> {
    return resetFeedbackState(feedbackPaths(this.config.deskDir))
  }

  /**
   * Decide what the user did with one "待你决策" item.
   * @param input - task, run, decision id, and next state.
   * @returns the updated decision list for that run.
   */
  async setDecision(input: DecisionActionInput): Promise<readonly DeskDecisionView[]> {
    const detail = await this.runDetail(input.task, input.runId)
    if (!detail.decisions.some(decision => decision.id === input.decisionId)) {
      throw new Error(`decision ${input.decisionId} does not exist on run ${input.runId}`)
    }
    if (input.status !== 'open' && input.status !== 'handled') {
      throw new Error(`decision status must be open or handled: ${String(input.status)}`)
    }
    const action: DecisionAction = {
      ts: new Date().toISOString(),
      task: input.task,
      runId: input.runId,
      decisionId: input.decisionId,
      status: input.status,
    }
    await appendJsonl(this.config.decisionsFile, action)
    const actions = await this.readDecisionActions()
    return decisionsOf(detail.report, actions, input.task, input.runId)
  }

  /**
   * Adopt one report conclusion as a tracked thesis.
   * @param input - complete thesis fields.
   * @returns the stored thesis record.
   */
  async adoptThesis(input: AdoptThesisInput): Promise<{ id: string; dueDate: string; status: string }> {
    if (!KEBAB.test(input.id)) throw new Error(`thesis id must be kebab-case: ${input.id}`)
    if (!DATE.test(input.dueDate)) throw new Error(`due date must be YYYY-MM-DD: ${input.dueDate}`)
    const record = await this.ctx.thesis.write({
      id: input.id,
      conclusion: input.conclusion,
      metric: input.metric,
      threshold: input.threshold,
      dueDate: input.dueDate,
      report: input.report,
      assets: input.assets ?? [],
    })
    return { id: record.id, dueDate: record.dueDate, status: record.status }
  }

  /**
   * The value-desk scorecard over one window.
   * @param windowDays - window length in days; defaults to the preference window.
   * @returns each metric with its window, denominator, and sample count.
   */
  async scorecard(windowDays: number = this.config.preferenceWindowDays): Promise<DeskScorecard> {
    if (!Number.isSafeInteger(windowDays) || windowDays < 1) {
      throw new Error(`windowDays must be a positive integer: ${String(windowDays)}`)
    }
    const problems: string[] = []
    const to = new Date()
    const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000)
    const fromIso = from.toISOString()
    const theses = await this.ctx.thesis.list()
    let hits = 0
    let misses = 0
    for (const thesis of theses) {
      for (const check of thesis.checks) {
        if (check.checkedAt < fromIso) continue
        if (check.outcome === 'hit') hits += 1
        else misses += 1
      }
    }
    const rows = (await this.feedbackList()).filter(row => row.active && row.ts >= fromIso)
    const useful = rows.filter(row => row.kind === 'useful').length
    const useless = rows.filter(row => row.kind === 'useless').length
    const handled = rows.filter(row => row.kind === 'handled').length
    const assets = await this.readLibrary()
    let touched = 0
    let usageRows = 0
    try {
      const usage = await readRunLogFile(join(this.config.assetDir, 'usage.jsonl'), this.config.maxRunsReadBytes)
      const names = new Set<string>()
      for (const line of usage.lines) {
        const record = line.value
        if (typeof record.ts !== 'string' || record.ts < fromIso) continue
        if (record.tool !== 'asset_run' && record.tool !== 'asset_run_bg'
          && record.tool !== 'asset_show' && record.tool !== 'asset_search') continue
        usageRows += 1
        if (typeof record.asset === 'string') names.add(record.asset)
      }
      touched = names.size
    } catch (error) {
      problems.push(`usage.jsonl: ${error instanceof Error ? error.message : String(error)}`)
    }
    return {
      window: { days: windowDays, from: fromIso, to: to.toISOString() },
      theses: { hits, misses, numerator: hits, denominator: hits + misses, rate: rateOf(hits, hits + misses), samples: hits + misses },
      reports: {
        useful,
        useless,
        handled,
        numerator: useful,
        denominator: useful + useless,
        rate: rateOf(useful, useful + useless),
        samples: useful + useless,
      },
      assets: {
        libraryAssets: assets.length,
        touched,
        numerator: touched,
        denominator: assets.length,
        rate: rateOf(touched, assets.length),
        samples: usageRows,
      },
      problems,
    }
  }

  /** Compute and format the deterministic feedback summary for one task. */
  private async preferencesText(task: string): Promise<string> {
    const paths = feedbackPaths(this.config.deskDir)
    const resetAt = await readResetAt(paths)
    const from = new Date(Date.now() - this.config.preferenceWindowDays * 24 * 60 * 60 * 1000).toISOString()
    const rows = (await readFeedbackRows(paths)).filter(row =>
      row.active
      && row.ts >= from
      && (resetAt === null || row.ts > resetAt)
      && row.task === task)
    if (rows.length === 0) {
      return `暂无反馈（任务 ${task}，近 ${String(this.config.preferenceWindowDays)} 天）。按原始信号解读，不做偏好加权。`
    }
    const runsByTask = await this.runs({ task, limit: this.config.maxRunRecords })
    const runById = new Map(runsByTask.runs.map(run => [run.runId, run]))
    const uselessBySource = new Map<string, number>()
    const usefulBySource = new Map<string, number>()
    const uselessTheses = new Map<string, number>()
    let useful = 0
    let useless = 0
    let handled = 0
    for (const row of rows) {
      if (row.kind === 'useful') useful += 1
      else if (row.kind === 'useless') useless += 1
      else handled += 1
      const run = runById.get(row.runId)
      if (run === undefined || row.kind === 'handled') continue
      const bucket = row.kind === 'useful' ? usefulBySource : uselessBySource
      for (const input of run.inputs) bucket.set(input.asset, (bucket.get(input.asset) ?? 0) + 1)
      if (row.kind === 'useless') {
        for (const signal of run.signals) {
          if (signal.kind !== 'thesis') continue
          uselessTheses.set(signal.ref, (uselessTheses.get(signal.ref) ?? 0) + 1)
        }
      }
    }
    const listSuppressed = [...uselessBySource.entries()]
      .filter(([, count]) => count >= this.config.preferenceSuppressionMin)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, count]) => `${name}（${String(count)} 次无用）`)
    const listRaised = [...usefulBySource.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, count]) => `${name}（${String(count)} 次有用）`)
    const listTheses = [...uselessTheses.entries()]
      .filter(([, count]) => count >= this.config.preferenceSuppressionMin)
      .map(([id, count]) => `${id}（${String(count)} 次无用）`)
    return [
      `值班反馈汇总（任务 ${task}，近 ${String(this.config.preferenceWindowDays)} 天，${String(rows.length)} 条有效标记）：`,
      `- 有用 ${String(useful)}；无用 ${String(useless)}；已处理 ${String(handled)}（已处理只代表工作状态，不计入有用率）。`,
      listRaised.length === 0 ? '- 没有来源被标记为有用。' : `- 提高解读重点：${listRaised.join('、')}。`,
      listSuppressed.length === 0
        ? `- 没有来源达到降低优先级的阈值（无用 ≥ ${String(this.config.preferenceSuppressionMin)} 次）。`
        : `- 降低解读重点：${listSuppressed.join('、')}。`,
      listTheses.length === 0 ? '- 没有命题被重复标记为无用。' : `- 命题复检时优先核对：${listTheses.join('、')}。`,
      '- 这些统计只影响解读重点，不修改任务目标；被降低优先级的原始信号和报告仍然保留在运行记录里。',
    ].join('\n')
  }

  /** Reload from disk when the task directory changed since the last read. */
  private async ensureFresh(): Promise<void> {
    await this.ready
    const signature = await this.directorySignature()
    if (signature !== this.signature) await this.reloadNow()
  }

  /** Serialize task reloads so two writes cannot interleave registration. */
  private reloadNow(): Promise<void> {
    const run = this.reloadChain.then(() => this.doReload())
    this.reloadChain = run.catch(() => undefined)
    return run
  }

  /** Read every task file, validate it, and register the valid set with the runner. */
  private async doReload(): Promise<void> {
    const problems: string[] = []
    const specs: LoadedSpec[] = []
    let names: string[] = []
    try {
      names = (await readdir(this.config.tasksDir)).filter(name => name.endsWith('.yaml')).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        problems.push(`${this.config.tasksDir}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const seen = new Set<string>()
    for (const filename of names) {
      const path = join(this.config.tasksDir, filename)
      try {
        const failure = await this.validatePython(path)
        if (failure !== null) {
          problems.push(`${path}: ${failure}`)
          continue
        }
        const spec = parseTaskYaml(await readFile(path, 'utf-8'), path)
        if (seen.has(spec.name)) {
          problems.push(`${path}: duplicate task name ${spec.name}`)
          continue
        }
        seen.add(spec.name)
        specs.push({ spec, path })
      } catch (error) {
        problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const pipelineNames = new Set(
      this.ctx.automationRunner.list().filter(task => task.kind === 'pipeline').map(task => task.name),
    )
    const usable: LoadedSpec[] = []
    for (const loaded of specs) {
      if (pipelineNames.has(loaded.spec.name)) {
        problems.push(`${loaded.path}: task name collides with a pipeline: ${loaded.spec.name}`)
        continue
      }
      usable.push(loaded)
    }
    try {
      this.ctx.automationRunner.setDeskTasks(usable.map(loaded => this.registrationOf(loaded)))
    } catch (error) {
      problems.push(`desk scheduling: ${error instanceof Error ? error.message : String(error)}`)
      this.ctx.automationRunner.setDeskTasks([])
    }
    this.specs = new Map(usable.map(loaded => [loaded.spec.name, loaded]))
    this.problems = problems
    this.signature = await this.directorySignature()
    await this.syncWebhookRules()
  }

  /** The runner registration for one validated task. */
  private registrationOf(loaded: LoadedSpec): DeskTaskRegistration {
    const spec = loaded.spec
    return {
      name: spec.name,
      path: loaded.path,
      displayName: spec.displayName,
      goal: spec.goal,
      report: spec.report,
      triggers: spec.triggers,
      wallMs: spec.budget.wallSeconds * 1000,
      tokens: spec.budget.tokens,
      maxOutputTokens: spec.budget.maxOutputTokens ?? null,
      enabled: spec.enabled,
      preferences: () => this.preferencesText(spec.name),
    }
  }

  /** The runtime view of one spec. */
  private viewOf(spec: DeskTaskSpec): DeskTaskView {
    const snapshot = this.ctx.automationRunner.list().find(task => task.kind === 'desk' && task.name === spec.name)
    return {
      name: spec.name,
      displayName: spec.displayName,
      goal: spec.goal,
      enabled: spec.enabled,
      report: spec.report,
      targets: spec.targets,
      triggers: spec.triggers,
      budget: spec.budget,
      path: join(this.config.tasksDir, `${spec.name}.yaml`),
      nextRunAt: snapshot?.nextRunAt ?? null,
      running: this.ctx.automationRunner.isDeskRunning(spec.name),
      last: snapshot?.last ?? null,
    }
  }

  /** A cheap directory signature: changed names, sizes, or mtimes trigger a reload. */
  private async directorySignature(): Promise<string> {
    let entries: string[]
    try {
      entries = await readdir(this.config.tasksDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
    const parts: string[] = []
    for (const name of entries.filter(candidate => candidate.endsWith('.yaml')).sort()) {
      try {
        const info = await stat(join(this.config.tasksDir, name))
        parts.push(`${name}:${String(info.size)}:${String(info.mtimeMs)}`)
      } catch {
        parts.push(`${name}:missing`)
      }
    }
    return parts.join('|')
  }

  /** Run the Python validator on one task file; null means accepted. */
  private async validatePython(path: string): Promise<string | null> {
    try {
      const run = await this.python(['-m', 'findeck.desk', 'validate', path])
      if (run.exitCode === 0) return null
      return run.stderr.trim() || run.stdout.trim() || `validator exited with code ${String(run.exitCode)}`
    } catch (error) {
      return `validator unavailable: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  /** Spawn the finance Python interpreter with the desk's environment. */
  private python(argv: readonly string[]): Promise<PythonRun> {
    const handle = this.ctx.subprocess.spawn({
      argv: [this.config.pythonPath, ...argv],
      cwd: this.config.repoRoot,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 256 * 1024 },
        stderr: { maxBytes: 256 * 1024 },
      },
      graceMs: 15_000,
      env: {
        FINDECK_HOME: dshHomePath(),
        FINDECK_DESK_DIR: this.config.deskDir,
        FINDECK_ASSET_DIR: this.config.assetDir,
        PYTHONIOENCODING: 'utf-8',
      },
    })
    return handle.done.then(outcome => ({
      exitCode: outcome.exitCode,
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
      stderr: handle.collected.stderr?.readFrom(0).text ?? '',
    }))
  }

  /** Defend the serialize path against shapes the Python validator would reject. */
  private assertSpecShape(spec: DeskTaskSpec): void {
    if (typeof spec.name !== 'string' || !KEBAB.test(spec.name)) throw new Error(`task name must be kebab-case: ${String(spec.name)}`)
    if (typeof spec.displayName !== 'string' || spec.displayName.trim() === '') throw new Error('displayName must be a non-empty string')
    if (typeof spec.goal !== 'string' || spec.goal.trim() === '') throw new Error('goal must be a non-empty string')
    if (typeof spec.enabled !== 'boolean') throw new Error('enabled must be a boolean')
    if (!Array.isArray(spec.targets) || spec.targets.length === 0) throw new Error('targets must be a non-empty list')
    if (!Array.isArray(spec.triggers) || spec.triggers.length === 0) throw new Error('triggers must be a non-empty list')
    if (spec.report !== 'always' && spec.report !== 'changes') throw new Error('report must be always or changes')
    if (spec.proposedBy !== 'user') throw new Error('proposedBy must be user')
    if (typeof spec.budget !== 'object' || spec.budget === null) throw new Error('budget must be an object')
    if (!Number.isSafeInteger(spec.budget.tokens) || spec.budget.tokens < 1) throw new Error('budget.tokens must be a positive integer')
    if (!Number.isSafeInteger(spec.budget.wallSeconds) || spec.budget.wallSeconds < 1) {
      throw new Error('budget.wallSeconds must be a positive integer')
    }
  }

  /** Read the run log files currently present, for a library-wide run query. */
  private async runFiles(): Promise<string[]> {
    try {
      return (await readdir(this.config.runsDir))
        .filter(name => name.endsWith('.jsonl'))
        .sort()
        .map(name => join(this.config.runsDir, name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  /** Read one report's stored sections and markdown. */
  private async readReport(
    report: { asset: string; version: number; dir: string; tags: readonly string[]; fallback: boolean },
    sources: DeskRun['inputs'],
  ): Promise<DeskReportDetail> {
    let title: string | null = null
    let sections: DeskReportSections | null = null
    let markdown: string | null = null
    let storedSources: DeskReportDetail['sources'] = sources
    let sourcesComplete = false
    try {
      const raw = await readFile(join(report.dir, 'report.json'), 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.title === 'string') title = parsed.title
      if (Array.isArray(parsed.sources)) {
        storedSources = parsed.sources.flatMap(entry => {
          if (typeof entry !== 'object' || entry === null) return []
          const row = entry as Record<string, unknown>
          return typeof row.asset === 'string' && typeof row.version === 'number'
            ? [{ asset: row.asset, version: row.version, ...typeof row.kind === 'string' ? { kind: row.kind } : {} }]
            : []
        })
      }
      sourcesComplete = parsed.sourcesComplete === true
      const stored = parsed.sections
      if (typeof stored === 'object' && stored !== null) {
        const record = stored as Record<string, unknown>
        if (Array.isArray(record.points) && record.points.every(point => typeof point === 'string')
          && typeof record.moves === 'string' && typeof record.theses === 'string') {
          sections = {
            points: record.points as string[],
            moves: record.moves,
            theses: record.theses,
            decisions: Array.isArray(record.decisions)
              ? record.decisions.flatMap(item => {
                if (typeof item !== 'object' || item === null) return []
                const entry = item as Record<string, unknown>
                return typeof entry.kind === 'string' && typeof entry.text === 'string'
                  ? [{ kind: entry.kind, text: entry.text }]
                  : []
              })
              : [],
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A report whose structured file is unreadable still has its markdown;
        // the page shows the problem through a null section set.
      }
    }
    try {
      const info = await stat(join(report.dir, 'report.md'))
      if (info.size <= MAX_REPORT_BYTES) markdown = await readFile(join(report.dir, 'report.md'), 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return {
      asset: report.asset,
      version: report.version,
      dir: report.dir,
      tags: report.tags,
      fallback: report.fallback,
      title,
      sections,
      markdown,
      sources: storedSources,
      sourcesComplete,
    }
  }

  /** Read every decision action. */
  private async readDecisionActions(): Promise<DecisionAction[]> {
    const read = await readRunLogFile(this.config.decisionsFile, 1024 * 1024)
    return read.lines.flatMap(line => {
      const record = line.value
      return typeof record.ts === 'string' && typeof record.task === 'string'
        && typeof record.runId === 'string' && typeof record.decisionId === 'string'
        && (record.status === 'open' || record.status === 'handled')
        ? [{ ts: record.ts, task: record.task, runId: record.runId, decisionId: record.decisionId, status: record.status }]
        : []
    })
  }

  /** Read the library index into the fields templates and briefs use. */
  private async readLibrary(): Promise<LibraryAsset[]> {
    let raw: string
    try {
      raw = await readFile(join(this.config.assetDir, 'index.json'), 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    try {
      const parsed = JSON.parse(raw) as { assets?: unknown }
      if (!Array.isArray(parsed.assets)) return []
      return parsed.assets.flatMap((entry): LibraryAsset[] => {
        if (typeof entry !== 'object' || entry === null) return []
        const record = entry as Record<string, unknown>
        if (typeof record.name !== 'string' || typeof record.kind !== 'string'
          || typeof record.latest_version !== 'number') return []
        const freshness = typeof record.freshness === 'object' && record.freshness !== null
          ? (record.freshness as Record<string, unknown>).as_of
          : undefined
        return [{
          name: record.name,
          kind: record.kind,
          latest_version: record.latest_version,
          verbs: Array.isArray(record.verbs) ? record.verbs.filter((verb): verb is string => typeof verb === 'string') : [],
          freshnessAsOf: typeof freshness === 'string' ? freshness : null,
        }]
      })
    } catch {
      throw new Error(`${join(this.config.assetDir, 'index.json')}: index is not valid JSON`)
    }
  }

  /** One template target for an asset; refreshable assets carry a verb refresh. */
  private targetFor(asset: LibraryAsset): DeskTarget {
    const verb = asset.verbs.includes('update') ? 'update' : asset.verbs.includes('refresh') ? 'refresh' : null
    return {
      kind: 'asset',
      ref: asset.name,
      ...verb === null ? {} : { refresh: { kind: 'verb', asset: asset.name, verb } },
    }
  }

  /** Register the model-facing management tools. */
  private registerTools(): void {
    const desk = this
    this.ctx.tools.register(defineTool({
      name: 'desk_list',
      description:
        'List the value-desk tasks: name, display name, enabled state, trigger, next fire, last run status, and '
        + 'any invalid task file. A desk task is a saved watch that runs unattended on a schedule or event and '
        + 'writes a four-section report asset. Use desk_show for one task in full and desk_write to create or edit one.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tasks: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  display_name: { type: 'string', required: true },
                  enabled: { type: 'boolean', required: true },
                  report: { type: 'string', required: true },
                  triggers: { type: 'array', required: true, items: { type: 'string' } },
                  next_run_at: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                  running: { type: 'boolean', required: true },
                  last_status: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                  last_ts: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                },
              },
            },
            problems: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: [
            ...value.tasks.map(task =>
              `- \`${task.name}\` (${task.display_name}): ${task.enabled ? 'enabled' : 'disabled'}, `
              + `report=${task.report}, triggers=${task.triggers.join(', ') || 'none'}, `
              + `next=${task.next_run_at ?? 'n/a'}, ${task.running ? 'RUNNING' : `last=${task.last_status ?? 'none'}${task.last_ts === null ? '' : ` at ${task.last_ts}`}`}`),
            ...value.problems.length === 0 ? [] : ['', 'Problems:', ...value.problems.map(problem => `- ${problem}`)],
          ].join('\n') || 'No desk tasks are defined.',
        }],
      },
      async execute() {
        const result = await desk.list()
        return {
          tasks: result.tasks.map(task => ({
            name: task.name,
            display_name: task.displayName,
            enabled: task.enabled,
            report: task.report,
            triggers: task.triggers.map(triggerText),
            next_run_at: task.nextRunAt,
            running: task.running,
            last_status: task.last?.status ?? null,
            last_ts: task.last?.ts ?? null,
          })),
          problems: [...result.problems],
        }
      },
      presentCall: () => ({ card: 'generic', title: 'List desk tasks', kind: 'read', rawInput: '' }),
    }))

    this.ctx.tools.register(defineTool({
      name: 'desk_show',
      description:
        'Show one value-desk task in full: its goal, targets, triggers, report mode, budget, enabled state, and '
        + 'its five most recent runs. Use it before editing a task so desk_write replaces the complete definition '
        + 'rather than dropping fields you did not mention.',
      parameters: {
        name: { type: 'string', required: true, description: 'Task name from desk_list.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            task: { type: 'string', required: true },
            runs: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  run_id: { type: 'string', required: true },
                  status: { type: 'string', required: true },
                  started_at: { type: 'string', required: true },
                  report: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                  stop_reason: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                },
              },
            },
            problems: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: [
            JSON.stringify(value.task, null, 2),
            '',
            ...value.runs.map(run =>
              `- ${run.started_at} ${run.status} (${run.run_id})${run.report === null ? '' : ` report ${run.report}`}${run.stop_reason === null ? '' : ` stop=${run.stop_reason}`}`),
            ...value.problems.length === 0 ? [] : ['', 'Problems:', ...value.problems.map(problem => `- ${problem}`)],
          ].join('\n'),
        }],
      },
      async execute(args) {
        const detail = await desk.show(args.name)
        const listed = await desk.list()
        return {
          task: JSON.stringify({
            name: detail.spec.name,
            display_name: detail.spec.displayName,
            goal: detail.spec.goal,
            enabled: detail.spec.enabled,
            report: detail.spec.report,
            targets: detail.spec.targets.map(target => ({
              kind: target.kind,
              ref: target.ref,
              ...target.refresh === undefined
                ? {}
                : target.refresh.kind === 'verb'
                  ? { refresh: { kind: 'verb', asset: target.refresh.asset, verb: target.refresh.verb } }
                  : { refresh: { kind: 'pipeline', name: target.refresh.name } },
            })),
            triggers: detail.spec.triggers.map(trigger => ({ ...trigger })),
            budget: { ...detail.spec.budget },
            proposed_by: detail.spec.proposedBy,
          }, null, 2),
          runs: detail.recent.map(run => ({
            run_id: run.runId,
            status: run.status,
            started_at: run.startedAt,
            report: run.report === null ? null : `${run.report.asset}@v${String(run.report.version)}`,
            stop_reason: run.stopReason,
          })),
          problems: [...listed.problems],
        }
      },
      presentCall: args => ({ card: 'generic', title: `Show desk task ${args.name}`, kind: 'read', rawInput: args.name }),
    }))

    this.ctx.tools.register(defineTool({
      name: 'desk_write',
      description:
        'Create or replace one value-desk task and update its schedule immediately. The complete definition is '
        + 'replaced: pass every field. Targets: {kind: symbol|theme|thesis|asset|workbench, ref, refresh?}; '
        + 'refresh is {kind: verb, asset, verb} or {kind: pipeline, name}. Triggers: {kind: cron, schedule} | '
        + '{kind: interval, everySeconds} | {kind: event, name} | {kind: thesis-due}. report is always or changes. '
        + 'budget.tokens is the cumulative run budget, budget.wallSeconds the wall-clock cap, and the optional '
        + 'budget.maxOutputTokens caps one model request. The repository validator rejects unknown or invalid '
        + 'fields; a name that collides with a pipeline or an existing unrelated file is refused.',
      parameters: {
        name: { type: 'string', required: true, description: 'Kebab-case task name; must match the file name.' },
        display_name: { type: 'string', required: true, description: 'Human-facing name.' },
        goal: { type: 'string', required: true, description: 'What to watch and why, in natural language.' },
        enabled: { type: 'boolean', description: 'Whether the schedule is armed; omitted means true.' },
        targets: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              kind: { type: 'string', required: true },
              ref: { type: 'string', required: true },
              refresh: { type: 'object', additionalProperties: true },
            },
          },
          description: 'Non-empty watch list.',
        },
        triggers: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Non-empty trigger list; a task may combine several.',
        },
        report: { type: 'string', required: true, description: 'always or changes.' },
        budget: {
          type: 'object',
          additionalProperties: true,
          properties: {
            tokens: { type: 'number', required: true },
            wallSeconds: { type: 'number', required: true },
            maxOutputTokens: { type: 'number' },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            enabled: { type: 'boolean', required: true },
            path: { type: 'string', required: true },
            next_run_at: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            problems: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `desk task "${value.name}" saved (${value.enabled ? 'enabled' : 'disabled'}); next fire ${value.next_run_at ?? 'n/a'} → ${value.path}`,
        }],
      },
      async execute(args) {
        const spec: DeskTaskSpec = {
          name: args.name,
          displayName: args.display_name,
          goal: args.goal,
          enabled: args.enabled ?? true,
          targets: (args.targets ?? []) as unknown as DeskTarget[],
          triggers: (args.triggers ?? []) as unknown as DeskTrigger[],
          report: args.report === 'changes' ? 'changes' : 'always',
          budget: args.budget as DeskBudget,
          proposedBy: 'user',
        }
        const view = await desk.write(spec)
        return {
          name: view.name,
          enabled: view.enabled,
          path: view.path,
          next_run_at: view.nextRunAt,
          problems: [...(await desk.list()).problems],
        }
      },
      presentCall: args => ({ card: 'generic', title: `Write desk task ${args.name}`, kind: 'edit', rawInput: args.name }),
    }))
  }

  /** Synchronize webhook rules with the enabled event triggers. */
  private async syncWebhookRules(): Promise<void> {
    if (this.closing) return
    const runtime = this.webhookRuntime
    if (runtime === undefined) return
    const desired = new Set<string>()
    for (const { spec } of this.specs.values()) {
      if (!spec.enabled) continue
      for (const trigger of spec.triggers) {
        if (trigger.kind === 'event') desired.add(trigger.name)
      }
    }
    for (const [kind, dispose] of this.webhookRules) {
      if (desired.has(kind)) continue
      this.webhookRules.delete(kind)
      await dispose()
    }
    for (const kind of desired) {
      if (this.webhookRules.has(kind)) continue
      try {
        const dispose = runtime.register({
          id: WebhookRuleId(`desk-event-${kind}`),
          kind,
          run: (delivery: Readonly<VerifiedWebhookDelivery>) => {
            void this.handleWebhook(kind, delivery)
            return null
          },
        })
        this.webhookRules.set(kind, dispose)
      } catch (error) {
        this.problems.push(`webhook rule for ${kind}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** Dispatch one authenticated delivery to every enabled matching task. */
  private async handleWebhook(kind: string, delivery: VerifiedWebhookDelivery): Promise<void> {
    if (this.closing) return
    await this.ensureFresh().catch(() => undefined)
    const matches = [...this.specs.values()]
      .map(({ spec }) => spec)
      .filter(spec => spec.enabled && spec.triggers.some(trigger => trigger.kind === 'event' && trigger.name === kind))
    for (const spec of matches) {
      try {
        await this.ctx.automationRunner.runDeskTask(spec.name, {
          kind: 'event',
          name: kind,
          deliveryId: delivery.deliveryId,
          source: delivery.source,
        })
      } catch (error) {
        this.ctx.logger.warn(`desk webhook ${kind} → ${spec.name} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** Dispose every registered webhook rule. */
  private async disposeWebhookRules(): Promise<void> {
    const disposers = [...this.webhookRules.values()]
    this.webhookRules.clear()
    for (const dispose of disposers) await dispose()
  }

  /**
   * Trigger one run per task and due date, consuming a due date only after a
   * successful run. A started-but-unfinished attempt stays retryable, and a
   * failed attempt retries up to `thesisMaxAttempts`; only the task's own
   * thesis targets are relevant.
   */
  private async checkThesisDue(): Promise<void> {
    if (this.closing || this.thesisTickRunning) return
    this.thesisTickRunning = true
    try {
      await this.ensureFresh().catch(() => undefined)
      const tasks = [...this.specs.values()].map(({ spec }) => spec)
        .filter(spec => spec.enabled && spec.triggers.some(trigger => trigger.kind === 'thesis-due'))
      if (tasks.length === 0) return
      const due = await this.ctx.thesis.due()
      if (due.length === 0) return
      const ledger = await this.readDueLedger()
      for (const spec of tasks) {
        const refs = new Set(spec.targets.filter(target => target.kind === 'thesis').map(target => target.ref))
        if (refs.size === 0) continue
        const relevant = due.filter(thesis => refs.has(thesis.id))
        if (relevant.length === 0) continue
        // A running task is skipped without touching the ledger; the next tick
        // retries, so a long run never swallows a due date.
        if (this.ctx.automationRunner.isDeskRunning(spec.name)) continue
        const fresh = relevant.filter(thesis => {
          const state = ledger.get(dueKey(spec.name, thesis.id, thesis.dueDate))
          if (state === undefined) return true
          if (state.state === 'consumed') return false
          if (state.state === 'started') return true
          return state.attempts < this.config.thesisMaxAttempts
        })
        if (fresh.length === 0) continue
        const attempts = fresh.map(thesis => {
          const state = ledger.get(dueKey(spec.name, thesis.id, thesis.dueDate))
          return {
            thesis,
            attempt: (state?.attempts ?? 0) + 1,
          }
        })
        for (const item of attempts) {
          const row: DueLedgerRow = {
            ts: new Date().toISOString(),
            task: spec.name,
            thesis: item.thesis.id,
            dueDate: item.thesis.dueDate,
            state: 'started',
            attempt: item.attempt,
          }
          await appendJsonl(this.config.dueLedgerFile, row)
        }
        let runId: string | null = null
        let status: string = 'failed'
        try {
          const outcome = await this.ctx.automationRunner.runDeskTask(spec.name, {
            kind: 'thesis-due',
            theses: fresh.map(thesis => thesis.id),
          })
          runId = outcome.runId
          status = outcome.status
        } catch (error) {
          this.ctx.logger.warn(`desk thesis-due ? ${spec.name} failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        let success = status === 'ok'
        if (success) {
          // A completed model run is not proof of a recheck: verify that each
          // due thesis actually received a check at or after its due date.
          for (const item of fresh) {
            const record = await this.ctx.thesis.get(item.id).catch(() => undefined)
            const rechecked = record?.checks.some(check => check.checkedAt.slice(0, 10) >= item.dueDate) === true
            if (!rechecked) {
              success = false
              break
            }
          }
        }
        for (const item of attempts) {
          const row: DueLedgerRow = {
            ts: new Date().toISOString(),
            task: spec.name,
            thesis: item.thesis.id,
            dueDate: item.thesis.dueDate,
            state: success ? 'consumed' : 'failed',
            attempt: item.attempt,
            ...runId === null ? {} : { runId },
            status,
          }
          await appendJsonl(this.config.dueLedgerFile, row)
        }
        if (!success) {
          this.ctx.logger.warn(`desk thesis-due ? ${spec.name} did not finish (${status}); attempt ${attempts[0]?.attempt ?? 0}/${this.config.thesisMaxAttempts}`)
        }
      }
    } finally {
      this.thesisTickRunning = false
    }
  }

  /** Read the latest ledger state per due key. Legacy rows count as consumed. */
  private async readDueLedger(): Promise<Map<string, DueLedgerState>> {
    const read = await readRunLogFile(this.config.dueLedgerFile, 1024 * 1024)
    const ledger = new Map<string, DueLedgerState>()
    for (const line of read.lines) {
      const record = line.value
      if (typeof record.task !== 'string' || typeof record.thesis !== 'string' || typeof record.dueDate !== 'string') continue
      const key = dueKey(record.task, record.thesis, record.dueDate)
      const state = record.state === 'started' || record.state === 'failed' || record.state === 'consumed'
        ? record.state
        : 'consumed'
      const attempt = typeof record.attempt === 'number' && Number.isSafeInteger(record.attempt) && record.attempt > 0
        ? record.attempt
        : 1
      ledger.set(key, { state, attempts: attempt })
    }
    return ledger
  }

}

/** Shared due-key spelling. */
function dueKey(task: string, thesis: string, dueDate: string): string {
  return `${task}\u0000${thesis}\u0000${dueDate}`
}

/** Render one trigger for text output. */
function triggerText(trigger: DeskTrigger): string {
  switch (trigger.kind) {
    case 'cron': return `cron ${trigger.schedule}`
    case 'interval': return `every ${String(trigger.everySeconds)}s`
    case 'event': return `event ${trigger.name}`
    case 'thesis-due': return 'thesis-due'
  }
}

/** Merge one report's decisions with their recorded actions. */
function decisionsOf(
  report: DeskReportDetail | null,
  actions: readonly DecisionAction[],
  task: string,
  runId: string,
): DeskDecisionView[] {
  if (report?.sections === null || report?.sections === undefined) return []
  const latest = new Map<string, DecisionAction>()
  for (const action of actions) {
    if (action.task !== task || action.runId !== runId) continue
    latest.set(action.decisionId, action)
  }
  return report.sections.decisions.map((decision, index) => {
    const id = `d${String(index)}`
    const action = latest.get(id)
    return {
      id,
      kind: decision.kind,
      text: decision.text,
      status: action?.status ?? 'open',
      handledAt: action?.status === 'handled' ? action.ts : null,
    }
  })
}

/** `hits / total`, rounded to four decimals, or null with no samples. */
function rateOf(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4))
}

/** Append one JSON line, creating the parent directory. */
async function appendJsonl(file: string, value: object): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf-8')
}

/** Does the path exist? */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Read one JSONL file bounded from the tail, parsed line by line. */
async function readRunLogFile(
  file: string,
  maxBytes: number,
): Promise<{ lines: { value: Record<string, unknown> }[]; truncated: boolean }> {
  const read = await readRunLog(file, maxBytes)
  return { lines: read.lines.map(line => ({ value: line.value })), truncated: read.truncated }
}

/** Merge run log lines; the runner owns the line vocabulary. */
function mergeRuns(lines: readonly { value: Record<string, unknown> }[], limit: number): DeskRun[] {
  return mergeDeskRuns(
    lines.map(line => ({ value: line.value, raw: JSON.stringify(line.value) })),
    limit,
  )
}

export { DeskService }
