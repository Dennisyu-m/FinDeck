# 值班

[English](desk.md) | 中文

无人值守的值班层跑在 `dsh web` 里。[`dsh-automation-runner`](../../packages/skill/automation-runner/README.zh.md) 用一个计时器调度流水线和值班任务。[`dsh-desk`](../../packages/skill/desk/README.md) 是任务文件、运行记录、反馈和成绩单的唯一写入方。[`dsh-thesis`](../../packages/skill/thesis-registry/README.md) 保存值班运行要复检的命题。任务字段、运行状态、取消和报告记录以这些包的 README 为准。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomationrunner--automationrunner"></a>

### `ctx.automationRunner` — `AutomationRunner`

Schedules pipeline yaml files and registered desk tasks and runs them with the finance venv and the desk profile.

```ts cordis-catalog
/**
 * Every loaded task, with its next fire and the latest run line. The
 * scheduled-tasks page filters to `kind: 'pipeline'`; the desk page uses the
 * `desk` rows.
 * @returns a snapshot copied from the current timer state.
 */
list(): AutomationTaskSnapshot[]

/**
 * Run one pipeline now. A task that is already running is recorded as `skipped` and does not start a second process.
 * @param name - pipeline name, matching the yaml filename.
 * @returns the outcome. `timedOut` is independent of `exitCode`.
 */
runNow(name: string): Promise<AutomationRunResult>

/**
 * Replace the registered desk tasks. The desk service calls this on load,
 * after a task write or enable toggle, and with an empty list on unload.
 * A removed or renamed task's in-flight run is cancelled; editing a task
 * keeps its current run, which continues on the snapshot taken at start.
 * @param tasks - the complete desk task set.
 */
setDeskTasks(tasks: readonly DeskTaskRegistration[]): void

/**
 * Whether one desk task currently has a run in flight.
 * @param name - desk task name.
 * @returns true while a run has not settled.
 */
isDeskRunning(name: string): boolean

/**
 * Cancel the active run of one desk task.
 * @param name - desk task name.
 * @returns whether a run was active. The run records `cancelled` when it settles.
 */
cancelDeskTask(name: string): boolean

/**
 * Run one registered desk task now or from an external trigger.
 * @param name - desk task name.
 * @param trigger - run origin; defaults to `manual`.
 * @returns the settled run outcome.
 */
async runDeskTask(name: string, trigger: DeskRunTrigger = { kind: 'manual' }): Promise<DeskRunOutcome>

/**
 * Replace the registered pipeline set. The pipeline-scheduler plugin owns
 * loading `finance/pipelines/*.yaml`; this method only schedules what it is
 * given, so unloading that plugin stops pipelines and leaves desk tasks
 * armed (and vice versa).
 * @param files - parsed pipeline definitions; their names must not collide
 * with a registered desk task.
 */
setPipelineTasks(files: readonly PipelineFile[]): void
```

Source: [`packages/skill/automation-runner/src/index.ts`](../../packages/skill/automation-runner/src/index.ts)

<a id="ctxdesk--deskservice"></a>

### `ctx.desk` — `DeskService`

The desk host service. All public methods wait for the initial task load, so a page opened immediately after the switch flips sees a settled state.

```ts cordis-catalog
/**
 * Every task file plus the current runtime state.
 * @returns the task views and per-file problems.
 */
async list(): Promise<DeskListResult>

/**
 * One task's complete definition.
 * @param name - task name.
 * @returns the spec and its view.
 * @throws when the task does not exist.
 */
async show(name: string): Promise<{ spec: DeskTaskSpec; view: DeskTaskView; recent: readonly DeskRun[] }>

/**
 * Create or replace one task file after the Python validator accepts it.
 * @param spec - complete definition.
 * @returns the stored view.
 * @throws when the definition is invalid, the name collides with a pipeline
 * or an unrelated file, or the atomic write fails.
 */
async write(spec: DeskTaskSpec): Promise<DeskTaskView>

/**
 * Toggle one task's scheduling without touching its other fields.
 * @param name - task name.
 * @param enabled - next enabled state.
 * @returns the stored view.
 */
async setEnabled(name: string, enabled: boolean): Promise<DeskTaskView>

/**
 * Start one task now, regardless of its enabled state. The schedule is not
 * rewritten; a disabled task runs once and stays unarmed.
 * @param name - task name.
 * @returns the settled run outcome.
 */
async runNow(name: string): Promise<DeskRunOutcome>

/**
 * Cancel the active run of one task.
 * @param name - task name.
 * @returns whether a run was active.
 */
cancel(name: string): boolean

/**
 * Merged run records, newest first.
 * @param query - task, start time, status, and limit filters.
 * @returns the runs, plus whether the byte window cut older history.
 */
async runs(query: DeskRunQuery = {}): Promise<DeskRunList>

/**
 * One run with its report sections and decision state.
 * @param task - task name.
 * @param runId - exact run id.
 * @returns the run detail.
 * @throws when the run is not in the read window.
 */
async runDetail(task: string, runId: string): Promise<DeskRunDetail>

/**
 * The two starter templates built from the current asset library.
 * @returns the templates; `available` is false when no usable asset exists.
 */
async templates(): Promise<DeskTemplate[]>

/**
 * Build the first message for a follow-up session from one report: the exact
 * report version, run id, and input asset versions, with missing sources
 * named rather than replaced by the latest version.
 * @param task - task name.
 * @param runId - exact run id.
 * @returns the seed text and the sources the library can no longer serve.
 */
async reportBrief(task: string, runId: string): Promise<DeskReportBrief>

/**
 * Record one useful/useless/handled mark bound to a task, run, and report version.
 * @param input - task, run, kind, and optional note.
 * @returns the stored row.
 */
async feedback(input: DeskFeedbackInput): Promise<DeskFeedbackRow>

/**
 * Every feedback mark with its active state, newest first.
 * @returns the rows.
 */
async feedbackList(): Promise<DeskFeedbackRow[]>

/**
 * Revoke one feedback mark without deleting its history.
 * @param id - set row id.
 * @returns whether the mark existed.
 */
async revokeFeedback(id: string): Promise<boolean>

/**
 * Reset the preference summary: earlier feedback stays visible but stops
 * shaping interpretation.
 * @returns the reset instant.
 */
async resetPreferences(): Promise<string>

/**
 * Decide what the user did with one "待你决策" item.
 * @param input - task, run, decision id, and next state.
 * @returns the updated decision list for that run.
 */
async setDecision(input: DecisionActionInput): Promise<readonly DeskDecisionView[]>

/**
 * Adopt one report conclusion as a tracked thesis.
 * @param input - complete thesis fields.
 * @returns the stored thesis record.
 */
async adoptThesis(input: AdoptThesisInput): Promise<{ id: string; dueDate: string; status: string }>

/**
 * The value-desk scorecard over one window.
 * @param windowDays - window length in days; defaults to the preference window.
 * @returns each metric with its window, denominator, and sample count.
 */
async scorecard(windowDays: number = this.config.preferenceWindowDays): Promise<DeskScorecard>
```

Source: [`packages/skill/desk/src/index.ts`](../../packages/skill/desk/src/index.ts)

<a id="ctxthesis--thesisregistry"></a>

### `ctx.thesis` — `ThesisRegistry`

Durable thesis registry. Reads parse strictly; one unreadable manifest fails the whole listing rather than disappearing from the score.

```ts cordis-catalog
/**
 * Every thesis, sorted by due date then id.
 * @returns the records with derived status and overdue flags.
 */
async list(): Promise<ThesisRecord[]>

/**
 * One thesis by id.
 * @param id - thesis id.
 * @returns the record, or `undefined` when the registry has no such file.
 */
async get(id: string): Promise<ThesisRecord | undefined>

/**
 * Upsert one thesis. Re-writing an id updates the stated fields and keeps its check history.
 * @param input - the complete stated fields.
 * @returns the stored record.
 */
async write(input: ThesisWriteInput): Promise<ThesisRecord>

/**
 * Append one recheck outcome.
 * @param id - stored thesis id.
 * @param outcome - whether the metric met its threshold.
 * @param evidence - what the recheck actually measured.
 * @returns the updated record.
 * @throws when the thesis does not exist or the evidence is empty.
 */
async mark(id: string, outcome: 'hit' | 'miss', evidence: string): Promise<ThesisRecord>

/**
 * Registry-wide score over every check.
 * @returns the hit/miss counts and rate (`null` with no checks).
 */
async score(): Promise<ThesisScore>

/**
 * Theses that need a recheck today: the due date passed with no check at or after it.
 * @param today - local `YYYY-MM-DD`; defaults to today.
 * @returns the overdue records in due-date order.
 */
async due(today: string = localToday()): Promise<ThesisRecord[]>
```

Source: [`packages/skill/thesis-registry/src/index.ts`](../../packages/skill/thesis-registry/src/index.ts)
<!-- END GENERATED cordis-surface -->
