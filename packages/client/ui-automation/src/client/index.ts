/**
 * Scheduled-tasks page. One `settings.section` row, so the sidebar lists it
 * only while this plugin is loaded.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {
  AutomationRunResultView,
  AutomationTaskList,
} from '@deepseek-ai/dsh-api-remotes/client'
import { AutomationPage } from './AutomationPage.tsx'
import { en, zh, type AutomationLocaleKey } from './locales.ts'

export type { AutomationLocaleKey } from './locales.ts'
export type { AutomationPageProps } from './AutomationPage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Scheduled-tasks page copy. */
    'ui.automation': AutomationLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ui.automation'

/** Required services. */
export const inject = ['slots', 'locale', 'remote', 'remote.automationTasks']

/**
 * Register the scheduled-tasks section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-automation: dictionaries')
  const t = ctx.locale.bind(NS)

  const load = async (): Promise<AutomationTaskList> => {
    const result = await ctx.remote.automationTasks.tasks()
    if (!result.ok) {
      throw new Error(`automationTasks.tasks failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const runNow = async (name: string): Promise<AutomationRunResultView> => {
    const result = await ctx.remote.automationTasks.runNow({ name })
    if (!result.ok) {
      throw new Error(`automationTasks.runNow failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'automation',
    order: 3,
    label: () => t('automation.nav'),
    icon: 'calendar',
    place: 'nav',
    navOrder: 2,
    locale: NS,
    inject: () => ({ load, runNow }),
  }, AutomationPage))
}
