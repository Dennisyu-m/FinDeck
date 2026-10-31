/**
 * MCP servers settings plugin, browser half. It registers the MCP page into
 * the settings navigation and owns the page store over the Host's `mcpAdmin`
 * Remote namespace: the configured servers, their live connection state and
 * tools, and their definitions. The Host owns the durable list and mounts one
 * MCP client per enabled server, so this page never talks to an MCP server and
 * never writes `cordis.patch.yml`.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge and the generated mcpAdmin namespace
// into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { McpSection } from './McpSection.tsx'
import type { McpSectionInjected } from './McpSection.tsx'
import { McpSettingsStore } from './store.ts'
import { en, zh, type McpKey } from './locales.ts'

export type { McpSectionInjected, McpSectionProps } from './McpSection.tsx'
export type { McpKey } from './locales.ts'
export type { McpSettingsState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The MCP servers page copy. */
    'settings.mcp': McpKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.mcp'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on that slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.mcpAdmin']

/**
 * Register the MCP section once the `settings.section` declaration is on the
 * ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp: copy dictionaries')

  const controller = new McpSettingsStore(ctx)
  // Registration-time text (the nav label thunk) and the inject face share one
  // bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as McpSectionInjected['t']
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp',
    order: 26,
    label: () => t('nav'),
    icon: 'plug',
    place: 'settings',
    settingsOrder: 4,
    inject: (): McpSectionInjected => ({
      controller,
      hooks: { snapshot: controller.store },
      t,
    }),
  }, McpSection))
}
