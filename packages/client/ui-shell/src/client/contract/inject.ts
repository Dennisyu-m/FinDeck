/**
 * Registrant-private injected share of the root shell entry (arrives via the
 * register inject factory; plain data and callbacks only).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChromeLists } from '../chrome.ts'
import type { RestartController, RestartState } from '../restart.ts'
import type { UserProfileController, UserProfileState } from '../user-profile.ts'

/** How the shell's apply world exposes the workspace navigation action. */
export interface WorkspaceNavigation {
  /** Shared New Session action: reuse-or-create a blank session and open it. */
  startSession(): void
}

/** The user-card profile face: one store plus the read/write verbs. */
export interface ShellUserProfileInjected {
  /** The profile snapshot the card subscribes to. */
  hooks: { userProfile: SnapshotStore<UserProfileState> }
  /** Read the profile once (idempotent; errors land on the store). */
  load: () => void
  /** Rename the user; resolves with the failure text, or undefined on success. */
  rename: (name: string) => Promise<string | undefined>
}

/** The service-restart face: one store plus the request verb. */
export interface ShellServiceRestartInjected {
  /** The restart snapshot the sidebar control subscribes to. */
  hooks: { restart: SnapshotStore<RestartState> }
  /** Request one in-place restart of the host; ignored while one is in flight. */
  restart: () => void
}

/**
 * Build the root entry's injected share from the apply closure.
 * @param ctx - the plugin's client root context (uiWorkspace + locale live here).
 * @param userProfile - the apply-world profile controller.
 * @param restart - the apply-world service-restart controller.
 * @returns the injected callbacks for the shell frame component.
 */
export function shellFrameInjected(
  ctx: ClientContext,
  userProfile: UserProfileController,
  restart: RestartController,
  sections: HostObservable<ChromeLists>,
): ShellFrameInjected {
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  return {
    // The New Session button rides the Workspace UI's shared action (current
    // Session Workspace, then recent Workspace).
    startSession: () => { workspaceNavigation.startSession() },
    // The primary action's roundtable form: the shell chrome knows the section
    // it is on, not what restarting a table means, so it emits and the
    // roundtable surface owns the reaction.
    newRoundtable: () => { ctx.emit('shell/new-roundtable') },
    // Locale-following product title: bound per call, so a locale switch
    // re-renders with fresh text (the inject face itself is memoized). The
    // build-configured title (the findeck build profile) wins over the
    // localized one.
    productTitle: () => process.env.DSH_CLIENT_TITLE
      ?? ctx.locale.bind('common')('brand.localBuild'),
    userProfile: {
      hooks: { userProfile: userProfile.store },
      load: () => { void userProfile.load() },
      rename: (name: string) => userProfile.rename(name),
    },
    serviceRestart: {
      hooks: { restart: restart.store },
      restart: () => { restart.restart() },
    },
    sections,
  }
}

/** The root entry's injected share. */
export interface ShellFrameInjected {
  /** Start a New Session (reuse-or-create its blank session and open it). */
  startSession: () => void
  /**
   * The primary nav action's roundtable form (`New Roundtable`, shown while
   * the roundtable section is open): emits `shell/new-roundtable`, and the
   * roundtable plugin releases its running table back to the open-table setup.
   */
  newRoundtable: () => void
  /** Resolve the product title (build-configured title wins at the call site). */
  productTitle: () => string
  /** The user-card profile facts and verbs. */
  userProfile: ShellUserProfileInjected
  /** The sidebar's service-restart facts and verb. */
  serviceRestart: ShellServiceRestartInjected
  /** Live section lists for the top nav and the settings rail. */
  sections: HostObservable<ChromeLists>
}
