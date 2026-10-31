/**
 * Agent-preset surface plugin, browser half — the settings section that
 * manages the roster (copy, delete, default, the way into a preset's own
 * files, and the creator entry that stages the self-referential preset and
 * starts a session on it).
 *
 * The composer surfaces this package once mounted (the new-session hero chip
 * and the session-header label) are gone with the shell rebuild: the
 * session-page mode entry is ui-mode's selector alone, so a running session
 * switches modes through it and a fresh session lands on the deployment
 * default (UI rework 5.2 item 1 — one mode entry per page, no duplicates).
 */

// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the Workspace UI navigation service merge (ctx.uiWorkspace).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { AgentPresetSection } from './AgentPresetSection.tsx'
import type { AgentPresetSectionInjected } from './AgentPresetSection.tsx'
import { AgentPresetSectionController } from './section-store.ts'
import { AgentPresetSeatController } from './seat-store.ts'
import { en, zh, type AgentPresetSettingsKey } from './locales.ts'
import { AGENT_PRESET_SETTINGS_NS, AgentPresetSettingsController } from './settings-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent-preset surface copy. */
    'settings.agentPreset': AgentPresetSettingsKey
  }
}

export type { AgentPresetSectionInjected, AgentPresetSectionProps } from './AgentPresetSection.tsx'
export { AgentPresetSeatController } from './seat-store.ts'
export {
  draftBlocker, type AgentPresetSectionState, type CopyDraft, type PresetRow, type PresetView,
} from './section-store.ts'
export type { AgentPresetOption, AgentPresetSettingsState } from './settings-store.ts'
export { AGENT_PRESET_SETTINGS_NS, writeDefaultPreset } from './settings-store.ts'

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'locale', 'remote', 'remote.agentPresets', 'remote.settings',
]

/**
 * Mount the roster settings section and the creator-draft stage it lands on.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new AgentPresetSettingsController(ctx)
  const section = new AgentPresetSectionController(ctx, () => { void controller.load() })

  ctx.effect(() => ctx.locale.register('settings.agentPreset', { zh, en }), 'ui-agent-preset: settings row dictionaries')

  ctx.effect(() => {
    // The roster is a live directory and the default is a settings field, so
    // both an external settings edit and a reconnect can move this row.
    const refresh = (): void => {
      void controller.load()
      // The section reads the same roster and marks the same default, so a
      // change made from either surface converges both.
      if (section.store.getSnapshot().status !== 'idle') void section.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        refresh()
      }),
      ctx.on('connection/reset', () => { refresh() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-agent-preset: settings refresh')

  // The settings section's conversational authoring entry: stage the
  // self-referential preset and land a new session on it. Bound inside the
  // conversation scope below (the session flow lives there) and unbound with
  // it, so the section's face reads the current binding per render and simply
  // hides the button while no flow exists.
  let creatorDraft: (() => void) | undefined

  ctx.inject(['conversation', 'sessions', 'uiWorkspace'], (scope: ClientContext) => {
    const seat = new AgentPresetSeatController(scope, () => {
      const state = scope.sessions.list.getSnapshot()
      return state.current === undefined ? undefined : state.byId[state.current]
    })

    scope.effect(() => {
      // Connecting a workspace either creates a blank session or reuses one,
      // and either way the creator entry's stage predates it — so the stage is
      // applied when the session arrives, not when it was made.
      const stop = scope.sessions.list.subscribe(() => { void seat.apply() })
      // Stage WITHOUT applying — the still-current running session would
      // refuse the swap and drop the stage — then start the session it lands
      // on: the list-change applier composes the blank session the workspace
      // connect produces or reuses.
      creatorDraft = () => {
        seat.stage('cordis')
        scope.uiWorkspace.startSession()
      }
      return () => {
        stop()
        creatorDraft = undefined
      }
    }, 'ui-agent-preset: creator-draft stage')
  })

  const sectionInjected = (): AgentPresetSectionInjected => ({
    hooks: { agentPresetSection: section.store },
    load: () => section.load(),
    view: (id: string) => section.view(id),
    closeView: () => { section.closeView() },
    beginCopy: (from: string) => { section.beginCopy(from) },
    cancelCopy: () => { section.cancelCopy() },
    setCopyId: (id: string) => { section.setCopyId(id) },
    setCopyName: (name: string) => { section.setCopyName(name) },
    confirmCopy: () => section.confirmCopy(),
    openLocation: (id: string) => section.openLocation(id),
    ...creatorDraft === undefined ? {} : { startCreatorDraft: creatorDraft },
    confirmDelete: (id: string | null) => { section.confirmDelete(id) },
    remove: () => section.remove(),
    makeDefault: (id: string) => section.makeDefault(id),
  })

  // Ordered after Models: choosing a model is routine, and composing an
  // agent is the deployment-shaping act behind it.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'agent-presets',
    order: 20,
    label: () => ctx.locale.bind('settings.agentPreset')('rail'),
    icon: 'mask',
    place: 'settings',
    settingsOrder: 9,
    locale: 'settings.agentPreset',
    inject: sectionInjected,
  }, AgentPresetSection))
}
