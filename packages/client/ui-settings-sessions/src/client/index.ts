/**
 * Sessions settings plugin, browser half. It registers the Sessions page into
 * the settings navigation and owns the page store over the Host's
 * `sessionsAdmin` Remote namespace: one row per session stored on this server,
 * with its whole-log counts, last activity, workspace, and log size, plus
 * rename, export, and confirmed removal. Renaming rides the existing
 * per-session `session.rename` verb, and Export links to the Host's
 * session-log download route, so this page implements neither.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge and the generated sessionsAdmin
// namespace into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { SessionsSection } from './SessionsSection.tsx'
import type { SessionsSectionInjected } from './SessionsSection.tsx'
import { SessionsSettingsStore } from './store.ts'
import { en, zh, type SessionsKey } from './locales.ts'

export type { SessionsSectionInjected, SessionsSectionProps, SessionsTranslate } from './SessionsSection.tsx'
export type { SessionsKey } from './locales.ts'
export type { SessionsSettingsState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Sessions page copy. */
    'settings.sessions': SessionsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.sessions'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on that slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.sessionsAdmin', 'remote.session']

/**
 * Register the Sessions section once the `settings.section` declaration is on
 * the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-sessions: copy dictionaries')

  const controller = new SessionsSettingsStore(ctx)
  // Registration-time text (the nav label thunk) and the inject face share one
  // bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sessions',
    order: 27,
    label: () => t('nav'),
    icon: 'chat',
    place: 'settings',
    settingsOrder: 5,
    inject: (): SessionsSectionInjected => ({
      controller,
      hooks: { snapshot: controller.store },
      t,
    }),
  }, SessionsSection))
}
