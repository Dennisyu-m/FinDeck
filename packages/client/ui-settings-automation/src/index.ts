/**
 * Host half: validate the configured switch groups against the live Loader
 * and publish them for `pluginPatch.scheduledGroups`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'

/** One switch and the Loader entry ids it turns together. */
export interface SwitchGroup {
  /** Stable group id. The page maps known ids onto locale copy. */
  id: string
  /** Loader entry ids. Every id must exist in the current composition. */
  entries: string[]
  /** Bundle-layer default; absent means on. A default-off group reads off until a user row enables it. */
  defaultOn?: boolean
}

/** Plugin config: the switch groups. Membership is configuration, not code. */
export interface Config {
  /** One switch and the Loader entry ids it turns together. */
  groups: SwitchGroup[]
}

/** Validated config. */
export const Config: z<Config> = z.object({
  groups: z.array(z.object({
    id: z.string(),
    entries: z.array(z.string()),
    defaultOn: z.boolean().default(true),
  })),
})

export const name = 'ui-settings-automation'

/** The host half reads the Loader. */
export const inject = ['loader']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Switch groups from the automation settings plugin, when it is loaded. */
    automationSwitchGroups: readonly SwitchGroup[]
  }
}

/**
 * Fail at load when a configured id is not in this composition, then publish
 * the groups for the patch gateway.
 * @param ctx - host context.
 * @param config - validated switch groups.
 */
export function apply(ctx: Context, config: Config): void {
  const known = new Set<string>()
  for (const entry of ctx.loader.entries()) {
    if (typeof entry.options.id === 'string') known.add(entry.options.id)
  }
  for (const group of config.groups) {
    for (const id of group.entries) {
      if (!known.has(id)) {
        throw new Error(
          `ui-settings-automation: group "${group.id}" names loader id "${id}", which is not in the current composition`,
        )
      }
    }
  }
  ctx.reflect.provide('automationSwitchGroups', config.groups)
}
