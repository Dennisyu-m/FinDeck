/**
 * Root shell frame of the FinDeck UI rebuild, contributed into the
 * runtime's built-in 'root' slot. Owns the two-column composition (sidebar +
 * main area), the page route (one `settings.section` id, or the conversation
 * when none), the settings dialog the sidebar's bottom entry opens (a centered
 * modal: the section rail, the selected page, and a close affordance), the
 * details drawer (the 'details' occupant, mounted behind a data attribute so
 * its state survives a close), the right column beside the conversation (the
 * 'shell.rightbar' occupant, sized from the track its own presentation reports
 * through `ctx.layout`), the click-through overlay layer, and the
 * window-controls band the desktop shell's hidden title bar leaves for its
 * native buttons. Session selection projects into navigation: opening a
 * session (a click in the workspaces browser) returns the main area to the
 * conversation.
 * Pure composition face: everything arrives through the four shares — zero
 * cordis or framework imports, zero self-made hooks.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseOutlineMedium, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconDefs, ShellIcon } from './icons.tsx'
import { Sidebar } from './Sidebar.tsx'
import { RIGHTBAR_DEFAULT_WIDTH, type createShellStore } from './stores.ts'
import type { ShellFrameInjected } from './contract/inject.ts'
import css from './ShellFrame.module.css'

/** Width of the fixed sidebar column (`.side` in Sidebar.module.css). */
const SIDEBAR_WIDTH = 236
/** Centre width the shell protects while the right column is open (ui-layout's CENTER_MIN). */
const RIGHTBAR_CENTER_MIN = 400
/** Narrowest right column the shell still shows (ui-layout's RIGHTBAR_MIN). */
const RIGHTBAR_MIN = 300
/** Widest right column, as a fraction of the frame (ui-layout's RIGHTBAR_MAX_RATIO). */
const RIGHTBAR_MAX_RATIO = 0.7

/**
 * The settings dialog's navigation rail, in rail order: the destination,
 * glyph, and dictionary key of every page the settings entry reaches. It is
 * the shell's own list rather than the whole `settings.section` ledger — this
 * fork also routes surfaces that are not settings panes through that registry
 * (the roundtable room, the research-assets and schedule pages), and those
 * keep their full-page layout instead of rendering inside the dialog. Every
 * entry names the section id its page is registered under.
 */
/** Full composed props: runtime share + child-slot render share + store share + inject face + locale seat. */
export type ShellFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'conversation' | 'details' | 'shell.overlay' | 'shell.rightbar' | 'sidebar.workspaces' | 'sidebar.section' | 'shell.page'>
  & PropsStore<ReturnType<typeof createShellStore>>
  & ShellFrameInjected
  & PropsLocale<'shell'>

/** The root shell frame (see module doc). */
export function ShellFrame({
  useStore,
  actions,
  useSessions,
  sections,
  renderSlot,
  SessionProvider,
  startSession,
  newRoundtable,
  productTitle,
  userProfile,
  serviceRestart,
  t,
}: ShellFrameProps): ReactNode {
  const section = useStore(s => s.section)
  const sidebarCollapsed = useStore(s => s.sidebarCollapsed)
  const settingsOpen = useStore(s => s.settingsOpen)
  const settingsSection = useStore(s => s.settingsSection)
  const detailsOpen = useStore(s => s.detailsOpen)
  const rightbarShown = useStore(s => s.rightbarShown)
  const rightbarTrack = useStore(s => s.rightbarTrack)
  const rightbarWidth = useStore(s => s.rightbarWidth)
  const viewportWidth = useStore(s => s.viewportWidth)
  const profile = useSyncExternalStore(
    onStoreChange => userProfile.hooks.userProfile.subscribe(onStoreChange),
    () => userProfile.hooks.userProfile.getSnapshot(),
  )
  const chrome = useSyncExternalStore(
    onStoreChange => sections.subscribe(onStoreChange),
    () => sections.getSnapshot(),
  )
  const restartStatus = useSyncExternalStore(
    onStoreChange => serviceRestart.hooks.restart.subscribe(onStoreChange),
    () => serviceRestart.hooks.restart.getSnapshot().status,
  )
  const [renameError, setRenameError] = useState<string | null>(null)

  // Opening a session anywhere (a click in the workspaces browser, a
  // follow-up surface) returns the main area to the conversation. Blank
  // sessions count too: they are the New Session view of the conversation
  // occupant. The id (not the session record) is the dependency: any current
  // change re-runs the no-op navigation for the conversation view.
  const currentSession = useSessions(s => s.current)
  useEffect(() => {
    if (currentSession !== undefined) actions.showConversation()
  }, [actions, currentSession])

  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  // Browser title: the selected session's durable title beside the product
  // title, restored to the bare product title with no session selected.
  const resolvedTitle = productTitle()
  useEffect(() => {
    document.title = documentTitle === undefined ? resolvedTitle : `${documentTitle} — ${resolvedTitle}`
    return () => { document.title = resolvedTitle }
  }, [documentTitle, resolvedTitle])

  // The frame's own measurement: the right column's owner share resolves
  // against it, and no other seat can read the viewport.
  useEffect(() => {
    const measure = (): void => { actions.setViewportWidth(window.innerWidth) }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [actions])

  // The frame's concession solve, stated as ui-layout's computeColumns states
  // it: the saved preference is clamped into its range and then shrunk to what
  // the centre leaves; the column disappears before the centre drops below its
  // minimum, and a viewport too narrow for one gets the occupant's own
  // fullscreen presentation instead.
  const rightbarAvailable = viewportWidth - SIDEBAR_WIDTH - RIGHTBAR_CENTER_MIN
  const rightbarResolvedWidth = rightbarAvailable < RIGHTBAR_MIN ? 0 : Math.min(
    rightbarAvailable,
    Math.min(
      Math.round(viewportWidth * RIGHTBAR_MAX_RATIO),
      Math.max(RIGHTBAR_MIN, rightbarWidth ?? RIGHTBAR_DEFAULT_WIDTH),
    ),
  )
  const rightbarCanShow = rightbarResolvedWidth > 0
  const rightbarReservesTrack = rightbarShown && rightbarTrack

  // The dialog's header names the page its rail shows; the settings title
  // stands in when the selected id is not one of the rail's pages.
  const activeSettingsLabel = chrome.settings.find(item => item.id === settingsSection)?.label
  const closeSettings = (): void => { actions.closeSettings() }

  return (
    <div className={css.frame}>
      <IconDefs />
      {/* The window-controls band: reserved height, no fill, drag-enabled (it
          hands the window back the drag region a hidden title bar loses). Its
          left end — where no window button sits — holds the sidebar toggle for
          the desktop shell, and the collapsed column's expand affordance in a
          plain browser tab, where the strip exists for that state alone (see
          the browser-tab rule in the stylesheet). */}
      <div className={css.titlebarSpace} data-shell-titlebar data-collapsed={sidebarCollapsed ? '' : undefined}>
        <button
          type="button"
          className={css.titlebarToggle}
          aria-label={t(sidebarCollapsed ? 'sidebar.expand' : 'sidebar.collapse')}
          aria-expanded={!sidebarCollapsed}
          title={t(sidebarCollapsed ? 'sidebar.expand' : 'sidebar.collapse')}
          onClick={() => { actions.toggleSidebar() }}
        >
          <ShellIcon name={sidebarCollapsed ? 'panelExpand' : 'panelCollapse'} size={16} />
        </button>
      </div>
      <Sidebar
        collapsed={sidebarCollapsed}
        section={section}
        onToggleSidebar={() => { actions.toggleSidebar() }}
        onOpenSection={(id) => { actions.openSection(id) }}
        onShowConversation={() => { actions.showConversation() }}
        startSession={startSession}
        newRoundtable={newRoundtable}
        settingsOpen={settingsOpen}
        onOpenSettings={() => { actions.openSettings() }}
        renderWorkspaces={renderSlot}
        renderSectionSidebar={renderSlot}
        navItems={chrome.nav}
        t={t}
        displayName={profile.displayName}
        renaming={profile.busy}
        renameError={renameError}
        onRename={name => userProfile.rename(name).then((failure) => {
          if (failure !== undefined) setRenameError(failure)
          return failure
        })}
        onDismissRenameError={() => { setRenameError(null) }}
      />
      <main className={css.main}>
        {section === undefined
          ? <div className={css.conversationArea}>{renderSlot('conversation', {})}</div>
          : settingsOpen
            /* The dialog owns the page hole while it is open: rendering the
               routed page here as well would mount one `settings.section`
               entry twice. */
            ? null
            : (
            <div className={css.pageArea}>
              {/* Page chrome (UI rebuild rework item: a full page is a route
                  state, not a modal — the back affordance is fixed chrome, and
                  any sidebar click navigates away without visiting it). */}
              <div className={css.pageBar}>
                <button
                  type="button"
                  className={css.backButton}
                  title={t('page.back')}
                  aria-label={t('page.back')}
                  onClick={() => { actions.showConversation() }}
                >
                  <ShellIcon name="back" size={16} />
                </button>
              </div>
              {/* The roundtable is a room, not a document: it lays out
                  full-bleed (the page owns its scrolling), while every other
                  section keeps the centered, shell-scrolled column. The shell
                  already routes this section by id (the tab pair in the
                  sidebar), so the layout follows the same knowledge. */}
              {section === 'roundtable'
                ? (
                  <div className={css.pageFill}>
                    {renderSlot('shell.page', {
                      sectionId: section,
                      close: () => { actions.showConversation() },
                      fullBleed: true,
                    })}
                  </div>
                )
                : (
                  <div className={css.pageScroll}>
                    <div className={css.pageColumn}>
                      {renderSlot('shell.page', {
                        sectionId: section,
                        close: () => { actions.showConversation() },
                        fullBleed: false,
                      })}
                    </div>
                  </div>
                )}
            </div>
          )}
      </main>
      {/* The settings dialog: the sidebar's bottom entry opens it directly,
          with no intermediate expansion. The shared Modal primitive owns the
          mask, the card, Escape, and the mask click; this frame draws the
          two-column interior (section rail + selected page) and the close
          affordance. The page renders through the same `shell.page` hole a
          route uses, so every `settings.section` registrant is unchanged. */}
      {settingsOpen && (
        <Modal
          open
          headless
          title={t('box.settings')}
          onClose={closeSettings}
          className={css.settingsDialog as string}
        >
          <nav className={css.settingsRail} aria-label={t('settings.region')}>
            {chrome.settings.map(({ id, icon, label }) => (
              <button
                key={id}
                type="button"
                className={clsx(css.settingsRailItem, id === settingsSection && css.settingsRailOn)}
                aria-current={id === settingsSection ? 'page' : undefined}
                onClick={() => { actions.selectSettingsSection(id) }}
              >
                <ShellIcon name={icon} className={css.settingsRailIcon} size={16} />
                {label}
              </button>
            ))}
            {/* Service lifecycle: the development pain this control removes is a
                rebuilt bundle still served by the process that started before
                it, so the request restarts that process rather than the page.
                It stays inside the settings surface, where the sidebar's
                settings box used to hide it. */}
            <button
              type="button"
              className={css.settingsRestart}
              disabled={restartStatus === 'restarting'}
              onClick={() => { serviceRestart.restart() }}
            >
              <ShellIcon name="restart" className={css.settingsRailIcon} size={16} />
              {restartStatus === 'restarting' ? t('restart.busy') : t('restart.label')}
            </button>
          </nav>
          <div className={css.settingsPanel}>
            <div className={css.settingsHeader}>
              <span className={css.settingsTitle}>
                {activeSettingsLabel ?? t('box.settings')}
              </span>
              <button
                type="button"
                className={css.settingsClose}
                aria-label={t('settings.close')}
                title={t('settings.close')}
                onClick={closeSettings}
              >
                <IconCloseOutlineMedium size={14} />
              </button>
            </div>
            <div className={css.settingsBody}>
              {renderSlot('shell.page', {
                sectionId: settingsSection,
                close: closeSettings,
                fullBleed: false,
              })}
            </div>
          </div>
        </Modal>
      )}
      <aside className={css.details} data-closed={detailsOpen ? undefined : ''}>
        <SessionProvider>{renderSlot('details', {})}</SessionProvider>
      </aside>
      {/* The right column: a track beside the conversation, sized from the
          occupant's reported presentation. The occupant draws the panel itself,
          anchored to the frame's right edge and sliding off it while
          collapsed, so this aside carries geometry only. */}
      <aside
        className={css.rightbar}
        data-rightbar-col
        style={{ width: rightbarReservesTrack ? rightbarResolvedWidth : 0 }}
      >
        {renderSlot('shell.rightbar', {
          width: rightbarResolvedWidth,
          viewportWidth,
          canShow: rightbarCanShow,
        })}
      </aside>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
    </div>
  )
}
