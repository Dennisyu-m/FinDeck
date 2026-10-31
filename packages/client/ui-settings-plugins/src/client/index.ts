/**
 * Plugins settings surface, browser half — the section chrome around one page
 * body, plus the feature-owned configuration cards that body stacks.
 *
 * The section declares `settings.plugins.body`; this package's own
 * `configurable` view registers into `settings.plugins.system`, the seat the
 * body opens inside its collapsed system-plugin region, and declares
 * `settings.plugin.item` for the cards it renders. The cards this package
 * ships are the host-plane sections the deployment already exposes; each binds
 * its namespace through the client settings scope, which keeps them unaware of
 * one another and of other views.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.settingsScope Context merge. Cross-plugin collaboration goes
// through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { AgentLoopCard } from './AgentLoopCard.tsx'
import { BashCard } from './BashCard.tsx'
import { ConfigurablePluginsTab } from './ConfigurablePluginsTab.tsx'
import { PluginsSettingsSection } from './PluginsSettingsSection.tsx'
import { SubagentLimitsCard } from './SubagentLimitsCard.tsx'
import { SubagentModelSelectionCard } from './SubagentModelSelectionCard.tsx'
import { WebFetchCard } from './WebFetchCard.tsx'
import { WebProvidersCard } from './WebProvidersCard.tsx'
import { WebSearchCard } from './WebSearchCard.tsx'
import { WebToolsCard } from './WebToolsCard.tsx'
import { AGENT_LOOP_NS, AgentLoopCardController } from './agent-loop-card-controller.ts'
import { SHELL_NS, BashCardController } from './bash-card-controller.ts'
import { ConfigurablePluginsTabController } from './tab-store.ts'
import { SUBAGENT_NS, SubagentLimitsCardController } from './subagent-limits-card-controller.ts'
import {
  SUBAGENT_MODEL_SELECTION_NS, SubagentModelSelectionCardController,
} from './subagent-model-selection-card-controller.ts'
import { WEB_FETCH_HTTP_NS, WebFetchCardController } from './web-fetch-card-controller.ts'
import { WEB_NS, WebProvidersCardController } from './web-providers-card-controller.ts'
import { WEB_SEARCH_NS, WebSearchCardController } from './web-search-card-controller.ts'
import { TOOL_WEB_NS, WebToolsCardController } from './web-tools-card-controller.ts'
import { en, zh } from './locales.ts'

export type { PluginsSettingsSectionProps } from './PluginsSettingsSection.tsx'
export type { ConfigurablePluginsTabProps } from './ConfigurablePluginsTab.tsx'
export type { ConfigurablePluginsTabFace, ConfigurablePluginsTabState } from './tab-store.ts'
export type { PluginCardProps } from './PluginCard.tsx'
export type { SettingsPluginItemOwnerProps } from './slot-contract.ts'
export type { FieldProps } from './fields.tsx'
export type {
  CardActions, CardFieldSpec, CardFieldState, CardSecretSpec, CardShell,
} from './card-form.ts'
export type { AgentLoopCardFace, AgentLoopCardState } from './agent-loop-card-controller.ts'
export type { BashCardFace, BashCardState } from './bash-card-controller.ts'
export type { WebSearchCardFace, WebSearchCardState } from './web-search-card-controller.ts'
export type { WebToolsCardFace, WebToolsCardState } from './web-tools-card-controller.ts'
export type { WebFetchCardFace, WebFetchCardState } from './web-fetch-card-controller.ts'
export type { WebProvidersCardFace, WebProvidersCardState } from './web-providers-card-controller.ts'
export type { SubagentLimitsCardFace, SubagentLimitsCardState } from './subagent-limits-card-controller.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.plugins'

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'locale', 'remote', 'remote.credentials', 'remote.session', 'settingsScope',
]

/**
 * Mount the plugin configuration section and the cards this package ships.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugins: section dictionaries')

  const bash = new BashCardController(ctx.settingsScope.bind({ namespace: SHELL_NS }))
  const agentLoop = new AgentLoopCardController(ctx.settingsScope.bind({ namespace: AGENT_LOOP_NS }))
  const webSearch = new WebSearchCardController(
    ctx.settingsScope.bind({ namespace: WEB_SEARCH_NS }), ctx)
  const webTools = new WebToolsCardController(ctx.settingsScope.bind({ namespace: TOOL_WEB_NS }))
  const webFetch = new WebFetchCardController(ctx.settingsScope.bind({ namespace: WEB_FETCH_HTTP_NS }))
  const webProviders = new WebProvidersCardController(ctx.settingsScope.bind({ namespace: WEB_NS }))
  const subagentLimits = new SubagentLimitsCardController(
    ctx.settingsScope.bind({ namespace: SUBAGENT_NS }))
  const subagentModelSelection = new SubagentModelSelectionCardController(
    ctx.settingsScope.bind({ namespace: SUBAGENT_MODEL_SELECTION_NS }),
    ctx,
  )

  // The credential a card reports is not part of any settings section, so its
  // scope publishes nothing when one is written. This is the only signal that
  // a key written on another surface reached the Host.
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => { webSearch.refreshCredential(ref) }),
    'ui-settings-plugins: credential invalidations',
  )
  ctx.effect(
    () => ctx.remote.$on('llm/adapters-updated', () => { subagentModelSelection.refreshCatalog() }),
    'ui-settings-plugins: subagent adapter invalidations',
  )
  ctx.effect(
    () => ctx.remote.$on('settings/document-updated', () => { subagentModelSelection.refreshCatalog() }),
    'ui-settings-plugins: subagent settings invalidations',
  )
  ctx.effect(
    () => ctx.on('connection/reset', () => { subagentModelSelection.resetConnection() }),
    'ui-settings-plugins: subagent connection generation',
  )
  ctx.effect(() => () => { subagentModelSelection.dispose() }, 'ui-settings-plugins: subagent preference')

  // The shared SettingsScope mirror updates after document commits and reconnects.
  const configurable = new ConfigurablePluginsTabController(
    ctx.settingsScope.describe(), () => ctx.slots.entries('settings.plugin.item'))
  ctx.effect(() => () => { configurable.dispose() }, 'ui-settings-plugins: configurable view directory')
  // A card registered after the first read joins the list without a wire call.
  ctx.effect(
    () => ctx.slots.subscribe('settings.plugin.item', () => { configurable.refresh() }),
    'ui-settings-plugins: card ledger',
  )

  // This package owns the one Plugins navigation entry and the page chrome;
  // feature plugins contribute the page body without competing for nav rows.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugins',
    order: 15,
    label: () => t('nav'),
    icon: 'puzzle',
    place: 'both',
    navOrder: 0,
    settingsOrder: 7,
    locale: NS,
    children: { 'settings.plugins.body': { kind: 'list', scope: 'root' } },
  }, PluginsSettingsSection))

  // The configuration views stack inside the page body's collapsed system
  // region. This registration keeps ownership of the card slot and of the
  // shipped card contributions below.
  ctx.slots.inject('settings.plugins.system', () => ctx.slots.register({
    name: 'settings.plugins.system',
    id: 'configurable',
    order: 0,
    locale: NS,
    inject: () => configurable.inject(),
    children: { 'settings.plugin.item': { kind: 'keyed', scope: 'root' } },
  }, ConfigurablePluginsTab))

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: SHELL_NS,
      locale: NS,
      inject: () => bash.inject(),
    }, BashCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: AGENT_LOOP_NS,
      locale: NS,
      inject: () => agentLoop.inject(),
    }, AgentLoopCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: SUBAGENT_NS,
      locale: NS,
      inject: () => subagentLimits.inject(),
    }, SubagentLimitsCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: SUBAGENT_MODEL_SELECTION_NS,
      locale: NS,
      inject: () => subagentModelSelection.inject(),
    }, SubagentModelSelectionCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: WEB_SEARCH_NS,
      locale: NS,
      inject: () => webSearch.inject(),
    }, WebSearchCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: TOOL_WEB_NS,
      locale: NS,
      inject: () => webTools.inject(),
    }, WebToolsCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: WEB_FETCH_HTTP_NS,
      locale: NS,
      inject: () => webFetch.inject(),
    }, WebFetchCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: WEB_NS,
      locale: NS,
      inject: () => webProviders.inject(),
    }, WebProvidersCard)
  })
}
