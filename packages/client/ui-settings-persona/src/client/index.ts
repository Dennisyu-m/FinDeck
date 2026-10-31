/**
 * Browser half: the editor of the `system-prompt` settings namespace,
 * mounted twice — as the `settings.general.item` row inside the System
 * settings page and as the dedicated `settings.section` page the shell's
 * System-prompt destination routes to. Both occurrences render the same
 * editor over the same namespace. The Host half of this package registers
 * that namespace and turns its value into prompt sections, so this half only
 * reads and writes the durable section.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CUSTOM_INSTRUCTIONS_FIELD, PERSONA_PREFIX_FIELD, PERSONA_SUFFIX_FIELD,
  SYSTEM_PROMPT_SETTINGS_NAMESPACE, type SystemPromptSettings,
} from '../persona-settings.ts'
import { SystemPromptRow, type SystemPromptDraft, type SystemPromptRowInjected } from './SystemPromptRow.tsx'
import { createSystemPromptRowStore } from './store.ts'
import { en, zh, type PersonaKey } from './locales.ts'

export type { PersonaKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** System-prompt personalization row copy. */
    'settings.systemPrompt': PersonaKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.systemPrompt'

/**
 * Required services: the slot surface the editor registers into, the locale
 * service behind `t`, and the settings-namespace scope the editor reads and
 * writes through.
 */
export const inject = ['slots', 'locale', 'settingsScope']

/** One mounted editor occurrence: its store handle and the slot registration's inject face. */
interface EditorOccurrence {
  store: ReturnType<typeof createSystemPromptRowStore>
  inject: (actions: BoundActions<ReturnType<typeof createSystemPromptRowStore>>) => SystemPromptRowInjected
}

/**
 * Register the editor's dictionary, and its two occurrences: the System
 * settings row and the System-prompt page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-persona: dictionaries')

  // The shared settings scope: reads derive from the describe mirror, writes
  // are revision-fenced Host mutations. Saves commit, then the mirror's new
  // revision re-seeds every mounted editor.
  const scope = ctx.settingsScope.bind<SystemPromptSettings>({ namespace: SYSTEM_PROMPT_SETTINGS_NAMESPACE })
  const t = ctx.locale.bind(NS)

  const save = async (draft: SystemPromptDraft): Promise<void> => {
    // One namespace, three scalar fields; the scope serializes them and
    // carries the latest revision on each.
    await Promise.all([
      scope.set(PERSONA_PREFIX_FIELD, draft.personaPrefix),
      scope.set(PERSONA_SUFFIX_FIELD, draft.personaSuffix),
      scope.set(CUSTOM_INSTRUCTIONS_FIELD, draft.customInstructions),
    ])
  }

  // Each occurrence owns its store handle and its own mirror subscription: the
  // store's only writer is the apply-world listener of the entry it was
  // mounted for, and the editor only reads.
  const occurrence = (): EditorOccurrence => {
    const store = createSystemPromptRowStore()
    let bound: BoundActions<typeof store> | undefined
    const mirror = (): void => { bound?.sync(scope.getSnapshot()) }
    ctx.effect(() => {
      const off = scope.subscribe(mirror)
      return () => {
        off()
        bound = undefined
      }
    }, 'ui-settings-persona: editor store mirror')
    return {
      store,
      inject: (actions): SystemPromptRowInjected => {
        bound = actions
        // Re-sync from the getter so no change is lost between this registration
        // and the first render.
        mirror()
        return { save }
      },
    }
  }

  const row = occurrence()
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'system-prompt',
    order: 30,
    store: row.store,
    locale: NS,
    inject: row.inject,
  }, SystemPromptRow))

  // The shell routes its System-prompt destination to the `system-prompt`
  // section id, so the same editor is also a page of its own; without this
  // registration that destination renders the missing-page notice.
  const page = occurrence()
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'system-prompt',
    order: 30,
    label: () => t('title'),
    icon: 'note',
    place: 'settings',
    settingsOrder: 6,
    store: page.store,
    locale: NS,
    inject: page.inject,
  }, SystemPromptRow))
}
