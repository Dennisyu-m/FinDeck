/**
 * The project management page plugin: one `settings.section` row over the
 * `workspace` Remote namespace plus the layer-marked `agentPresets.rosterFor`
 * read. The row lists the Host's projects (the Workspace entity) with their
 * project directories and managed subdirectories, and lets the operator
 * rename, repoint, reset, create, and inspect a project's preset layer.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `remote.workspace` / `remote.agentPresets` /
// `remote.directoryPicker` namespace merges the adapters below drive.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ProjectsPage, type ProjectsPageProps } from './ProjectsPage.tsx'
import { en, zh, type ProjectsLocaleKey } from './locales.ts'

export type { ProjectsLocaleKey } from './locales.ts'
export type { ProjectsPageInjected, ProjectsPageProps } from './ProjectsPage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project management page copy. */
    'ui.projects': ProjectsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ui.projects'

/** Required services: slot surfaces, locale, and the mounted Remote faces the page drives. */
export const inject = [
  'slots', 'locale', 'remote', 'remote.workspace', 'remote.agentPresets', 'remote.directoryPicker',
]

/**
 * Register the page's dictionary and its `projects` settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-projects: dictionaries')

  const t = ctx.locale.bind(NS)

  /**
   * Resolve one Remote answer or throw the Host's own failure. Every adapter
   * below reports a failure by rejection, which is what the page's dialogs and
   * inline error lines render.
   */
  const value = <T>(label: string, result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (result.ok) return result.value
    throw new Error(`${label} failed: ${result.error.code}: ${result.error.message}`)
  }

  const renameProject: ProjectsPageProps['renameProject'] = async (workspaceId, title) => {
    value('workspace.rename', await ctx.remote.workspace.rename({ workspaceId, title }))
  }
  const setProjectDir: ProjectsPageProps['setProjectDir'] = async (workspaceId, path) => {
    value('workspace.setProjectDir', await ctx.remote.workspace.setProjectDir({ workspaceId, path }))
  }
  const resetProjectDir: ProjectsPageProps['resetProjectDir'] = async (workspaceId) => {
    value('workspace.resetProjectDir', await ctx.remote.workspace.resetProjectDir({ workspaceId }))
  }
  const ensureProject: ProjectsPageProps['ensureProject'] = async (workspaceId) =>
    value('workspace.ensureProject', await ctx.remote.workspace.ensureProject({ workspaceId }))
  const createProject: ProjectsPageProps['createProject'] = async (path) =>
    value('workspace.create', await ctx.remote.workspace.create({ path })).workspace
  /**
   * Open the host directory picker. This is the same Remote call the
   * ui-workspace plugin makes for its own picking flow; a composed backend
   * without the native capability rejects, and the dialog keeps its typed path
   * field as the fallback.
   */
  const pickDirectory: ProjectsPageProps['pickDirectory'] = async () =>
    value('directoryPicker.pick', await ctx.remote.directoryPicker.pick())
  const loadPresets: ProjectsPageProps['loadPresets'] = async (cwd) =>
    value('agentPresets.rosterFor', await ctx.remote.agentPresets.rosterFor({ cwd }))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'projects',
    order: 3,
    label: () => t('nav'),
    icon: 'folder',
    place: 'settings',
    settingsOrder: 2,
    locale: NS,
    inject: () => ({
      renameProject, setProjectDir, resetProjectDir, ensureProject, createProject, pickDirectory, loadPresets,
    }),
  }, ProjectsPage))
}
