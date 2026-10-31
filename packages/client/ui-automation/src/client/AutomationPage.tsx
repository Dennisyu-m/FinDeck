/**
 * The scheduled-tasks page: one card per automation-runner task, with its
 * trigger, last result, next fire, and an immediate-run button. Session
 * reminders stay on the schedule page.
 */

import { useEffect, useState } from 'react'
import type {
  AutomationRunResultView,
  AutomationTaskList,
  AutomationTaskView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconRefreshOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './AutomationPage.module.css'

export type AutomationPageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'ui.automation'>
  & {
    /** Read the runner's task list. */
    readonly load: () => Promise<AutomationTaskList>
    /** Run one task immediately and return the runner outcome. */
    readonly runNow: (name: string) => Promise<AutomationRunResultView>
  }

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly tasks: readonly AutomationTaskView[] }

function fill(text: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, value), text)
}

function triggerText(task: AutomationTaskView, t: AutomationPageProps['t']): string {
  if (task.triggerKind === 'manual') return t('automation.triggerManual')
  if (task.triggerKind === 'cron') return fill(t('automation.triggerCron'), { schedule: task.schedule ?? '' })
  if (task.triggerKind === 'interval') {
    return fill(t('automation.triggerInterval'), { seconds: String(task.everySeconds ?? '') })
  }
  return fill(t('automation.triggerUnknown'), { kind: task.triggerKind })
}

function statusText(status: string, t: AutomationPageProps['t']): string {
  if (status === 'ok') return t('automation.status.ok')
  if (status === 'failed') return t('automation.status.failed')
  if (status === 'skipped') return t('automation.status.skipped')
  return status
}

/**
 * Render the scheduled-tasks page.
 * @param props - section props, locale, and the runner Remote callbacks.
 * @returns the page element tree.
 */
export function AutomationPage({ t, load, runNow }: AutomationPageProps) {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [running, setRunning] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    void load().then(
      list => { if (alive) setState({ status: 'ready', tasks: list.tasks }) },
      (error: unknown) => {
        if (alive) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { alive = false }
  }, [load, request])

  const start = (name: string): void => {
    setRunning(name)
    setRunError(null)
    void runNow(name).then(
      () => { setRunning(null); setRequest(value => value + 1) },
      (error: unknown) => {
        setRunning(null)
        setRunError(error instanceof Error ? error.message : String(error))
      },
    )
  }

  const tasks = state.status === 'ready' ? state.tasks : []

  return (
    <div className={css.page}>
      <div className={css.pageHead}>
        <div>
          <h2 className={css.title}>{t('automation.title')}</h2>
          <p className={css.note}>{t('automation.subtitle')}</p>
        </div>
        <div className={css.headActions}>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutlineMedium />}
            aria-label={t('automation.refresh')}
            title={t('automation.refresh')}
            onClick={() => { setRequest(value => value + 1) }}
          />
        </div>
      </div>
      {state.status === 'loading' ? <p className={css.note}>{t('automation.listLoading')}</p> : null}
      {state.status === 'error'
        ? (
          <p className={css.note} role="alert">
            {fill(t('automation.listError'), { message: state.message })}
          </p>
        )
        : null}
      {runError === null
        ? null
        : <p className={css.note} role="alert">{fill(t('automation.runError'), { message: runError })}</p>}
      {state.status === 'ready' && tasks.length === 0
        ? <p className={css.empty}>{t('automation.listEmpty')}</p>
        : null}
      <ul className={css.grid}>
        {tasks.map(task => {
          const last = task.lastTs === undefined
            ? t('automation.lastNone')
            : fill(t('automation.last'), { time: task.lastTs, status: statusText(task.lastStatus ?? '', t) })
          const exit = task.lastExitCode === undefined || task.lastExitCode === null
            ? ''
            : fill(t('automation.exit'), { code: String(task.lastExitCode) })
          const timed = task.lastTimedOut === undefined
            ? ''
            : (task.lastTimedOut ? t('automation.timedOut') : t('automation.notTimedOut'))
          return (
            <li key={task.name} className={css.card}>
              <div className={css.cardHead}>
                <strong className={css.cardTitle}>{task.name}</strong>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={running !== null}
                  onClick={() => { start(task.name) }}
                >
                  {running === task.name ? t('automation.running') : t('automation.runNow')}
                </Button>
              </div>
              <p className={css.note}>{triggerText(task, t)}</p>
              <p className={css.cardTime}>
                {task.nextRunAt === undefined ? t('automation.nextNone') : fill(t('automation.next'), { time: task.nextRunAt })}
              </p>
              <p className={css.note}>
                {last}
                {exit === '' ? '' : ` · ${exit}`}
                {timed === '' ? '' : ` · ${timed}`}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
