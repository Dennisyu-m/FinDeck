/**
 * Automation settings section. One switch per configured group. Work mode
 * is explanation only.
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Section.module.css'

/** One user-layer row the patch read returns. */
export interface PatchRow {
  readonly id: string
  readonly disabled?: boolean
}

/** One entry in a group write. */
export interface PatchWrite {
  readonly id: string
  readonly disabled: boolean | null
}

/** One switch group as the host published it. */
export interface SwitchGroupView {
  readonly id: string
  readonly entries: readonly string[]
  /** Bundle-layer default; absent means on. */
  readonly defaultOn?: boolean
}

export type AutomationSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.automation'>
  & {
    /** Read the configured groups. */
    readonly loadGroups: () => Promise<readonly SwitchGroupView[]>
    /** Read the user-layer disable facts. */
    readonly loadPatch: () => Promise<readonly PatchRow[]>
    /** Write the whole group in one call. */
    readonly writeGroup: (entries: readonly PatchWrite[]) => Promise<void>
    /** Reload the page after a successful write. The component does not touch window. */
    readonly reload: () => void
  }

type GroupState = 'on' | 'off' | 'mixed'

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly groups: readonly SwitchGroupView[]; readonly patch: readonly PatchRow[] }

function fill(text: string, message: string): string {
  return text.replaceAll('{message}', message)
}

/** A row is off only when the user layer sets disabled. Absence means the bundle default. */
function isOff(patch: readonly PatchRow[], id: string): boolean {
  return patch.some(row => row.id === id && row.disabled === true)
}

function isOn(patch: readonly PatchRow[], id: string): boolean {
  return patch.some(row => row.id === id && row.disabled === false)
}

function groupState(group: SwitchGroupView, patch: readonly PatchRow[]): GroupState {
  const defaultOn = group.defaultOn !== false
  const ons = group.entries.filter(id => defaultOn ? !isOff(patch, id) : isOn(patch, id)).length
  if (ons === group.entries.length) return 'on'
  if (ons === 0) return 'off'
  return 'mixed'
}

/** One switch row: title, blurb, and the group checkbox. */
function GroupRow({ label, blurb, state, stateLabel, busy, disabled, onToggle }: {
  readonly label: string
  readonly blurb: string
  readonly state: GroupState
  readonly stateLabel: string
  readonly busy: boolean
  readonly disabled: boolean
  readonly onToggle: () => void
}) {
  return (
    <div className={css.row}>
      <div>
        <p className={css.name}>{label}</p>
        <p className={css.blurb}>{blurb}</p>
      </div>
      <label className={css.control}>
        <input
          type="checkbox"
          checked={state === 'on'}
          disabled={busy || disabled}
          ref={element => { if (element) element.indeterminate = state === 'mixed' }}
          onChange={onToggle}
        />
        {busy ? null : stateLabel}
      </label>
    </div>
  )
}

/**
 * Render the automation settings page.
 * @param props - section props, locale, and the patch callbacks.
 * @returns the page element tree.
 */
export function AutomationSection({ t, loadGroups, loadPatch, writeGroup, reload }: AutomationSectionProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([loadGroups(), loadPatch()]).then(
      ([groups, patch]) => { if (alive) setLoad({ status: 'ready', groups, patch }) },
      (error: unknown) => {
        if (alive) setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { alive = false }
  }, [loadGroups, loadPatch])

  const groups = load.status === 'ready' ? load.groups : []
  const scheduled = groups.find(group => group.id === 'scheduled-tasks')
  const desk = groups.find(group => group.id === 'desk')
  const scheduledState = load.status === 'ready' && scheduled !== undefined
    ? groupState(scheduled, load.patch)
    : 'on'
  const deskState = load.status === 'ready' && desk !== undefined
    ? groupState(desk, load.patch)
    : 'off'

  const toggle = (group: SwitchGroupView | undefined, state: GroupState): void => {
    if (load.status !== 'ready' || group === undefined || saving !== null) return
    const disabled = state === 'on'
    setSaving(group.id)
    setSaveError(null)
    void writeGroup(group.entries.map(id => ({ id, disabled }))).then(
      () => { reload() },
      (error: unknown) => {
        setSaving(null)
        setSaveError(error instanceof Error ? error.message : String(error))
      },
    )
  }

  const stateLabel = (state: GroupState): string =>
    state === 'mixed' ? t('mixed') : state === 'on' ? t('on') : t('off')

  return (
    <div className={css.page}>
      <h2 className={css.title}>{t('nav')}</h2>
      {load.status === 'error'
        ? <p className={css.note} role="alert">{fill(t('loadFailed'), load.message)}</p>
        : null}
      {saveError !== null
        ? <p className={css.note} role="alert">{fill(t('saveFailed'), saveError)}</p>
        : null}
      <GroupRow
        label={t('scheduledTitle')}
        blurb={t('scheduledBlurb')}
        state={scheduledState}
        stateLabel={stateLabel(scheduledState)}
        busy={saving === 'scheduled-tasks'}
        disabled={load.status !== 'ready' || scheduled === undefined}
        onToggle={() => { toggle(scheduled, scheduledState) }}
      />
      {desk === undefined
        ? null
        : (
          <GroupRow
            label={t('deskTitle')}
            blurb={t('deskBlurb')}
            state={deskState}
            stateLabel={stateLabel(deskState)}
            busy={saving === 'desk'}
            disabled={load.status !== 'ready'}
            onToggle={() => { toggle(desk, deskState) }}
          />
        )}
      <div className={css.row}>
        <div>
          <p className={css.name}>{t('workTitle')}</p>
          <p className={css.blurb}>{t('workBlurb')}</p>
        </div>
      </div>
    </div>
  )
}
