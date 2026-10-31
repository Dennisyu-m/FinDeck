/**
 * Project `settings.section` registrations into the two shell lists.
 * A section appears only when its `place` names that list. The roundtable
 * page omits `place`: the shell tab reaches it.
 */
import type { SettingsSectionPlace, SlotLabel, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { isIconName, type IconName } from './icons.tsx'

/** Both shell lists, replaced together when the ledger or locale moves. */
export interface ChromeLists {
  /** Top navigation, in display order. */
  readonly nav: readonly ChromeRow[]
  /** Settings rail, in display order. The restart control is shell chrome and is not here. */
  readonly settings: readonly ChromeRow[]
}

/** One shell chrome row derived from a section registration. */
export interface ChromeRow {
  /** Section id. */
  readonly id: string
  /** Glyph the shell draws. */
  readonly icon: IconName
  /** Localized label from the registration. */
  readonly label: string
  /** Position within this list, ascending. */
  readonly order: number
}

/**
 * Rows of one shell list, in display order.
 * @param entries - the live `settings.section` ledger.
 * @param place - `nav` or `settings`.
 * @returns the rows whose `place` includes that list.
 */
export function chromeRows(entries: readonly StoredEntry[], place: 'nav' | 'settings'): ChromeRow[] {
  const rows: ChromeRow[] = []
  for (const entry of entries) {
    if (!listed(entry.options.place, place)) continue
    const icon = entry.options.icon
    const id = entry.options.id
    if (icon === undefined || !isIconName(icon) || id === undefined) continue
    const label = readLabel(entry.options.label)
    if (label === undefined || label === '') continue
    const order = place === 'nav' ? entry.options.navOrder : entry.options.settingsOrder
    rows.push({ id, icon, label, order: order ?? 0 })
  }
  rows.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  return rows
}

/** Whether a registration's place belongs on this list. */
function listed(place: SettingsSectionPlace | undefined, list: 'nav' | 'settings'): boolean {
  return place === 'both' || place === list
}

/** Read a registration label, including a locale thunk. */
function readLabel(label: SlotLabel | undefined): string | undefined {
  if (label === undefined) return undefined
  return typeof label === 'function' ? label() : label
}
