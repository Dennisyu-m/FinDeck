/**
 * FinDeck shell plugin, browser half: one register() call contributes
 * ShellFrame into the runtime's built-in 'root' slot and, in the same breath,
 * re-declares the occupant-facing holes the replaced entries owned
 * (conversation, details, shell.overlay from ui-layout; sidebar.workspaces
 * from ui-sidebar) plus the new full-page hole 'shell.page', seats the shell
 * store (page route + chrome toggles), and wires the panel-action service
 * face. ctx.layout keeps the contract ui-layout declared (the details pair;
 * sidebar toggle is a documented no-op under the fixed-width column). A
 * second effect seats the theme presenter, which projects ctx.theme
 * snapshots onto document.body (moved here from ui-layout with the shell
 * replacement). The apply world also owns the sidebar's service-restart
 * controller, which drives the host's `system` Remote namespace and reloads
 * this page once a replacement connection generation arrives.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the ctx.remote merge (settings read/write + forwarded events).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ShellActions } from './service.ts'
import { ShellFrame } from './ShellFrame.tsx'
import { createShellStore } from './stores.ts'
import { ShellLayoutController } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'
import { shellFrameInjected } from './contract/inject.ts'
import { RestartController } from './restart.ts'
import { UserProfileController, USER_PROFILE_NAMESPACE } from './user-profile.ts'
import { chromeRows, type ChromeLists } from './chrome.ts'
import { en, zh, type ShellKey } from './locales.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

// Contract exports only (export-convergence rule): the shell store factory
// stays package-internal; consumers type against the store's return type via
// the component's composed props.
export type { ShellKey } from './locales.ts'
export type { ShellPageOwnerProps, ShellRightbarOwnerProps } from './contract/slots.ts'
export type { RightbarLayoutFace } from './service.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shell chrome copy (tabs, nav, settings box, user card). */
    shell: ShellKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Ask the shell to navigate the main area to one full-page section —
     * the cross-package route to a Settings page from any seat (the model
     * picker's "add more models" entry).
     * @param id - the `settings.section` id to open.
     * @mode emit
     */
    'shell/open-section'(id: string): void
    /**
     * The primary nav action while a page-specific variant is shown: the
     * shell chrome knows which section it is on, not what restarting that
     * section's subject means, so it emits and the owner reacts — the
     * roundtable section releases its running table and returns to the
     * open-table setup.
     * @mode emit
     */
    'shell/new-roundtable'(): void
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'shell'

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
export const inject = ['slots', 'theme', 'locale', 'uiWorkspace', 'remote', 'remote.settings', 'connection']

/**
 * Client plugin body: provide ctx.layout, then one register() call —
 * ShellFrame into 'root' with the hole declarations, the shell store seat,
 * and the inject hook that hands the store's bound actions to the service.
 * @param ctx - client root context.
 */
/** Live nav and settings-rail rows. The snapshot object changes only when the ledger or locale does. */
function sectionLists(ctx: ClientContext): HostObservable<ChromeLists> {
  let version = -1
  let revision = -1
  let snapshot: ChromeLists = { nav: [], settings: [] }
  return {
    getSnapshot: () => {
      const nextVersion = ctx.slots.getVersion('settings.section')
      const nextRevision = ctx.locale.getSnapshot().revision
      if (nextVersion !== version || nextRevision !== revision) {
        version = nextVersion
        revision = nextRevision
        const entries = ctx.slots.entries('settings.section')
        snapshot = { nav: chromeRows(entries, 'nav'), settings: chromeRows(entries, 'settings') }
      }
      return snapshot
    },
    subscribe: (listener) => {
      const offLedger = ctx.slots.subscribe('settings.section', listener)
      const offLocale = ctx.locale.subscribe(listener)
      return () => {
        offLedger()
        offLocale()
      }
    },
  }
}

export function apply(ctx: ClientContext): void {
  const layout = new ShellLayoutController()
  const userProfile = new UserProfileController(ctx)
  const restart = new RestartController(ctx)
  const sections = sectionLists(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-shell: dictionaries')
  // The user card's name: load once at boot and refresh when the namespace
  // moves elsewhere (another window renamed it, or an editor wrote it).
  ctx.effect(() => {
    void userProfile.load()
    const off = ctx.remote.$on('settings/document-updated', (ns) => {
      if (ns === USER_PROFILE_NAMESPACE) void userProfile.load()
    })
    return () => { off() }
  }, 'ui-shell: user profile refresh')
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeSectionEvents = ctx.on('shell/open-section', (id) => { layout.openSection(id) })
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      locale: NS,
      children: {
        // Re-declarations of the holes the replaced shell entries owned: the
        // shipped occupants (ui-conversation, ui-chat's details panel,
        // ui-workspace's browser) mount unchanged under the new chrome. A
        // profile that mounts ui-layout or ui-sidebar alongside this shell
        // fails loud here on the declaration conflict — two navigation
        // columns is a composition error, not a state to render through.
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        // The shell's one new hole: full-page content over the settings
        // section registry (occupied by ui-settings-general's page host).
        'shell.page': { kind: 'single', scope: 'root' },
        // Per-section sidebar content: an entry keyed by the active section
        // id replaces the workspaces region for that page.
        'sidebar.section': { kind: 'list', scope: 'root' },
        // The right column beside the conversation, occupied by
        // ui-sidebar-right (the docking surface); it reports its own
        // presentation back through ctx.layout and the shell sizes the track.
        'shell.rightbar': { kind: 'single', scope: 'root' },
      },
      // Exclusive store: the framework instantiates per entry and delivers
      // useStore/actions to ShellFrame as standard props.
      store: createShellStore,
      // The hook's only side effect connects the root store to ctx.layout;
      // page business belongs to the sections the page hole renders.
      inject: (actions: ShellActions) => {
        layout.attachActions(actions)
        return shellFrameInjected(ctx, userProfile, restart, sections)
      },
    }, ShellFrame)
    return () => {
      disposeRegistration()
      disposeSectionEvents()
      // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
      void disposeService()
    }
  }, 'ui-shell: service + root registration')

  // Theme presentation: pure DOM writes from resolved snapshots — initial
  // state through the getter once, then event-driven only; no React path.
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-shell: theme presenter')
}
