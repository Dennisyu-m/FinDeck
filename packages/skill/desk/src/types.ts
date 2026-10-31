/**
 * Desk task, run, feedback, and scorecard vocabulary.
 * @module @deepseek-ai/dsh-desk/types
 */

import type {
  DeskRun,
  DeskRunOutcome,
  DeskRunReport,
  DeskRunStatus,
  DeskRunTrigger,
  DeskSignalRecord,
  DeskSignalRow,
  DeskTaskRegistration,
  DeskTrigger,
} from '@deepseek-ai/dsh-automation-runner'

export type {
  DeskRun,
  DeskRunOutcome,
  DeskRunReport,
  DeskRunStatus,
  DeskRunTrigger,
  DeskSignalRecord,
  DeskSignalRow,
  DeskTaskRegistration,
  DeskTrigger,
}

/** How one target refreshes before the deterministic signal step. */
export type DeskRefresh =
  | { readonly kind: 'verb'; readonly asset: string; readonly verb: string }
  | { readonly kind: 'pipeline'; readonly name: string }

/** One object a desk task watches. */
export interface DeskTarget {
  readonly kind: 'symbol' | 'theme' | 'thesis' | 'asset' | 'workbench'
  readonly ref: string
  readonly refresh?: DeskRefresh
}

/** Budget fields of one task. */
export interface DeskBudget {
  /** Cumulative model usage for the whole run. */
  readonly tokens: number
  /** Wall-clock cap for the whole run. */
  readonly wallSeconds: number
  /** Per-request output cap; absent uses the runner's deployment default. */
  readonly maxOutputTokens?: number
}

/** One complete desk task definition. */
export interface DeskTaskSpec {
  readonly name: string
  readonly displayName: string
  readonly goal: string
  readonly enabled: boolean
  readonly targets: readonly DeskTarget[]
  readonly triggers: readonly DeskTrigger[]
  readonly report: 'always' | 'changes'
  readonly budget: DeskBudget
  readonly proposedBy: 'user'
}

/** One task plus its runtime state. */
export interface DeskTaskView {
  readonly name: string
  readonly displayName: string
  readonly goal: string
  readonly enabled: boolean
  readonly report: 'always' | 'changes'
  readonly targets: readonly DeskTarget[]
  readonly triggers: readonly DeskTrigger[]
  readonly budget: DeskBudget
  readonly path: string
  readonly nextRunAt: string | null
  readonly running: boolean
  readonly last: {
    readonly ts: string
    readonly status: string
    readonly exitCode: number | null
    readonly timedOut: boolean
  } | null
}

/** Result of one task-list read. */
export interface DeskListResult {
  readonly tasks: readonly DeskTaskView[]
  /** Per-file failures and composition gaps, shown instead of hiding them. */
  readonly problems: readonly string[]
}

/** One report section set as `findeck.desk` stored it. */
export interface DeskReportSections {
  readonly points: readonly string[]
  readonly moves: string
  readonly theses: string
  readonly decisions: readonly { readonly kind: string; readonly text: string }[]
}

/** One report asset plus the text a page or seed reads. */
export interface DeskReportDetail {
  readonly asset: string
  readonly version: number
  readonly dir: string
  readonly tags: readonly string[]
  readonly fallback: boolean
  readonly title: string | null
  readonly sections: DeskReportSections | null
  readonly markdown: string | null
  readonly sources: readonly { readonly asset: string; readonly version: number; readonly kind?: string }[]
  /** Whether the archive recorded AI-stage sources; false marks an older report. */
  readonly sourcesComplete: boolean
}

/** One decision row with its handled state. */
export interface DeskDecisionView {
  readonly id: string
  readonly kind: string
  readonly text: string
  readonly status: 'open' | 'handled'
  readonly handledAt: string | null
}

/** One run plus its decoded report and decisions. */
export interface DeskRunDetail {
  readonly run: DeskRun
  readonly report: DeskReportDetail | null
  readonly decisions: readonly DeskDecisionView[]
}

/** One run list query. */
export interface DeskRunQuery {
  /** Restrict to one task; omitted lists every task. */
  readonly task?: string
  /** Only runs whose startedAt is at or after this ISO instant. */
  readonly since?: string
  /** Restrict to these statuses; omitted lists every status. */
  readonly statuses?: readonly DeskRunStatus[]
  /** Maximum rows; defaults to the deployment read bound. */
  readonly limit?: number
}

/** Result of one run-list read. */
export interface DeskRunList {
  readonly runs: readonly DeskRun[];
  /** True when the byte window cut older history. */
  readonly truncated: boolean
  readonly problems: readonly string[]
}

/** One feedback mark as stored. */
export interface DeskFeedbackRow {
  readonly id: string
  readonly ts: string
  readonly task: string
  readonly runId: string
  readonly reportAsset: string
  readonly reportVersion: number
  readonly kind: 'useful' | 'useless' | 'handled'
  readonly note: string | null
  /** True when no revoke action superseded this row. */
  readonly active: boolean
  /** Set on a revoke action's target view; absent for set rows. */
  readonly revokedAt?: string | null
}

/** What a feedback write needs; the report binding comes from the run record. */
export interface DeskFeedbackInput {
  readonly task: string
  readonly runId: string
  readonly kind: 'useful' | 'useless' | 'handled'
  readonly note?: string
}

/** One template the page can prefill from the current library. */
export interface DeskTemplate {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly task: DeskTaskSpec
  /** False when the library holds no asset the template can target. */
  readonly available: boolean
}

/** One scorecard metric, always carrying its window, denominator, and sample count. */
export interface DeskScoreMetric {
  readonly numerator: number
  readonly denominator: number
  /** `null` while the denominator is zero. */
  readonly rate: number | null
  readonly samples: number
}

/** The value-desk scorecard over one window. */
export interface DeskScorecard {
  readonly window: { readonly days: number; readonly from: string; readonly to: string }
  readonly theses: DeskScoreMetric & { readonly hits: number; readonly misses: number }
  readonly reports: DeskScoreMetric & {
    readonly useful: number
    readonly useless: number
    readonly handled: number
  }
  readonly assets: DeskScoreMetric & {
    readonly libraryAssets: number
    readonly touched: number
  }
  readonly problems: readonly string[]
}

/** One adopted thesis request from the report page. */
export interface AdoptThesisInput {
  readonly id: string
  readonly conclusion: string
  readonly metric: string
  readonly threshold: string
  readonly dueDate: string
  readonly report: string
  readonly assets?: readonly string[]
}

/** One decision-action request. */
export interface DecisionActionInput {
  readonly task: string
  readonly runId: string
  readonly decisionId: string
  readonly status: 'open' | 'handled'
}

/** One run's brief for a follow-up session. */
export interface DeskReportBrief {
  readonly seed: string
  /** Source asset versions the library can no longer serve. */
  readonly missingSources: readonly string[]
  /** Whether the report recorded both signal-stage and AI-stage sources. */
  readonly sourcesComplete: boolean
}

/** Plugin configuration. */
export interface Config {
  /** Task directory; defaults to `<harness home>/desk/tasks`. */
  readonly tasksDir?: string
  /** Desk data root (runs, feedback, ledgers); defaults to `<harness home>/desk`. */
  readonly deskDir?: string
  /** Asset library root; defaults to `<harness home>/asset-library`. */
  readonly assetDir?: string
  /** Finance venv interpreter. */
  readonly pythonPath?: string
  /** Repository root used as the Python working directory. */
  readonly repoRoot?: string
  /** Byte window for one run-log read. */
  readonly maxRunsReadBytes?: number
  /** Maximum merged runs one query returns. */
  readonly maxRunRecords?: number
  /** Days of feedback that shape the preference summary. */
  readonly preferenceWindowDays?: number
  /** Minimum useless marks before a source is listed as de-prioritised. */
  readonly preferenceSuppressionMin?: number
  /** Recheck interval for thesis-due triggers, in seconds. */
  readonly thesisCheckSeconds?: number
  /** Attempts per due thesis before an errored run stops retrying; defaults to 3. */
  readonly thesisMaxAttempts?: number
  /** Default cumulative token budget a template proposes. */
  readonly templateTokens?: number
  /** Default wall-clock seconds a template proposes. */
  readonly templateWallSeconds?: number
}
