/**
 * Value-desk page plugin: one `settings.section` row over the `desk` Remote
 * namespace, plus the bridges a page needs from other client services.
 *
 * The row exists only while this plugin is loaded, so disabling the desk
 * switch removes the sidebar entry together with the host service and its
 * model tools. Navigation to an asset or thesis goes through the shell's
 * `shell/open-section` route and the research-assets page's own events.
 *
 * @module @deepseek-ai/dsh-client-ui-desk/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-shell/client'
import type {} from '@deepseek-ai/dsh-client-ui-assets/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  DeskDecisionWire,
  DeskFeedbackWire,
  DeskListValue,
  DeskReportBriefValue,
  DeskRunDetailValue,
  DeskRunListValue,
  DeskRunQueryWire,
  DeskScorecardValue,
  DeskTaskInputWire,
  DeskTaskViewWire,
  DeskTemplateWire,
  WorkbenchListValue,
} from '@deepseek-ai/dsh-api-remotes/client'
import { DeskPage } from './DeskPage.tsx'
import { en, zh, type DeskLocaleKey } from './locales.ts'

export type { DeskLocaleKey } from './locales.ts'
export type { DeskPageProps } from './DeskPage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Value-desk page copy. */
    'ui.desk': DeskLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ui.desk'

/** Required services: slots, locale, sessions, and the mounted Remote namespaces. */
export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.desk', 'remote.assetOverview']

/** Throw the Remote failure's own message so the page can show it. */
function failure(prefix: string, code: string, message: string): never {
  throw new Error(`${prefix}: ${code}: ${message}`)
}

/**
 * Register the desk section and its Remote bridges.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desk: dictionaries')
  const t = ctx.locale.bind(NS)

  const loadList = async (): Promise<DeskListValue> => {
    const result = await ctx.remote.desk.list()
    return result.ok ? result.value : failure('desk.list failed', result.error.code, result.error.message)
  }
  const writeTask = async (task: DeskTaskInputWire): Promise<DeskTaskViewWire> => {
    const result = await ctx.remote.desk.write(task)
    return result.ok ? result.value : failure('desk.write failed', result.error.code, result.error.message)
  }
  const setEnabled = async (name: string, enabled: boolean): Promise<DeskTaskViewWire> => {
    const result = await ctx.remote.desk.setEnabled({ name, enabled })
    return result.ok ? result.value : failure('desk.setEnabled failed', result.error.code, result.error.message)
  }
  const runNow = async (name: string) => {
    const result = await ctx.remote.desk.runNow({ name })
    return result.ok
      ? result.value
      : failure('desk.runNow failed', result.error.code, result.error.message)
  }
  const cancelRun = async (name: string) => {
    const result = await ctx.remote.desk.cancel({ name })
    return result.ok ? result.value : failure('desk.cancel failed', result.error.code, result.error.message)
  }
  const loadRuns = async (query: DeskRunQueryWire): Promise<DeskRunListValue> => {
    const result = await ctx.remote.desk.runs(query)
    return result.ok ? result.value : failure('desk.runs failed', result.error.code, result.error.message)
  }
  const loadRunDetail = async (task: string, runId: string): Promise<DeskRunDetailValue> => {
    const result = await ctx.remote.desk.runDetail({ task, runId })
    return result.ok ? result.value : failure('desk.runDetail failed', result.error.code, result.error.message)
  }
  const loadTemplates = async (): Promise<DeskTemplateWire[]> => {
    const result = await ctx.remote.desk.templates()
    return result.ok ? result.value : failure('desk.templates failed', result.error.code, result.error.message)
  }
  const submitFeedback = async (
    task: string,
    runId: string,
    kind: string,
    note?: string,
  ): Promise<DeskFeedbackWire> => {
    const result = await ctx.remote.desk.feedback({ task, runId, kind, ...note === undefined ? {} : { note } })
    return result.ok ? result.value : failure('desk.feedback failed', result.error.code, result.error.message)
  }
  const loadFeedback = async (): Promise<DeskFeedbackWire[]> => {
    const result = await ctx.remote.desk.feedbackList()
    return result.ok ? result.value : failure('desk.feedbackList failed', result.error.code, result.error.message)
  }
  const revokeFeedback = async (id: string): Promise<boolean> => {
    const result = await ctx.remote.desk.revokeFeedback({ id })
    return result.ok ? result.value : failure('desk.revokeFeedback failed', result.error.code, result.error.message)
  }
  const resetPreferences = async (): Promise<{ resetAt: string }> => {
    const result = await ctx.remote.desk.resetPreferences()
    return result.ok ? result.value : failure('desk.resetPreferences failed', result.error.code, result.error.message)
  }
  const setDecision = async (
    task: string,
    runId: string,
    decisionId: string,
    status: 'open' | 'handled',
  ): Promise<DeskDecisionWire[]> => {
    const result = await ctx.remote.desk.setDecision({ task, runId, decisionId, status })
    return result.ok ? result.value : failure('desk.setDecision failed', result.error.code, result.error.message)
  }
  const adoptThesis = async (request: {
    id: string
    conclusion: string
    metric: string
    threshold: string
    dueDate: string
    report: string
    assets?: string[]
  }) => {
    const result = await ctx.remote.desk.adoptThesis(request)
    return result.ok ? result.value : failure('desk.adoptThesis failed', result.error.code, result.error.message)
  }
  const loadScorecard = async (windowDays?: number): Promise<DeskScorecardValue> => {
    const result = await ctx.remote.desk.scorecard(windowDays === undefined ? {} : { windowDays })
    return result.ok ? result.value : failure('desk.scorecard failed', result.error.code, result.error.message)
  }
  const loadReportBrief = async (task: string, runId: string): Promise<DeskReportBriefValue> => {
    const result = await ctx.remote.desk.reportBrief({ task, runId })
    return result.ok ? result.value : failure('desk.reportBrief failed', result.error.code, result.error.message)
  }
  const loadWorkbenches = async (): Promise<WorkbenchListValue> => {
    const result = await ctx.remote.assetOverview.workbenches()
    return result.ok ? result.value : failure('assetOverview.workbenches failed', result.error.code, result.error.message)
  }

  /**
   * Open a new session on the report seed: the same brief-then-create path the
   * research-assets page uses for a single asset.
   */
  const followUp = async (seed: string): Promise<void> => {
    const sessionId = await ctx.sessions.create({})
    ctx.sessions.open(sessionId)
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error('the new session is not addressable yet')
    const submission = session.beginSubmission({ mode: 'queue', text: seed, attachments: [] })
    const result = await session.prompt(
      [{ type: 'text', text: seed }],
      'queue',
      undefined,
      submission.requestId,
    )
    if (!result.ok) {
      submission.abandon()
      throw new Error(`${result.error.message} (${result.error.code})`)
    }
  }

  /** Open one existing session by id. */
  const openSession = (sessionId: string): void => {
    ctx.sessions.open(sessionId as Parameters<typeof ctx.sessions.open>[0])
  }

  /** Route to the research-assets page and its exact asset face. */
  const jumpToAsset = (asset: string, version?: number): void => {
    ctx.emit('shell/open-section', 'research-assets')
    ctx.emit('assets/open', { asset, ...version === undefined ? {} : { version } })
  }

  /** Route to the research-assets page's thesis view. */
  const jumpToThesis = (id: string): void => {
    ctx.emit('shell/open-section', 'research-assets')
    ctx.emit('assets/open-thesis', { id })
  }

  const injected = () => ({
    loadList,
    writeTask,
    setEnabled,
    runNow,
    cancelRun,
    loadRuns,
    loadRunDetail,
    loadTemplates,
    submitFeedback,
    loadFeedback,
    revokeFeedback,
    resetPreferences,
    setDecision,
    adoptThesis,
    loadScorecard,
    loadReportBrief,
    followUp,
    openSession,
    jumpToAsset,
    jumpToThesis,
    loadWorkbenches,
  })

  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'desk',
    order: 4,
    label: () => t('nav'),
    icon: 'sparkle',
    place: 'nav',
    navOrder: 2,
    locale: NS,
    inject: injected,
  }, DeskPage)), 'ui-desk: desk section')
}
