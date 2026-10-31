/**
 * Skills settings plugin, browser half. It registers the Skills page into the
 * settings navigation and owns the page store over the Host's
 * `skillsAdmin` Remote namespace: the inventory of every discoverable skill,
 * the durable enable switch per skill, the manual rescan, the inline skill
 * editor (create/edit/delete), the curated gallery, external-root imports,
 * and the create-from-sessions forge, which hands the Host's seed prompt to a
 * fresh session. The Host owns the skill facts and applies every write to the
 * skill registry, so this page never filters a catalog itself. The plugin also
 * provides the skill-forge intake the composer's mode pick consults and mounts
 * that flow's picker into the shell overlay, so the same dialog serves the
 * Skills page and a conversation.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry, the
// 'shell.overlay' seat) and the ctx.settingsScope service merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge and the generated skillsAdmin and
// sessionsAdmin namespaces into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the `ctx.sessions` merge the forge hand-off drives.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { ForgeDialog } from './ForgeDialog.tsx'
import { SkillsSection } from './SkillsSection.tsx'
import type { SkillsSectionInjected } from './SkillsSection.tsx'
import {
  SKILLS_SETTINGS_NAMESPACE, SkillsSettingsStore, type SkillsSettingsSection,
} from './store.ts'
import { en, zh, type SkillsKey } from './locales.ts'

export type { SkillsSectionInjected, SkillsSectionProps } from './SkillsSection.tsx'
export type { SkillsKey } from './locales.ts'
export type { SkillsSettingsSection, SkillsSettingsState } from './store.ts'

/** The skill-forge intake face, consumed by the composer's mode pick. */
export interface SkillForgeServiceContract {
  /**
   * Claim one mode pick for this flow: the forge mode is served by its own
   * session picker, never by switching the session the user is reading.
   * @param presetId - the preset id the caller picked.
   * @returns true when this intake owns that mode and opened its picker.
   */
  openFor(presetId: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The forge intake face (provided by this plugin's apply). */
    skillForge: SkillForgeServiceContract
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Skills page copy. */
    'settings.skills': SkillsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.skills'

/**
 * The shipped skill-forge preset id, mirroring the Host's own
 * `FORGE_AGENT_PRESET`. The client routes a mode pick with it only; which
 * preset the forge session is composed from stays the Host's answer.
 */
const FORGE_PRESET_ID = 'skill-forge'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on that slot through `slots.inject()`.
 */
export const inject = [
  'slots', 'locale', 'sessions', 'remote', 'remote.skillsAdmin', 'remote.sessionsAdmin', 'settingsScope',
]

/**
 * Register the Skills section once the `settings.section` declaration is on the
 * ledger and keep the page store wired to the bound settings namespace's
 * writability.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skills: copy dictionaries')

  const controller = new SkillsSettingsStore(ctx)
  // Bound here, where `settingsScope` and `remote` are declared in this
  // plugin's own `inject`; the section receives callbacks and never a context.
  const scope = ctx.settingsScope.bind<SkillsSettingsSection>({ namespace: SKILLS_SETTINGS_NAMESPACE })
  ctx.effect(() => {
    const adopt = (): void => { controller.adoptWritable(scope.getSnapshot().writable) }
    adopt()
    return scope.subscribe(adopt)
  }, 'ui-settings-skills: settings namespace writability')

  // Registration-time text (the nav label thunk) and the inject face share one
  // bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as SkillsSectionInjected['t']
  const face = (): SkillsSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    t,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 25,
    label: () => t('nav'),
    icon: 'sparkle',
    place: 'settings',
    settingsOrder: 3,
    inject: face,
  }, SkillsSection))

  // The forge flow's two other entry points: the composer's mode pick claims
  // the forge mode through this service, and the picker it opens mounts in the
  // frame-wide overlay so a conversation needs no settings page open.
  ctx.effect(() => ctx.provide('skillForge', {
    openFor: (presetId: string): boolean => {
      if (presetId !== FORGE_PRESET_ID) return false
      controller.openForgeDialog()
      return true
    },
  }), 'ui-settings-skills: forge intake')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'skills-forge-dialog',
    inject: face,
  }, ForgeDialog))
}
