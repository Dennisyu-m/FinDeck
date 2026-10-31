/**
 * The value-desk page: task list and editor, run timeline and detail, report
 * timeline, feedback history, and the scorecard.
 *
 * The page renders what `remote.desk` answered; it holds only viewing state
 * (active tab, filters, the open run, the draft task). Every mutation goes
 * through an injected callback, and a failed write leaves the visible state
 * unchanged until the owner reloads it.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  DeskBudgetWire,
  DeskDecisionWire,
  DeskFeedbackWire,
  DeskListValue,
  DeskReportBriefValue,
  DeskReportValue,
  DeskRunDetailValue,
  DeskRunListValue,
  DeskRunQueryWire,
  DeskRefreshWire,
  DeskRunWire,
  DeskScorecardValue,
  DeskSignalWire,
  DeskTargetWire,
  DeskTaskInputWire,
  DeskTaskViewWire,
  DeskTemplateWire,
  DeskTriggerWire,
  WorkbenchView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconRefreshOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeskLocaleKey } from './locales.ts'
import css from './DeskPage.module.css'

/** The page's tabs in bar order. */
type TabId = 'tasks' | 'runs' | 'reports' | 'feedback' | 'scorecard'

const TAB_BAR: readonly (readonly [TabId, DeskLocaleKey])[] = [
  ['tasks', 'tabTasks'],
  ['runs', 'tabRuns'],
  ['reports', 'tabReports'],
  ['feedback', 'tabFeedback'],
  ['scorecard', 'tabScorecard'],
]

/** Substitute `{name}` placeholders in one locale string. */
function fill(text: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, value), text)
}

/** Map one run status to its dictionary key. */
function statusKey(status: string): DeskLocaleKey {
  switch (status) {
    case 'running': return 'statusRunning'
    case 'ok': return 'statusOk'
    case 'degraded': return 'statusDegraded'
    case 'no-change': return 'statusNoChange'
    case 'data-insufficient': return 'statusDataInsufficient'
    case 'budget': return 'statusBudget'
    case 'timeout': return 'statusTimeout'
    case 'cancelled': return 'statusCancelled'
    case 'skipped': return 'statusSkipped'
    default: return 'statusFailed'
  }
}

/** Render one trigger as human text. */
function triggerText(trigger: DeskTriggerWire, t: DeskPageProps['t']): string {
  if (trigger.kind === 'cron') return `cron ${trigger.schedule ?? ''}`
  if (trigger.kind === 'interval') return `every ${String(trigger.everySeconds ?? '')}s`
  if (trigger.kind === 'event') return `event ${trigger.name ?? ''}`
  if (trigger.kind === 'thesis-due') return t('fieldThesisDue')
  return trigger.kind
}

/** One refresh definition as the form edits it; `none` means the target declares no refresh. */
interface DraftRefresh {
  kind: 'none' | 'verb' | 'pipeline'
  asset: string
  verb: string
  pipeline: string
}

/** One watched object, including its complete refresh declaration. */
interface DraftTarget {
  kind: string
  ref: string
  refresh: DraftRefresh
}

/** One trigger in file order. */
interface DraftTrigger {
  kind: 'cron' | 'interval' | 'event' | 'thesis-due'
  schedule: string
  everySeconds: string
  name: string
}

/** One task draft as the form edits it. */
interface TaskDraft {
  name: string
  displayName: string
  goal: string
  enabled: boolean
  report: 'always' | 'changes'
  targets: DraftTarget[]
  triggers: DraftTrigger[]
  tokens: string
  wallSeconds: string
  maxOutputTokens: string
}

function emptyRefresh(): DraftRefresh {
  return { kind: 'none', asset: '', verb: '', pipeline: '' }
}

function emptyTrigger(kind: DraftTrigger['kind'] = 'cron'): DraftTrigger {
  return { kind, schedule: '', everySeconds: '', name: '' }
}

function emptyDraft(): TaskDraft {
  return {
    name: '',
    displayName: '',
    goal: '',
    enabled: true,
    report: 'always',
    targets: [{ kind: 'asset', ref: '', refresh: emptyRefresh() }],
    triggers: [emptyTrigger('cron')],
    tokens: '20000',
    wallSeconds: '600',
    maxOutputTokens: '',
  }
}

function draftRefreshOf(refresh: DeskTargetWire['refresh']): DraftRefresh {
  if (refresh === undefined) return emptyRefresh()
  if (refresh.kind === 'verb') {
    return { kind: 'verb', asset: refresh.asset ?? '', verb: refresh.verb ?? '', pipeline: '' }
  }
  if (refresh.kind === 'pipeline') {
    return { kind: 'pipeline', asset: '', verb: '', pipeline: refresh.name ?? '' }
  }
  return emptyRefresh()
}

function draftTargetOf(target: DeskTargetWire): DraftTarget {
  return { kind: target.kind, ref: target.ref, refresh: draftRefreshOf(target.refresh) }
}

function draftTriggerOf(trigger: DeskTriggerWire): DraftTrigger {
  const kind = trigger.kind === 'interval' || trigger.kind === 'event' || trigger.kind === 'thesis-due'
    ? trigger.kind
    : 'cron'
  return {
    kind,
    schedule: trigger.schedule ?? '',
    everySeconds: trigger.everySeconds === undefined ? '' : String(trigger.everySeconds),
    name: trigger.name ?? '',
  }
}

function draftOfTask(task: DeskTaskViewWire): TaskDraft {
  return {
    name: task.name,
    displayName: task.displayName,
    goal: task.goal,
    enabled: task.enabled,
    report: task.report === 'changes' ? 'changes' : 'always',
    targets: task.targets.map(draftTargetOf),
    triggers: task.triggers.map(draftTriggerOf),
    tokens: String(task.budget.tokens),
    wallSeconds: String(task.budget.wallSeconds),
    maxOutputTokens: task.budget.maxOutputTokens === undefined ? '' : String(task.budget.maxOutputTokens),
  }
}

function draftOfTemplate(template: DeskTemplateWire): TaskDraft {
  return {
    name: template.task.name,
    displayName: template.task.display_name,
    goal: template.task.goal,
    enabled: template.task.enabled ?? true,
    report: template.task.report === 'changes' ? 'changes' : 'always',
    targets: template.task.targets.map(draftTargetOf),
    triggers: template.task.triggers.map(draftTriggerOf),
    tokens: String(template.task.budget.tokens),
    wallSeconds: String(template.task.budget.wallSeconds),
    maxOutputTokens: template.task.budget.maxOutputTokens === undefined ? '' : String(template.task.budget.maxOutputTokens),
  }
}

/** Build one wire refresh from the draft, or `undefined` for no refresh. */
function wireRefreshOf(refresh: DraftRefresh): DeskRefreshWire | undefined {
  if (refresh.kind === 'none') return undefined
  const asset = refresh.asset.trim()
  const verb = refresh.verb.trim()
  const pipeline = refresh.pipeline.trim()
  if (refresh.kind === 'verb') {
    if (asset === '' || verb === '') throw new Error('refresh-invalid')
    return { kind: 'verb', asset, verb }
  }
  if (pipeline === '') throw new Error('refresh-invalid')
  return { kind: 'pipeline', name: pipeline }
}

/** Build the wire task from the draft; invalid numbers become a readable error. */
function specOfDraft(draft: TaskDraft): DeskTaskInputWire {
  const targets = draft.targets
    .map(target => {
      const ref = target.ref.trim()
      if (ref === '') return undefined
      const refresh = wireRefreshOf(target.refresh)
      return {
        kind: target.kind,
        ref,
        ...refresh === undefined ? {} : { refresh },
      }
    })
    .filter((target): target is DeskTargetWire => target !== undefined)
  if (targets.length === 0) throw new Error('targets-empty')
  const triggers: DeskTriggerWire[] = draft.triggers.map(trigger => {
    if (trigger.kind === 'cron') {
      const schedule = trigger.schedule.trim()
      if (schedule === '') throw new Error('cron-invalid')
      return { kind: 'cron', schedule }
    }
    if (trigger.kind === 'interval') {
      const everySeconds = Number(trigger.everySeconds)
      if (!Number.isSafeInteger(everySeconds) || everySeconds < 1) throw new Error('interval-invalid')
      return { kind: 'interval', everySeconds }
    }
    if (trigger.kind === 'event') {
      const name = trigger.name.trim()
      if (name === '') throw new Error('event-invalid')
      return { kind: 'event', name }
    }
    return { kind: 'thesis-due' }
  })
  if (triggers.length === 0) throw new Error('triggers-empty')
  const tokens = Number(draft.tokens)
  const wallSeconds = Number(draft.wallSeconds)
  if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error('tokens-invalid')
  if (!Number.isSafeInteger(wallSeconds) || wallSeconds < 1) throw new Error('wall-invalid')
  const maxOutputTokens = draft.maxOutputTokens.trim() === '' ? undefined : Number(draft.maxOutputTokens)
  if (maxOutputTokens !== undefined && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)) {
    throw new Error('max-output-invalid')
  }
  const budget: DeskBudgetWire = {
    tokens,
    wallSeconds,
    ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
  }
  return {
    name: draft.name.trim(),
    display_name: draft.displayName.trim(),
    goal: draft.goal.trim(),
    enabled: draft.enabled,
    targets,
    triggers,
    report: draft.report,
    budget,
  }
}

export type DeskPageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'ui.desk'>
  & {
    readonly loadList: () => Promise<DeskListValue>
    readonly writeTask: (task: DeskTaskInputWire) => Promise<DeskTaskViewWire>
    readonly setEnabled: (name: string, enabled: boolean) => Promise<DeskTaskViewWire>
    readonly runNow: (name: string) => Promise<{ runId: string; status: string; stopReason: string; report: string | null }>
    readonly cancelRun: (name: string) => Promise<{ cancelled: boolean }>
    readonly loadRuns: (query: DeskRunQueryWire) => Promise<DeskRunListValue>
    readonly loadRunDetail: (task: string, runId: string) => Promise<DeskRunDetailValue>
    readonly loadTemplates: () => Promise<DeskTemplateWire[]>
    readonly submitFeedback: (task: string, runId: string, kind: string, note?: string) => Promise<DeskFeedbackWire>
    readonly loadFeedback: () => Promise<DeskFeedbackWire[]>
    readonly revokeFeedback: (id: string) => Promise<boolean>
    readonly resetPreferences: () => Promise<{ resetAt: string }>
    readonly setDecision: (
      task: string,
      runId: string,
      decisionId: string,
      status: 'open' | 'handled',
    ) => Promise<DeskDecisionWire[]>
    readonly adoptThesis: (request: {
      id: string
      conclusion: string
      metric: string
      threshold: string
      dueDate: string
      report: string
      assets?: string[]
    }) => Promise<{ id: string; dueDate: string; status: string }>
    readonly loadScorecard: (windowDays?: number) => Promise<DeskScorecardValue>
    readonly loadReportBrief: (task: string, runId: string) => Promise<DeskReportBriefValue>
    readonly followUp: (seed: string) => Promise<void>
    readonly openSession: (sessionId: string) => void
    readonly jumpToAsset: (asset: string, version?: number) => void
    readonly jumpToThesis: (id: string) => void
    readonly loadWorkbenches: () => Promise<{ workbenches: WorkbenchView[]; problems: string[] }>
  }

type Load<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly value: T }

/** Fill one error paragraph. */
function ErrorLine({ message, t }: { readonly message: string; readonly t: DeskPageProps['t'] }): ReactNode {
  return <p className={css.error} role="alert">{fill(t('error'), { message })}</p>
}

/** A labelled select. */
function SelectField({ label, value, options, onChange }: {
  readonly label: string
  readonly value: string
  readonly options: readonly { value: string; label: string }[]
  readonly onChange: (next: string) => void
}): ReactNode {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>{label}</span>
      <select className={css.input} value={value} onChange={event => { onChange(event.currentTarget.value) }}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

/** A labelled text input. */
function TextField({ label, value, onChange, placeholder }: {
  readonly label: string
  readonly value: string
  readonly onChange: (next: string) => void
  readonly placeholder?: string
}): ReactNode {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>{label}</span>
      <input
        className={css.input}
        value={value}
        placeholder={placeholder}
        onChange={event => { onChange(event.currentTarget.value) }}
      />
    </label>
  )
}

/** The task editor. */
function TaskForm({ draft, onChange, onSave, onCancel, saving, error, templates, onTemplate, t }: {
  readonly draft: TaskDraft
  readonly onChange: (next: TaskDraft) => void
  readonly onSave: () => void
  readonly onCancel: () => void
  readonly saving: boolean
  readonly error: string | null
  readonly templates: readonly DeskTemplateWire[]
  readonly onTemplate: (template: DeskTemplateWire) => void
  readonly t: DeskPageProps['t']
}): ReactNode {
  const patch = (next: Partial<TaskDraft>): void => { onChange({ ...draft, ...next }) }
  const setTarget = (index: number, next: Partial<DraftTarget>): void => {
    patch({ targets: draft.targets.map((target, at) => at === index ? { ...target, ...next } : target) })
  }
  const setRefresh = (index: number, next: Partial<DraftRefresh>): void => {
    const target = draft.targets[index]
    if (target === undefined) return
    setTarget(index, { refresh: { ...target.refresh, ...next } })
  }
  const setTrigger = (index: number, next: Partial<DraftTrigger>): void => {
    patch({ triggers: draft.triggers.map((trigger, at) => at === index ? { ...trigger, ...next } : trigger) })
  }
  const triggerKindOptions = [
    { value: 'cron', label: t('triggerCron') },
    { value: 'interval', label: t('triggerInterval') },
    { value: 'event', label: t('triggerEvent') },
    { value: 'thesis-due', label: t('triggerThesisDue') },
  ]
  const refreshKindOptions = [
    { value: 'none', label: t('refreshNone') },
    { value: 'verb', label: t('refreshVerb') },
    { value: 'pipeline', label: t('refreshPipeline') },
  ]
  return (
    <section className={css.form}>
      <div className={css.formHead}>
        <h3 className={css.sectionTitle}>{draft.name === '' ? t('newTask') : t('editTask')}</h3>
        {draft.name === ''
          ? (
            <span className={css.templateRow}>
              <span className={css.fieldLabel}>{t('templates')}</span>
              {templates.map(template => (
                <button
                  key={template.id}
                  type="button"
                  className={css.ghost}
                  disabled={!template.available}
                  title={template.available ? template.description : t('templateUnavailable')}
                  onClick={() => { onTemplate(template) }}
                >
                  {template.name}
                </button>
              ))}
            </span>
          )
          : null}
      </div>
      {error === null ? null : <p className={css.error} role="alert">{error}</p>}
      <div className={css.formGrid}>
        <TextField label={t('fieldName')} value={draft.name} onChange={name => { patch({ name }) }} placeholder="morning-brief" />
        <TextField label={t('fieldDisplayName')} value={draft.displayName} onChange={displayName => { patch({ displayName }) }} />
        <TextField label={t('fieldGoal')} value={draft.goal} onChange={goal => { patch({ goal }) }} />
        <SelectField
          label={t('fieldReport')}
          value={draft.report}
          options={[
            { value: 'always', label: t('reportAlways') },
            { value: 'changes', label: t('reportChanges') },
          ]}
          onChange={report => { patch({ report: report === 'changes' ? 'changes' : 'always' }) }}
        />
        <label className={css.checkField}>
          <input type="checkbox" checked={draft.enabled} onChange={event => { patch({ enabled: event.currentTarget.checked }) }} />
          {t('fieldEnabled')}
        </label>
      </div>

      <h4 className={css.sectionTitle}>{t('fieldTargets')}</h4>
      {draft.targets.map((target, index) => (
        <div key={`target-${String(index)}`} className={css.formGroup}>
          <div className={css.formGrid}>
            <SelectField
              label={t('fieldTargetKind')}
              value={target.kind}
              options={[
                { value: 'symbol', label: t('targetSymbol') },
                { value: 'theme', label: t('targetTheme') },
                { value: 'thesis', label: t('targetThesis') },
                { value: 'asset', label: t('targetAsset') },
                { value: 'workbench', label: t('targetWorkbench') },
              ]}
              onChange={kind => { setTarget(index, { kind }) }}
            />
            <TextField label={t('fieldTargetRef')} value={target.ref} onChange={ref => { setTarget(index, { ref }) }} />
            <SelectField
              label={t('fieldRefresh')}
              value={target.refresh.kind}
              options={refreshKindOptions}
              onChange={kind => {
                setRefresh(index, {
                  kind: kind === 'verb' || kind === 'pipeline' ? kind : 'none',
                })
              }}
            />
            <button
              type="button"
              className={css.ghost}
              onClick={() => { patch({ targets: draft.targets.filter((_item, at) => at !== index) }) }}
            >
              {t('removeTarget')}
            </button>
          </div>
          {target.refresh.kind === 'verb'
            ? (
              <div className={css.formGrid}>
                <TextField label={t('refreshAsset')} value={target.refresh.asset} onChange={asset => { setRefresh(index, { asset }) }} />
                <TextField label={t('refreshVerbName')} value={target.refresh.verb} onChange={verb => { setRefresh(index, { verb }) }} />
              </div>
            )
            : null}
          {target.refresh.kind === 'pipeline'
            ? (
              <div className={css.formGrid}>
                <TextField label={t('refreshPipelineName')} value={target.refresh.pipeline} onChange={pipeline => { setRefresh(index, { pipeline }) }} />
              </div>
            )
            : null}
        </div>
      ))}
      <button
        type="button"
        className={css.ghost}
        onClick={() => { patch({ targets: [...draft.targets, { kind: 'asset', ref: '', refresh: emptyRefresh() }] }) }}
      >
        {t('addTarget')}
      </button>

      <h4 className={css.sectionTitle}>{t('fieldTriggers')}</h4>
      {draft.triggers.map((trigger, index) => (
        <div key={`trigger-${String(index)}`} className={css.formGrid}>
          <SelectField
            label={t('fieldTriggerKind')}
            value={trigger.kind}
            options={triggerKindOptions}
            onChange={kind => {
              setTrigger(index, {
                kind: kind === 'interval' || kind === 'event' || kind === 'thesis-due' ? kind : 'cron',
              })
            }}
          />
          {trigger.kind === 'cron'
            ? (
              <TextField
                label={t('fieldCron')}
                value={trigger.schedule}
                onChange={schedule => { setTrigger(index, { schedule }) }}
                placeholder="0 8 * * 1-5"
              />
            )
            : null}
          {trigger.kind === 'interval'
            ? (
              <TextField
                label={t('fieldInterval')}
                value={trigger.everySeconds}
                onChange={everySeconds => { setTrigger(index, { everySeconds }) }}
                placeholder="3600"
              />
            )
            : null}
          {trigger.kind === 'event'
            ? (
              <TextField
                label={t('fieldEvent')}
                value={trigger.name}
                onChange={name => { setTrigger(index, { name }) }}
                placeholder="github"
              />
            )
            : null}
          <button
            type="button"
            className={css.ghost}
            onClick={() => { patch({ triggers: draft.triggers.filter((_item, at) => at !== index) }) }}
          >
            {t('removeTrigger')}
          </button>
        </div>
      ))}
      <button type="button" className={css.ghost} onClick={() => { patch({ triggers: [...draft.triggers, emptyTrigger()] }) }}>
        {t('addTrigger')}
      </button>

      <div className={css.formGrid}>
        <TextField label={t('fieldTokens')} value={draft.tokens} onChange={tokens => { patch({ tokens }) }} />
        <TextField label={t('fieldWallSeconds')} value={draft.wallSeconds} onChange={wallSeconds => { patch({ wallSeconds }) }} />
        <TextField label={t('fieldMaxOutputTokens')} value={draft.maxOutputTokens} onChange={maxOutputTokens => { patch({ maxOutputTokens }) }} />
      </div>
      <p className={css.hint}>{t('budgetHint')}</p>
      <p className={css.hint}>{t('deleteHint')}</p>
      <div className={css.formActions}>
        <Button variant="primary" size="sm" disabled={saving} onClick={onSave}>
          {saving ? t('saving') : t('save')}
        </Button>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>{t('cancelEdit')}</Button>
      </div>
    </section>
  )
}

/** One task card with its schedule and actions. */
function TaskCard({ task, onEdit, onToggle, onRun, onCancel, onShowRuns, busy, running, t }: {
  readonly task: DeskTaskViewWire
  readonly onEdit: () => void
  readonly onToggle: () => void
  readonly onRun: () => void
  readonly onCancel: () => void
  readonly onShowRuns: () => void
  readonly busy: boolean
  /** True while this task's run is in flight, including a manual run whose request has not returned. */
  readonly running: boolean
  readonly t: DeskPageProps['t']
}): ReactNode {
  return (
    <li className={css.card}>
      <div className={css.cardHead}>
        <strong className={css.cardTitle}>{task.displayName}</strong>
        <span className={css.chip} data-on={task.enabled ? 'true' : undefined}>{task.enabled ? t('enabled') : t('disabled')}</span>
        {running ? <span className={css.chip} data-running="true">{t('statusRunning')}</span> : null}
      </div>
      <p className={css.note}>{task.goal}</p>
      <p className={css.note}>{task.triggers.map(trigger => triggerText(trigger, t)).join(' · ')}</p>
      <p className={css.note}>
        {task.nextRunAt === null ? t('neverRun') : fill(t('nextRun'), { time: task.nextRunAt })}
        {' · '}
        {task.last === null
          ? t('neverRun')
          : fill(t('lastRun'), { time: task.last.ts, status: t(statusKey(task.last.status)) })}
      </p>
      <div className={css.actions}>
        <Button variant="primary" size="sm" disabled={busy || running} onClick={onRun}>
          {running ? t('runningNow') : t('runNow')}
        </Button>
        {running
          ? <Button variant="ghost" size="sm" onClick={onCancel}>{t('cancelRun')}</Button>
          : null}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onToggle}>
          {task.enabled ? t('disabled') : t('enabled')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onEdit}>{t('editTask')}</Button>
        <Button variant="ghost" size="sm" onClick={onShowRuns}>{t('showRuns')}</Button>
      </div>
    </li>
  )
}

/** Render the signal table. */
function SignalTable({ signals, t, onAsset, onThesis }: {
  readonly signals: readonly DeskSignalWire[]
  readonly t: DeskPageProps['t']
  readonly onAsset: (asset: string, version?: number) => void
  readonly onThesis: (id: string) => void
}): ReactNode {
  if (signals.length === 0) return <p className={css.note}>{t('noInputs')}</p>
  return (
    <table className={css.table}>
      <thead>
        <tr>
          <th>{t('signalRef')}</th>
          <th>{t('signalStatus')}</th>
          <th>{t('signalValue')}</th>
          <th>{t('signalNote')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {signals.map(signal => {
          const change = signal.change === undefined || signal.change === null
            ? '—'
            : `${(signal.change * 100).toFixed(2)}%`
          return (
            <tr key={`${signal.kind}:${signal.ref}`}>
              <td>{signal.ref}</td>
              <td>{signal.status}</td>
              <td>{change}</td>
              <td>{signal.note ?? ''}</td>
              <td>
                {signal.asset === undefined
                  ? null
                  : <button type="button" className={css.link} onClick={() => { onAsset(signal.asset!, signal.version) }}>{t('viewAsset')}</button>}
                {signal.kind === 'thesis'
                  ? <button type="button" className={css.link} onClick={() => { onThesis(signal.ref) }}>{t('viewThesis')}</button>
                  : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Render the four report sections. */
function ReportCard({ report, t, onAsset }: {
  readonly report: DeskReportValue
  readonly t: DeskPageProps['t']
  readonly onAsset: (asset: string, version?: number) => void
}): ReactNode {
  const sections = report.sections
  return (
    <section className={css.report}>
      <div className={css.cardHead}>
        <h4 className={css.sectionTitle}>{report.title ?? t('reportTitle')}</h4>
        <span className={css.chip}>{fill(t('reportVersion'), { version: String(report.version) })}</span>
      </div>
      {report.fallback ? <p className={css.warn} role="status">{t('reportFallback')}</p> : null}
      {report.sourcesComplete ? null : <p className={css.warn} role="status">{t('sourcesIncomplete')}</p>}
      {sections === null
        ? <p className={css.note}>{report.markdown === null ? t('reportMissing') : report.markdown}</p>
        : (
          <>
            <h5 className={css.sectionTitle}>{t('reportPoints')}</h5>
            <ol className={css.points}>
              {sections.points.map(point => <li key={point}>{point}</li>)}
            </ol>
            <h5 className={css.sectionTitle}>{t('reportMoves')}</h5>
            <p className={css.text}>{sections.moves}</p>
            <h5 className={css.sectionTitle}>{t('reportTheses')}</h5>
            <p className={css.text}>{sections.theses}</p>
            <h5 className={css.sectionTitle}>{t('reportDecisions')}</h5>
            {sections.decisions.length === 0
              ? <p className={css.note}>{'—'}</p>
              : (
                <ul className={css.points}>
                  {sections.decisions.map(decision => <li key={`${decision.kind}:${decision.text}`}>{`[${decision.kind}] ${decision.text}`}</li>)}
                </ul>
              )}
          </>
        )}
      {report.sources.length === 0
        ? null
        : (
          <div className={css.sourceRow}>
            {report.sources.map(source => (
              <button
                key={`${source.asset}@${String(source.version)}`}
                type="button"
                className={css.sourceChip}
                onClick={() => { onAsset(source.asset, source.version) }}
              >
                {`${source.asset}@v${String(source.version)}`}
              </button>
            ))}
          </div>
        )}
    </section>
  )
}

/** The run detail panel. */
function RunDetail({ detail, feedback, onClose, onFeedback, onRevoke, onDecision, onFollowUp, onOpenSession, onAsset, onThesis, onAdopt, busy, message, t }: {
  readonly detail: DeskRunDetailValue
  readonly feedback: readonly DeskFeedbackWire[]
  readonly onClose: () => void
  readonly onFeedback: (kind: 'useful' | 'useless' | 'handled') => void
  readonly onRevoke: (id: string) => void
  readonly onDecision: (decisionId: string, status: 'open' | 'handled') => void
  readonly onFollowUp: () => void
  readonly onOpenSession: (sessionId: string) => void
  readonly onAsset: (asset: string, version?: number) => void
  readonly onThesis: (id: string) => void
  readonly onAdopt: (request: {
    id: string
    conclusion: string
    metric: string
    threshold: string
    dueDate: string
    report: string
    assets?: string[]
  }) => void
  readonly busy: boolean
  readonly message: string | null
  readonly t: DeskPageProps['t']
}): ReactNode {
  const { run, report, decisions } = detail
  const [adopting, setAdopting] = useState(false)
  const [adoptId, setAdoptId] = useState('')
  const [adoptConclusion, setAdoptConclusion] = useState('')
  const [adoptMetric, setAdoptMetric] = useState('')
  const [adoptThreshold, setAdoptThreshold] = useState('')
  const [adoptDue, setAdoptDue] = useState(() => {
    const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    return date.toISOString().slice(0, 10)
  })
  const marks = feedback.filter(item => item.runId === run.runId)
  return (
    <section className={css.detail}>
      <div className={css.cardHead}>
        <h3 className={css.sectionTitle}>{t('detailTitle')}</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>{t('cancelEdit')}</Button>
      </div>
      <p className={css.note}>
        {`${run.startedAt} · ${t(statusKey(run.status))} · ${run.runId}`}
      </p>
      {run.stopReason === null ? null : <p className={css.note}>{fill(t('stopReason'), { reason: run.stopReason })}</p>}
      <p className={css.note}>{`${t('detailTrigger')}: ${triggerText(run.trigger, t)}`}</p>
      <p className={css.note}>{`${t('detailUsage')}: ${run.usage === null ? t('usageNone') : fill(t('usageLine'), {
        input: String(run.usage.inputTokens),
        output: String(run.usage.outputTokens),
        requests: String(run.usage.requests),
      })}`}</p>
      {run.usage?.unknown === true ? <p className={css.warn}>{t('usageUnknown')}</p> : null}
      <p className={css.note}>
        {`${t('processFacts')}: ${run.exitCode === null ? '—' : fill(t('processExit'), { code: String(run.exitCode) })}`
          + `${run.signal === null ? '' : ` · ${fill(t('processSignal'), { signal: run.signal })}`}`
          + `${run.timedOut ? ` · ${t('processTimedOut')}` : ''}`
          + `${run.cancelled ? ` · ${t('processCancelled')}` : ''}`}
      </p>
      {run.error === null ? null : <p className={css.error}>{run.error}</p>}
      {run.sessionId === null
        ? null
        : (
          <p className={css.note}>
            <button type="button" className={css.link} onClick={() => { onOpenSession(run.sessionId!) }}>
              {`${t('openSession')}: ${run.sessionId}`}
            </button>
          </p>
        )}
      <h4 className={css.sectionTitle}>{t('inputsTitle')}</h4>
      {run.inputs.length === 0
        ? <p className={css.note}>{t('noInputs')}</p>
        : (
          <div className={css.sourceRow}>
            {run.inputs.map(input => (
              <button
                key={`${input.asset}@${String(input.version)}`}
                type="button"
                className={css.sourceChip}
                onClick={() => { onAsset(input.asset, input.version) }}
              >
                {`${input.asset}@v${String(input.version)}`}
              </button>
            ))}
          </div>
        )}
      <h4 className={css.sectionTitle}>{t('signalsTitle')}</h4>
      <SignalTable signals={run.signals} t={t} onAsset={onAsset} onThesis={onThesis} />
      {report === null
        ? <p className={css.note}>{t('reportMissing')}</p>
        : <ReportCard report={report} t={t} onAsset={onAsset} />}
      {decisions.length === 0
        ? null
        : (
          <>
            <h4 className={css.sectionTitle}>{t('reportDecisions')}</h4>
            <ul className={css.decisions}>
              {decisions.map(decision => (
                <li key={decision.id} className={css.decision}>
                  <span className={css.chip} data-on={decision.status === 'handled' ? 'true' : undefined}>
                    {decision.status === 'handled' ? t('decisionHandled') : t('decisionOpen')}
                  </span>
                  <span className={css.text}>{`[${decision.kind}] ${decision.text}`}</span>
                  <button
                    type="button"
                    className={css.link}
                    onClick={() => { onDecision(decision.id, decision.status === 'handled' ? 'open' : 'handled') }}
                  >
                    {decision.status === 'handled' ? t('decisionReopen') : t('decisionMarkHandled')}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      {report === null
        ? null
        : (
          <>
            <h4 className={css.sectionTitle}>{t('feedbackTitle')}</h4>
            <div className={css.actions}>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { onFeedback('useful') }}>{t('feedbackUseful')}</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { onFeedback('useless') }}>{t('feedbackUseless')}</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { onFeedback('handled') }}>{t('feedbackHandled')}</Button>
              <Button variant="primary" size="sm" disabled={busy} onClick={onFollowUp}>{t('followUp')}</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setAdopting(value => !value) }}>{t('adoptThesis')}</Button>
            </div>
            <p className={css.hint}>{t('feedbackHandledNote')}</p>
            {marks.length === 0
              ? null
              : (
                <ul className={css.feedbackList}>
                  {marks.map(mark => (
                    <li key={mark.id} className={css.feedbackRow}>
                      <span>{`${mark.ts} · ${mark.kind}`}</span>
                      {mark.active
                        ? <button type="button" className={css.link} onClick={() => { onRevoke(mark.id) }}>{t('feedbackRevoke')}</button>
                        : <span className={css.chip}>{t('feedbackRevoked')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            {adopting
              ? (
                <div className={css.adoptForm}>
                  <p className={css.hint}>{t('adoptThesisHint')}</p>
                  <div className={css.formGrid}>
                    <TextField label={t('adoptId')} value={adoptId} onChange={setAdoptId} placeholder="maotai-premium" />
                    <TextField label={t('adoptConclusion')} value={adoptConclusion} onChange={setAdoptConclusion} />
                    <TextField label={t('adoptMetric')} value={adoptMetric} onChange={setAdoptMetric} />
                    <TextField label={t('adoptThreshold')} value={adoptThreshold} onChange={setAdoptThreshold} />
                    <TextField label={t('adoptDueDate')} value={adoptDue} onChange={setAdoptDue} />
                  </div>
                  <div className={css.actions}>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        onAdopt({
                          id: adoptId.trim(),
                          conclusion: adoptConclusion.trim(),
                          metric: adoptMetric.trim(),
                          threshold: adoptThreshold.trim(),
                          dueDate: adoptDue.trim(),
                          report: `${report.asset}@v${String(report.version)}`,
                          assets: run.inputs.map(input => input.asset),
                        })
                        setAdopting(false)
                      }}
                    >
                      {t('adoptSubmit')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setAdopting(false) }}>{t('adoptCancel')}</Button>
                  </div>
                </div>
              )
              : null}
          </>
        )}
      {message === null ? null : <p className={css.note}>{message}</p>}
    </section>
  )
}

/** One run row in the run and report timelines. */
function RunRow({ run, onOpen, t }: {
  readonly run: DeskRunWire
  readonly onOpen: () => void
  readonly t: DeskPageProps['t']
}): ReactNode {
  return (
    <li className={css.runRow}>
      <button type="button" className={css.runButton} onClick={onOpen}>
        <span className={css.runTime}>{run.startedAt}</span>
        <span className={css.runTask}>{run.task}</span>
        <span className={css.chip} data-status={run.status}>{t(statusKey(run.status))}</span>
        <span className={css.runMeta}>
          {run.report === null
            ? t('reportMissing')
            : `${run.report.asset}@v${String(run.report.version)}${run.report.fallback ? ` · ${t('statusDegraded')}` : ''}`}
        </span>
      </button>
    </li>
  )
}

/**
 * Render the value-desk page.
 * @param props - section props, locale, and the injected Remote adapters.
 * @returns the page element tree.
 */
export function DeskPage(props: DeskPageProps): ReactNode {
  const {
    t, loadList, writeTask, setEnabled, runNow, cancelRun, loadRuns, loadRunDetail,
    loadTemplates, submitFeedback, loadFeedback, revokeFeedback, resetPreferences, setDecision,
    adoptThesis, loadScorecard, loadReportBrief, followUp, openSession, jumpToAsset, jumpToThesis,
    loadWorkbenches, close,
  } = props
  const [tab, setTab] = useState<TabId>('tasks')
  const [list, setList] = useState<Load<DeskListValue>>({ status: 'loading' })
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<readonly DeskTemplateWire[]>([])
  const [runFilter, setRunFilter] = useState<DeskRunQueryWire>({})
  const [runs, setRuns] = useState<Load<DeskRunListValue>>({ status: 'loading' })
  const [detail, setDetail] = useState<Load<DeskRunDetailValue> | null>(null)
  const [feedback, setFeedback] = useState<readonly DeskFeedbackWire[]>([])
  const [scorecard, setScorecard] = useState<Load<DeskScorecardValue>>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [pendingRuns, setPendingRuns] = useState<ReadonlySet<string>>(() => new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [workbenches, setWorkbenches] = useState<readonly WorkbenchView[]>([])

  /** Replace or drop optional filter keys, which exact optional properties forbid as undefined. */
  const patchFilter = (patch: { task?: string | undefined; statuses?: readonly string[] | undefined; since?: string | undefined }): void => {
    setRunFilter(current => {
      const next: DeskRunQueryWire = { ...current }
      if ('task' in patch) {
        if (patch.task === undefined) delete next.task
        else next.task = patch.task
      }
      if ('statuses' in patch) {
        if (patch.statuses === undefined) delete next.statuses
        else next.statuses = [...patch.statuses]
      }
      if ('since' in patch) {
        if (patch.since === undefined) delete next.since
        else next.since = patch.since
      }
      return next
    })
  }

  const reloadTasks = (): void => {
    setList({ status: 'loading' })
    void loadList().then(
      value => { setList({ status: 'ready', value }) },
      (error: unknown) => { setList({ status: 'error', message: error instanceof Error ? error.message : String(error) }) },
    )
  }

  useEffect(() => { reloadTasks() }, [loadList])

  useEffect(() => {
    void loadTemplates().then(setTemplates, () => { setTemplates([]) })
    void loadFeedback().then(setFeedback, () => { setFeedback([]) })
    void loadWorkbenches().then(
      value => { setWorkbenches(value.workbenches) },
      () => { setWorkbenches([]) },
    )
  }, [loadTemplates, loadFeedback, loadWorkbenches])

  useEffect(() => {
    if (tab !== 'runs' && tab !== 'reports') return
    let alive = true
    setRuns({ status: 'loading' })
    void loadRuns(runFilter).then(
      value => { if (alive) setRuns({ status: 'ready', value }) },
      (error: unknown) => {
        if (alive) setRuns({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { alive = false }
  }, [tab, runFilter, loadRuns])

  useEffect(() => {
    if (tab !== 'scorecard') return
    let alive = true
    setScorecard({ status: 'loading' })
    void loadScorecard(30).then(
      value => { if (alive) setScorecard({ status: 'ready', value }) },
      (error: unknown) => {
        if (alive) setScorecard({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { alive = false }
  }, [tab, loadScorecard])

  const tasks = list.status === 'ready' ? list.value.tasks : []
  const openDetail = detail?.status === 'ready' ? detail.value : null
  const taskOptions = useMemo(
    () => [
      { value: '', label: t('filterAllTasks') },
      ...tasks.map(task => ({ value: task.name, label: task.displayName })),
    ],
    [tasks, t],
  )
  const statusOptions = [
    { value: '', label: t('filterAllStatuses') },
    ...['ok', 'degraded', 'no-change', 'data-insufficient', 'running', 'failed', 'budget', 'timeout', 'cancelled', 'skipped']
      .map(status => ({ value: status, label: t(statusKey(status)) })),
  ]
  const sinceOptions = [
    { value: 'day', label: t('sinceDay') },
    { value: 'week', label: t('sinceWeek') },
    { value: 'month', label: t('sinceMonth') },
    { value: 'all', label: t('sinceAll') },
  ]

  const openRun = (run: DeskRunWire): void => {
    setDetail({ status: 'loading' })
    void loadRunDetail(run.task, run.runId).then(
      value => { setDetail({ status: 'ready', value }) },
      (error: unknown) => { setDetail({ status: 'error', message: error instanceof Error ? error.message : String(error) }) },
    )
  }

  const perform = (action: () => Promise<void>): void => {
    setBusy(true)
    setMessage(null)
    void action().finally(() => { setBusy(false) })
  }

  const save = (): void => {
    if (draft === null) return
    setSaving(true)
    setFormError(null)
    let spec: DeskTaskInputWire
    try {
      spec = specOfDraft(draft)
    } catch (error) {
      setSaving(false)
      const code = error instanceof Error ? error.message : String(error)
      const message = code === 'targets-empty'
        ? t('targetsEmpty')
        : code === 'triggers-empty'
          ? t('triggersEmpty')
          : code === 'cron-invalid'
            ? t('invalidCron')
            : code === 'interval-invalid'
              ? t('invalidInterval')
              : code === 'event-invalid'
                ? t('invalidEvent')
                : code === 'refresh-invalid'
                  ? t('invalidRefresh')
                  : code === 'tokens-invalid'
                    ? t('invalidTokens')
                    : code === 'wall-invalid'
                      ? t('invalidWall')
                      : code === 'max-output-invalid'
                        ? t('invalidMaxOutput')
                        : code
      setFormError(fill(t('saveFailed'), { message }))
      return
    }
    void writeTask(spec).then(
      () => { setSaving(false); setDraft(null); reloadTasks() },
      (error: unknown) => {
        setSaving(false)
        setFormError(fill(t('saveFailed'), { message: error instanceof Error ? error.message : String(error) }))
      },
    )
  }

  const toggle = (task: DeskTaskViewWire): void => {
    perform(async () => {
      try {
        await setEnabled(task.name, !task.enabled)
        reloadTasks()
      } catch (error) {
        setMessage(fill(t('actionFailed'), { message: error instanceof Error ? error.message : String(error) }))
      }
    })
  }

  const start = (task: DeskTaskViewWire): void => {
    setPendingRuns(current => new Set(current).add(task.name))
    setMessage(null)
    void runNow(task.name).then(
      () => {
        setMessage(t('runQueued'))
        reloadTasks()
      },
      (error: unknown) => {
        setMessage(fill(t('actionFailed'), { message: error instanceof Error ? error.message : String(error) }))
      },
    ).finally(() => {
      setPendingRuns(current => {
        const next = new Set(current)
        next.delete(task.name)
        return next
      })
    })
  }

  const stop = (task: DeskTaskViewWire): void => {
    perform(async () => {
      try {
        await cancelRun(task.name)
        setMessage(t('cancelSent'))
        reloadTasks()
      } catch (error) {
        setMessage(fill(t('actionFailed'), { message: error instanceof Error ? error.message : String(error) }))
      }
    })
  }

  const edit = (task: DeskTaskViewWire): void => {
    setFormError(null)
    setDraft(draftOfTask(task))
  }

  const doFollowUp = (task: string, runId: string): void => {
    perform(async () => {
      try {
        const brief = await loadReportBrief(task, runId)
        await followUp(brief.seed)
        close()
      } catch (error) {
        setMessage(fill(t('followUpFailed'), { message: error instanceof Error ? error.message : String(error) }))
      }
    })
  }

  const changeDecision = (task: string, runId: string, decisionId: string, status: 'open' | 'handled'): void => {
    perform(async () => {
      try {
        const decisions = await setDecision(task, runId, decisionId, status)
        setDetail(current => current?.status === 'ready'
          ? { status: 'ready', value: { ...current.value, decisions } }
          : current)
      } catch (error) {
        setMessage(fill(t('decisionFailed'), { message: error instanceof Error ? error.message : String(error) }))
      }
    })
  }

  const addFeedback = (task: string, runId: string, kind: 'useful' | 'useless' | 'handled'): void => {
    perform(async () => {
      try {
        await submitFeedback(task, runId, kind)
        setFeedback(await loadFeedback())
        setMessage(t('feedbackRecorded'))
      } catch (error) {
        setMessage(fill(t('feedbackFailed'), { message: error instanceof Error ? error.message : String(error) }))
      }
    })
  }

  return (
    <div className={css.page}>
      <div className={css.pageHead}>
        <div>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.subtitle}>{t('subtitle')}</p>
        </div>
        <div className={css.actions}>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutlineMedium />}
            aria-label={t('refresh')}
            title={t('refresh')}
            onClick={reloadTasks}
          />
          <Button variant="primary" size="sm" onClick={() => { setFormError(null); setDraft(emptyDraft()) }}>{t('newTask')}</Button>
        </div>
      </div>
      <div className={css.tabs} role="tablist">
        {TAB_BAR.map(([id, key]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={css.tab}
            onClick={() => { setTab(id) }}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {list.status === 'loading' ? <p className={css.note}>{t('loading')}</p> : null}
      {list.status === 'error' ? <ErrorLine message={list.message} t={t} /> : null}
      {list.status === 'ready' && list.value.problems.length > 0
        ? (
          <div className={css.problems} role="status">
            <p>{t('problemsTitle')}</p>
            <ul>{list.value.problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
          </div>
        )
        : null}
      {message === null ? null : <p className={css.note}>{message}</p>}

      {tab === 'tasks'
        ? (
          <>
            {draft === null
              ? null
              : (
                <TaskForm
                  draft={draft}
                  onChange={setDraft}
                  onSave={save}
                  onCancel={() => { setDraft(null); setFormError(null) }}
                  saving={saving}
                  error={formError}
                  templates={templates}
                  onTemplate={template => { setDraft(draftOfTemplate(template)); setFormError(null) }}
                  t={t}
                />
              )}
            {list.status === 'ready' && tasks.length === 0 && draft === null
              ? <p className={css.empty}>{t('tasksEmpty')}</p>
              : null}
            <ul className={css.grid}>
              {tasks.map(task => (
                <TaskCard
                  key={task.name}
                  task={task}
                  onEdit={() => { edit(task) }}
                  onToggle={() => { toggle(task) }}
                  onRun={() => { start(task) }}
                  onCancel={() => { stop(task) }}
                  onShowRuns={() => {
                    setRunFilter({ task: task.name })
                    setTab('runs')
                  }}
                  busy={busy}
                  running={task.running || pendingRuns.has(task.name)}
                  t={t}
                />
              ))}
            </ul>
          </>
        )
        : null}

      {tab === 'runs' || tab === 'reports'
        ? (
          <section className={css.runs}>
            <div className={css.filterRow}>
              <SelectField
                label={t('filterTask')}
                value={runFilter.task ?? ''}
                options={taskOptions}
                onChange={task => { patchFilter({ task: task === '' ? undefined : task }) }}
              />
              {tab === 'runs'
                ? (
                  <SelectField
                    label={t('filterStatus')}
                    value={runFilter.statuses?.[0] ?? ''}
                    options={statusOptions}
                    onChange={status => {
                      patchFilter({ statuses: status === '' ? undefined : [status] })
                    }}
                  />
                )
                : null}
              <SelectField
                label={t('filterSince')}
                value={runFilter.since === undefined ? 'all' : 'day'}
                options={sinceOptions}
                onChange={since => {
                  const ms = since === 'day' ? 86_400_000 : since === 'week' ? 7 * 86_400_000 : since === 'month' ? 30 * 86_400_000 : null
                  patchFilter({ since: ms === null ? undefined : new Date(Date.now() - ms).toISOString() })
                }}
              />
            </div>
            {runs.status === 'loading' ? <p className={css.note}>{t('loading')}</p> : null}
            {runs.status === 'error' ? <ErrorLine message={runs.message} t={t} /> : null}
            {runs.status === 'ready'
              ? (
                <>
                  {runs.value.truncated ? <p className={css.hint}>{t('runsTruncated')}</p> : null}
                  {runs.value.problems.map(problem => <p key={problem} className={css.error}>{problem}</p>)}
                  {runs.value.runs.filter(run => tab === 'runs' || run.report !== null).length === 0
                    ? <p className={css.empty}>{tab === 'runs' ? t('runsEmpty') : t('reportsEmpty')}</p>
                    : (
                      <ul className={css.runList}>
                        {runs.value.runs
                          .filter(run => tab === 'runs' || run.report !== null)
                          .map(run => <RunRow key={run.runId} run={run} onOpen={() => { openRun(run) }} t={t} />)}
                      </ul>
                    )}
                </>
              )
              : null}
            {detail === null
              ? null
              : detail.status === 'loading'
                ? <p className={css.note}>{t('loading')}</p>
                : detail.status === 'error'
                  ? <ErrorLine message={detail.message} t={t} />
                  : openDetail === null
                    ? null
                    : (
                      <RunDetail
                      detail={openDetail!}
                      feedback={feedback}
                      onClose={() => { setDetail(null) }}
                      onFeedback={kind => { addFeedback(openDetail!.run.task, openDetail!.run.runId, kind) }}
                      onRevoke={(id) => {
                        perform(async () => {
                          try {
                            await revokeFeedback(id)
                            setFeedback(await loadFeedback())
                          } catch (error) {
                            setMessage(fill(t('feedbackFailed'), { message: error instanceof Error ? error.message : String(error) }))
                          }
                        })
                      }}
                      onDecision={(decisionId, status) => {
                        changeDecision(openDetail!.run.task, openDetail!.run.runId, decisionId, status)
                      }}
                      onFollowUp={() => { doFollowUp(openDetail!.run.task, openDetail!.run.runId) }}
                      onOpenSession={openSession}
                      onAsset={jumpToAsset}
                      onThesis={jumpToThesis}
                      onAdopt={(request) => {
                        perform(async () => {
                          try {
                            const saved = await adoptThesis(request)
                            setMessage(fill(t('adoptSaved'), { id: saved.id, dueDate: saved.dueDate }))
                          } catch (error) {
                            setMessage(fill(t('adoptFailed'), { message: error instanceof Error ? error.message : String(error) }))
                          }
                        })
                      }}
                      busy={busy}
                      message={null}
                      t={t}
                    />
                  )}
          </section>
        )
        : null}

      {tab === 'feedback'
        ? (
          <section className={css.runs}>
            <div className={css.actions}>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  perform(async () => {
                    try {
                      await resetPreferences()
                      setFeedback(await loadFeedback())
                      setMessage(t('feedbackResetDone'))
                    } catch (error) {
                      setMessage(fill(t('feedbackFailed'), { message: error instanceof Error ? error.message : String(error) }))
                    }
                  })
                }}
              >
                {t('feedbackReset')}
              </Button>
            </div>
            <p className={css.hint}>{t('feedbackResetHint')}</p>
            {feedback.length === 0
              ? <p className={css.empty}>{t('feedbackEmpty')}</p>
              : (
                <ul className={css.feedbackList}>
                  {feedback.map(row => (
                    <li key={row.id} className={css.feedbackRow}>
                      <span>{`${row.ts} · ${row.task} · ${row.reportAsset}@v${String(row.reportVersion)} · ${row.kind}`}</span>
                      {row.active
                        ? (
                          <button
                            type="button"
                            className={css.link}
                            onClick={() => {
                              perform(async () => {
                                try {
                                  await revokeFeedback(row.id)
                                  setFeedback(await loadFeedback())
                                } catch (error) {
                                  setMessage(fill(t('feedbackFailed'), { message: error instanceof Error ? error.message : String(error) }))
                                }
                              })
                            }}
                          >
                            {t('feedbackRevoke')}
                          </button>
                        )
                        : <span className={css.chip}>{t('feedbackRevoked')}</span>}
                    </li>
                  ))}
                </ul>
              )}
          </section>
        )
        : null}

      {tab === 'scorecard'
        ? (
          <section className={css.runs}>
            {scorecard.status === 'loading' ? <p className={css.note}>{t('loading')}</p> : null}
            {scorecard.status === 'error' ? <ErrorLine message={scorecard.message} t={t} /> : null}
            {scorecard.status === 'ready'
              ? (() => {
                const value = scorecard.value
                const metric = (label: string, rate: number | null, denominator: number, samples: number, detail: string): ReactNode => (
                  <article key={label} className={css.metric}>
                    <h4 className={css.sectionTitle}>{label}</h4>
                    <p className={css.metricValue}>
                      {rate === null ? t('scorecardNoData') : fill(t('scorecardRate'), { rate: `${(rate * 100).toFixed(1)}%` })}
                    </p>
                    <p className={css.note}>{fill(t('scorecardDenominator'), { denominator: String(denominator), samples: String(samples) })}</p>
                    <p className={css.note}>{detail}</p>
                  </article>
                )
                return (
                  <>
                    <p className={css.note}>
                      {fill(t('scorecardWindow'), {
                        from: value.window.from.slice(0, 10),
                        to: value.window.to.slice(0, 10),
                        days: String(value.window.days),
                      })}
                    </p>
                    {value.problems.map(problem => <p key={problem} className={css.error}>{problem}</p>)}
                    <div className={css.metrics}>
                      {metric(
                        t('scorecardTheses'),
                        value.theses.rate,
                        value.theses.denominator,
                        value.theses.samples,
                        fill(t('scorecardThesesDetail'), { hits: String(value.theses.hits), misses: String(value.theses.misses) }),
                      )}
                      {metric(
                        t('scorecardReports'),
                        value.reports.rate,
                        value.reports.denominator,
                        value.reports.samples,
                        fill(t('scorecardReportsDetail'), {
                          useful: String(value.reports.useful),
                          useless: String(value.reports.useless),
                          handled: String(value.reports.handled),
                        }),
                      )}
                      {metric(
                        t('scorecardAssets'),
                        value.assets.rate,
                        value.assets.denominator,
                        value.assets.samples,
                        fill(t('scorecardAssetsDetail'), {
                          library: String(value.assets.libraryAssets),
                          touched: String(value.assets.touched),
                        }),
                      )}
                    </div>
                    <p className={css.hint}>{t('scorecardDisclaimer')}</p>
                  </>
                )
              })()
              : null}
            {workbenches.length === 0
              ? null
              : (
                <p className={css.note}>
                  {`${t('targetWorkbench')}: ${workbenches.map(workbench => workbench.displayName).join(' · ')}`}
                </p>
              )}
          </section>
        )
        : null}
    </div>
  )
}
