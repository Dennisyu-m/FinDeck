/**
 * Automation settings section. Switch groups come from the host config
 * (`pluginPatch.scheduledGroups`). A successful write reloads the page
 * through the injected callback.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { AutomationSection, type PatchWrite, type SwitchGroupView } from './Section.tsx'
import { en, zh, type AutomationSettingsKey } from './locales.ts'

export type { AutomationSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Automation settings section copy. */
    'settings.automation': AutomationSettingsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.automation'

/** Required services. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginPatch']

/**
 * Register the automation settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-automation: dictionaries')
  const t = ctx.locale.bind(NS)

  const loadGroups = async (): Promise<readonly SwitchGroupView[]> => {
    const result = await ctx.remote.pluginPatch.scheduledGroups()
    if (!result.ok) {
      throw new Error(`pluginPatch.scheduledGroups failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const loadPatch = async () => {
    const result = await ctx.remote.pluginPatch.read()
    if (!result.ok) {
      throw new Error(`pluginPatch.read failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const writeGroup = async (entries: readonly PatchWrite[]): Promise<void> => {
    const result = await ctx.remote.pluginPatch.write([...entries])
    if (!result.ok) {
      throw new Error(`pluginPatch.write failed: ${result.error.code}: ${result.error.message}`)
    }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'automation-settings',
    order: 96,
    label: () => t('nav'),
    icon: 'sliders',
    place: 'settings',
    settingsOrder: 11,
    locale: NS,
    inject: () => ({
      loadGroups,
      loadPatch,
      writeGroup,
      reload: () => { location.reload() },
    }),
  }, AutomationSection))
}
