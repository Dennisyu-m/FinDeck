/**
 * Primary-navigation pages: the real schedule (R11 guidance) and the
 * environment-and-components page (the component download grid) alongside the
 * Help page. Each registers one `settings.section` row so the sidebar
 * navigation picks it up. The research-assets and roundtable placeholders were
 * superseded by their own packages (ui-assets, ui-roundtable), which removed
 * them in the same change.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {
  ScheduleManagementResult,
  ScheduleOverview,
  ScheduleRemovalResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import { HelpPage } from './PlaceholderPage.tsx'
import { SchedulePage } from './SchedulePage.tsx'
import { DataEnvPage } from './DataEnvPage.tsx'
import { observeComponentCatalog } from './componentCatalog.ts'
import { en, zh, type PagesLocaleKey } from './locales.ts'

export type { PagesLocaleKey } from './locales.ts'
export type { HelpPageProps } from './PlaceholderPage.tsx'
export type { SchedulePageProps } from './SchedulePage.tsx'
export type { DataEnvPageProps } from './DataEnvPage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Primary-navigation pages and Help copy. */
    'ui.pages': PagesLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ui.pages'

/** Required services (cordis fiber inject): slot surfaces plus the Remote faces. */
export const inject = [
  'slots',
  'locale',
  'remote',
  'remote.scheduleOverview',
  'remote.scheduleControl',
  'remote.componentCatalog',
]

/**
 * Register the `ui.pages` dictionaries and the schedule, environment-and-
 * components, and Help sections.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-pages: dictionaries')
  const t = ctx.locale.bind(NS)

  const loadSchedules = async (): Promise<ScheduleOverview> => {
    const result = await ctx.remote.scheduleOverview.schedules()
    if (!result.ok) {
      throw new Error(`scheduleOverview.schedules failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const controlSchedule = async (
    sessionId: string,
    scheduleId: string,
    op: 'pause' | 'resume',
  ): Promise<ScheduleManagementResult> => {
    const result = await ctx.remote.scheduleControl[op]({ sessionId, scheduleId })
    if (!result.ok) {
      throw new Error(`scheduleControl.${op} failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const removeSchedule = async (
    sessionId: string,
    scheduleId: string,
  ): Promise<ScheduleRemovalResult> => {
    const result = await ctx.remote.scheduleControl.deleteSchedule({ sessionId, scheduleId })
    if (!result.ok) {
      throw new Error(`scheduleControl.deleteSchedule failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'schedule',
    order: 2,
    label: () => t('schedule.nav'),
    icon: 'clock',
    place: 'nav',
    navOrder: 1,
    locale: NS,
    inject: () => ({ load: loadSchedules, control: controlSchedule, remove: removeSchedule }),
  }, SchedulePage))

  // The catalog's live progress is one subscription per plugin, so the page
  // only ever reads a bound hook over this observation.
  const catalog = observeComponentCatalog(ctx)
  ctx.effect(() => catalog.dispose, 'ui-pages: component-catalog follow stream')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'data-env',
    order: 12,
    label: () => t('data-env.nav'),
    icon: 'layers',
    place: 'settings',
    settingsOrder: 1,
    locale: NS,
    inject: () => ({
      components: catalog.actions,
      hooks: { catalog: catalog.store },
    }),
  }, DataEnvPage))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'help',
    order: 95,
    label: () => t('help.nav'),
    icon: 'help',
    place: 'settings',
    settingsOrder: 10,
    locale: NS,
  }, HelpPage))
}
