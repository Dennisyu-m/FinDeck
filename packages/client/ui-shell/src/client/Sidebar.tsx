/**
 * Sidebar column of the FinDeck shell: the research/roundtable tab pair,
 * the direct nav block (new session, plugins, schedule, research assets), the
 * workspace browsing region (rendered by the `sidebar.workspaces` occupant —
 * ui-workspace's browser keeps every session interaction), the settings entry
 * that opens the shell's settings dialog, and the user card. Pure composition
 * face over plain props threaded from the root shell entry (see
 * ShellFrame.tsx); page navigation is `section` ids (undefined =
 * conversation), and the roundtable tab is the 'roundtable' section.
 */
import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChromeRow } from './chrome.ts'
import { ShellIcon } from './icons.tsx'
import css from './Sidebar.module.css'

/** Props threaded from the root shell entry (state, callbacks, delegated slots, locale seat). */
export interface SidebarProps {
  /** Active full-page section id (undefined = conversation view). */
  section: string | undefined
  /** Whether the column is collapsed out of the frame (the frame's band then carries the expand affordance). */
  collapsed: boolean
  /** Collapse the column out of the frame; hidden on the desktop shell, whose band owns the toggle. */
  onToggleSidebar: () => void
  /** Navigate to a full page by section id. */
  onOpenSection: (id: string) => void
  /** Leave any page for the conversation (the research tab while on roundtable). */
  onShowConversation: () => void
  /** Start a new session (the workspace service's shared action). */
  startSession: () => void
  /**
   * Start a new roundtable: the same primary action while the roundtable
   * section is open, released back to the section's owner.
   */
  newRoundtable: () => void
  /** Whether the settings dialog is open (the entry reads as active while it is). */
  settingsOpen: boolean
  /** Open the settings dialog directly; there is no intermediate expansion. */
  onOpenSettings: () => void
  /** Delegated workspaces-region render call (authorization stays with the root entry). */
  renderWorkspaces: PropsRenderSlots<'sidebar.workspaces'>['renderSlot']
  /** Delegated per-section sidebar render call; an entry keyed by the active section replaces the workspaces region. */
  renderSectionSidebar: PropsRenderSlots<'sidebar.section'>['renderSlot']
  /** Top-nav pages from live `settings.section` registrations. */
  navItems: readonly ChromeRow[]
  /** Locale seat of the shell namespace. */
  t: PropsLocale<'shell'>['t']
  /** The user's display name (empty renders the localized default). */
  displayName: string
  /** Whether a rename write is in flight. */
  renaming: boolean
  /** The last failed rename's text, cleared when the card is next edited. */
  renameError: string | null
  /** Rename the user; resolves with the failure text, or undefined on success. */
  onRename: (name: string) => Promise<string | undefined>
  /** Clear a standing rename failure. */
  onDismissRenameError: () => void
}

/**
 * Render the sidebar column.
 * @param props - threaded shell state, callbacks, and the delegated slot call.
 * @returns the sidebar element tree.
 */
export function Sidebar({
  section, collapsed, onToggleSidebar, onOpenSection, onShowConversation, startSession, newRoundtable,
  settingsOpen, onOpenSettings, renderWorkspaces, renderSectionSidebar, navItems, t, displayName, renaming, renameError,
  onRename, onDismissRenameError,
}: SidebarProps): ReactNode {
  const roundtable = section === 'roundtable'
  const resolvedName = displayName === '' ? t('user.name') : displayName
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const beginEdit = (): void => {
    setDraft(resolvedName)
    setEditing(true)
    onDismissRenameError()
  }

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next === '' || next === displayName) return
    void onRename(next)
  }
  return (
    <aside className={css.side} data-collapsed={collapsed ? '' : undefined} aria-label={t('aside.label')}>
      <div className={css.tabs}>
        <button
          type="button"
          className={clsx(css.tab, !roundtable && css.on)}
          aria-pressed={!roundtable}
          onClick={() => { if (roundtable) onShowConversation() }}
        >
          {t('tab.research')}
        </button>
        <button
          type="button"
          className={clsx(css.tab, roundtable && css.on)}
          aria-pressed={roundtable}
          onClick={() => { if (!roundtable) onOpenSection('roundtable') }}
        >
          {t('tab.roundtable')}
        </button>
      </div>

      {/* The primary action follows the section: on the conversation it opens
          a blank session, on the roundtable it starts a new table (the
          section's owner releases the running one). */}
      <button
        type="button"
        className={css.navItem}
        onClick={() => {
          if (roundtable) newRoundtable()
          else { startSession(); onShowConversation() }
        }}
      >
        <ShellIcon name="plus" className={css.navIcon} />
        {roundtable ? t('nav.newRoundtable') : t('nav.newSession')}
      </button>
      {navItems.map(({ id, icon, label }) => (
        <button
          key={id}
          type="button"
          className={clsx(css.navItem, section === id && css.on)}
          aria-current={section === id ? 'page' : undefined}
          onClick={() => { onOpenSection(id) }}
        >
          <ShellIcon name={icon} className={css.navIcon} />
          {label}
        </button>
      ))}

      <div className={css.regionArea}>
        {/* A section that registered sidebar content (the roundtable's
            history) owns this region for as long as it is open; every other
            page — and the conversation — keeps the workspaces browser. */}
        {renderSectionSidebar('sidebar.section', {}, {
          only: section ?? '',
          fallback: renderWorkspaces('sidebar.workspaces', {
            wide: true,
            expandSidebar: () => {
              // Fixed-width column: the rail-expansion request cannot apply; the
              // occupant only issues it while collapsed, which never happens here.
            },
          }),
        })}
      </div>

      {/* The settings entry opens the shell's settings dialog directly; it
          carries no expansion of its own and no page list — the dialog holds
          that navigation (ShellFrame). */}
      <button
        type="button"
        className={clsx(css.navItem, css.settingsEntry, settingsOpen && css.on)}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={() => { onOpenSettings() }}
      >
        <ShellIcon name="sliders" className={css.navIcon} />
        {t('box.settings')}
      </button>

      <div className={css.userCard}>
        <div className={css.avatar} aria-hidden="true">{resolvedName.charAt(0)}</div>
        {editing
          ? (
            <input
              type="text"
              className={css.nameInput}
              value={draft}
              autoFocus
              maxLength={40}
              disabled={renaming}
              aria-label={t('user.renameAria')}
              onChange={(event) => { setDraft(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commit()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  onDismissRenameError()
                }
              }}
              onBlur={() => { setEditing(false) }}
            />
          )
          : (
            <button
              type="button"
              className={css.nameButton}
              title={t('user.renameHint')}
              onClick={() => { beginEdit() }}
            >
              {resolvedName}
            </button>
          )}
        {renaming && <span className={css.renaming} aria-hidden="true">{t('user.renaming')}</span>}
        {renameError !== null && (
          <span className={css.renameError} role="alert">{renameError}</span>
        )}
        {/* The frame's collapse toggle, at the end of the column's own bottom
            row: outside the desktop shell the control sits with the surface it
            acts on, and the frame's band carries the matching expand affordance
            while this column is out of the frame. The desktop shell's window
            keeps that band above every column and owns the toggle there, so
            this copy is hidden on that side (`.collapseToggle` in the
            stylesheet). */}
        <button
          type="button"
          className={css.collapseToggle}
          aria-label={t(collapsed ? 'sidebar.expand' : 'sidebar.collapse')}
          aria-expanded={!collapsed}
          title={t(collapsed ? 'sidebar.expand' : 'sidebar.collapse')}
          onClick={() => { onToggleSidebar() }}
        >
          <ShellIcon name={collapsed ? 'panelExpand' : 'panelCollapse'} size={16} />
        </button>
      </div>
    </aside>
  )
}
