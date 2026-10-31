/**
 * The assets tab's two views: a card wall (default) and a compact table. Both
 * render one already-filtered, already-ordered snapshot; the page owns the
 * filter, the ordering, and the selection.
 *
 * A card carries exactly four elements — name + kind + freshness dot, one key
 * metric, a one-line description, and its primary action button; tags, origin,
 * and version details live on the detail page.
 */

import type { ReactNode } from 'react'
import type { AssetLibraryAsset } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  asOfOf, freshnessTone, keyMetricOf, libraryKinds, libraryOrigins, libraryTags, primaryVerbOf,
  type LibraryFilter, type LibrarySort,
} from './library.ts'
import { kindLocaleKey, originLocaleKey, verbLocaleKey } from './labels.ts'
import css from '../AssetsPage.module.css'

/** The ui.assets translate seat this package's components read. */
type Translate = TranslateNS<'ui.assets'>

/** Which of the two views the assets tab shows. */
export type AssetView = 'grid' | 'list'

/** The value a filter select shows when nothing is filtered. */
const ANY = ''

/** The kind label: the dictionary's word, or the manifest token verbatim. */
export function kindLabel(kind: string, t: Translate): string {
  const key = kindLocaleKey(kind)
  return key === null ? kind : t(key)
}

/** The origin label: the dictionary's word, or the manifest token verbatim. */
function originLabel(origin: string, t: Translate): string {
  const key = originLocaleKey(origin)
  return key === null ? origin : t(key)
}

/** The verb label: the dictionary's word, or the manifest token verbatim. */
function verbLabel(verb: string, t: Translate): string {
  const key = verbLocaleKey(verb)
  return key === null ? verb : t(key)
}

/** Full props of the assets tab's list/grid surface. */
export interface AssetsViewProps {
  /** The filtered, ordered assets to draw. */
  readonly assets: readonly AssetLibraryAsset[]
  /** Every asset in the library, for the count line and the filter options. */
  readonly all: readonly AssetLibraryAsset[]
  readonly filter: LibraryFilter
  readonly onFilter: (next: LibraryFilter) => void
  readonly view: AssetView
  readonly onView: (next: AssetView) => void
  readonly sort: LibrarySort
  readonly descending: boolean
  readonly onSort: (by: LibrarySort, descending: boolean) => void
  /** Open one asset's face. */
  readonly onSelect: (name: string) => void
  /** Open one asset's face with this verb spotlighted (the card's primary action). */
  readonly onAction: (name: string, verb: string) => void
  /** Whether the multi-select Work entry is active. */
  readonly selectMode: boolean
  /** Asset names currently selected for a Work mode. */
  readonly selected: readonly string[]
  /** Toggle one asset's selection. */
  readonly onToggleSelect: (name: string) => void
  readonly t: Translate
}

/** One filter dropdown; the first option is the unfiltered state, labelled per field. */
function FilterSelect({ label, value, options, anyLabel, onChange }: {
  readonly label: string
  readonly value: string
  readonly options: readonly string[]
  readonly anyLabel: string
  readonly onChange: (next: string) => void
}): ReactNode {
  return (
    <select
      className={css.filterSelect}
      aria-label={label}
      title={label}
      value={value}
      onChange={event => { onChange(event.currentTarget.value) }}
    >
      <option value={ANY}>{anyLabel}</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  )
}

/** The toolbar, one row: search, three filter dropdowns, sort, view icons, count. */
function Toolbar({ assets, all, filter, onFilter, view, onView, sort, descending, onSort, t }: AssetsViewProps): ReactNode {
  return (
    <div className={css.toolbar}>
      <input
        className={css.searchInput}
        aria-label={t('searchLabel')}
        value={filter.text}
        placeholder={t('searchPlaceholder')}
        onChange={event => { onFilter({ ...filter, text: event.currentTarget.value }) }}
      />
      <FilterSelect
        label={t('filterKind')}
        value={filter.kind}
        options={libraryKinds(all)}
        anyLabel={t('filterKindAll')}
        onChange={kind => { onFilter({ ...filter, kind }) }}
      />
      <FilterSelect
        label={t('filterOrigin')}
        value={filter.origin}
        options={libraryOrigins(all)}
        anyLabel={t('filterOriginAll')}
        onChange={origin => { onFilter({ ...filter, origin }) }}
      />
      <FilterSelect
        label={t('filterTag')}
        value={filter.tag}
        options={libraryTags(all)}
        anyLabel={t('filterTagAll')}
        onChange={tag => { onFilter({ ...filter, tag }) }}
      />
      <select
        className={css.filterSelect}
        aria-label={t('sortLabel')}
        title={t('sortLabel')}
        value={`${sort}:${descending ? 'desc' : 'asc'}`}
        onChange={(event) => {
          const [by, direction] = event.currentTarget.value.split(':')
          onSort(by === 'as_of' ? 'as_of' : 'name', direction === 'desc')
        }}
      >
        <option value="name:asc">{`${t('sortByName')} · ${t('sortAsc')}`}</option>
        <option value="name:desc">{`${t('sortByName')} · ${t('sortDesc')}`}</option>
        <option value="as_of:desc">{`${t('sortByAsOf')} · ${t('sortDesc')}`}</option>
        <option value="as_of:asc">{`${t('sortByAsOf')} · ${t('sortAsc')}`}</option>
      </select>
      <div className={css.iconToggle} role="group" aria-label={t('viewSwitchLabel')}>
        <button
          type="button"
          className={css.iconButton}
          aria-pressed={view === 'grid'}
          aria-label={t('viewGrid')}
          title={t('viewGrid')}
          onClick={() => { onView('grid') }}
        >
          ▦
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-pressed={view === 'list'}
          aria-label={t('viewList')}
          title={t('viewList')}
          onClick={() => { onView('list') }}
        >
          ☰
        </button>
      </div>
      <span className={css.countLine}>
        {assets.length === all.length
          ? t('libraryCount', { count: String(all.length) })
          : t('filteredCount', { shown: String(assets.length), total: String(all.length) })}
      </span>
    </div>
  )
}

/**
 * One card of the grid view, exactly four elements: the name row (freshness
 * dot, name, kind), one key metric when the manifest offers one, a one-line
 * description, and the primary verb's action button.
 */
function AssetCard({ asset, onSelect, onAction, selectMode, selected, onToggleSelect, t }: {
  readonly asset: AssetLibraryAsset
  readonly onSelect: (name: string) => void
  readonly onAction: (name: string, verb: string) => void
  readonly selectMode: boolean
  readonly selected: boolean
  readonly onToggleSelect: (name: string) => void
  readonly t: Translate
}): ReactNode {
  const tone = freshnessTone(asset)
  const metric = keyMetricOf(asset)
  const primary = primaryVerbOf(asset.verbs)
  return (
    <li className={css.gridCard} data-stale={asset.stale ? 'true' : undefined} data-selected={selected ? 'true' : undefined}>
      <span className={css.cardHead}>
        {selectMode
          ? (
            <input
              type="checkbox"
              checked={selected}
              aria-label={`${t('selectForWork')}: ${asset.name}`}
              onChange={() => { onToggleSelect(asset.name) }}
            />
          )
          : null}
        <span className={css.freshDot} data-tone={tone} title={tone === 'none' ? t('noFreshnessLabel') : undefined} />
        <button type="button" className={css.cardNameButton} title={asset.name} onClick={() => { onSelect(asset.name) }}>
          {asset.name}
        </button>
        <span className={css.chip} data-kind={asset.kind}>{kindLabel(asset.kind, t)}</span>
      </span>
      {metric === null
        ? null
        : (
          <span className={css.cardMetric}>
            <span className={css.cardMetricValue}>{metric.value}</span>
            <span className={css.cardMetricLabel}>
              {metric.labelKey === null ? metric.label : t(metric.labelKey)}
            </span>
          </span>
        )}
      {asset.description === '' ? null : <span className={css.cardDescLine} title={asset.description}>{asset.description}</span>}
      {primary === null
        ? null
        : (
          <span className={css.cardActions}>
            <button
              type="button"
              className={css.cardAction}
              onClick={() => { onAction(asset.name, primary) }}
            >
              {verbLabel(primary, t)}
            </button>
          </span>
        )}
    </li>
  )
}

/** One sortable column heading of the list view. */
function SortHeader({ by, label, sort, descending, onSort }: {
  readonly by: LibrarySort
  readonly label: string
  readonly sort: LibrarySort
  readonly descending: boolean
  readonly onSort: AssetsViewProps['onSort']
}): ReactNode {
  const active = sort === by
  return (
    <th scope="col">
      <button
        type="button"
        className={css.sortButton}
        data-active={active ? 'true' : undefined}
        onClick={() => { onSort(by, active ? !descending : by === 'as_of') }}
      >
        {active ? `${label} ${descending ? '▼' : '▲'}` : label}
      </button>
    </th>
  )
}

/** The compact table view. */
function AssetTable({ assets, sort, descending, onSort, onSelect, selectMode, selected, onToggleSelect, t }: AssetsViewProps): ReactNode {
  return (
    <div className={css.listWrap}>
      <table className={css.list}>
        <thead>
          <tr>
            {selectMode ? <th scope="col">{t('selectForWork')}</th> : null}
            <SortHeader by="name" label={t('sortByName')} sort={sort} descending={descending} onSort={onSort} />
            <th scope="col">{t('filterKind')}</th>
            <th scope="col">{t('filterOrigin')}</th>
            <th scope="col">{t('latestLabel')}</th>
            <SortHeader by="as_of" label={t('asOfLabel')} sort={sort} descending={descending} onSort={onSort} />
            <th scope="col">{t('staleLabel')}</th>
            <th scope="col">{t('verbsLabel')}</th>
            <th scope="col">{t('tagsLabel')}</th>
            {/* P4 owns the usage data behind these two columns; the seats stay
                visible so the table's reading order does not change when it lands. */}
            <th scope="col">{t('columnHitRate')}</th>
            <th scope="col">{t('columnLiveRate')}</th>
          </tr>
        </thead>
        <tbody>
          {assets.map(asset => (
            <tr key={asset.name} data-stale={asset.stale ? 'true' : undefined} data-selected={selected.includes(asset.name) ? 'true' : undefined}>
              {selectMode
                ? (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(asset.name)}
                      aria-label={`${t('selectForWork')}: ${asset.name}`}
                      onChange={() => { onToggleSelect(asset.name) }}
                    />
                  </td>
                )
                : null}
              <td>
                <button type="button" className={css.linkButton} title={asset.name} onClick={() => { onSelect(asset.name) }}>
                  {asset.name}
                </button>
              </td>
              <td><span className={css.chip} data-kind={asset.kind}>{kindLabel(asset.kind, t)}</span></td>
              <td>{originLabel(asset.origin, t)}</td>
              <td>{t('version', { version: String(asset.latest_version) })}</td>
              <td>{asOfOf(asset) === '' ? t('blockEmpty') : asOfOf(asset)}</td>
              <td>{asset.stale ? t('staleLabel') : ''}</td>
              <td className={css.cellList}>{asset.verbs.join(', ')}</td>
              <td className={css.cellList}>{asset.tags.join(', ')}</td>
              <td className={css.deferred} title={t('deferredCell')}>{t('blockEmpty')}</td>
              <td className={css.deferred} title={t('deferredCell')}>{t('blockEmpty')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Render the assets tab's active view over one filtered snapshot. */
export function AssetsView(props: AssetsViewProps): ReactNode {
  const { assets, view, t } = props
  if (assets.length === 0) {
    return (
      <>
        <Toolbar {...props} />
        <p className={css.status}>{t('emptyFiltered')}</p>
      </>
    )
  }
  return (
    <>
      <Toolbar {...props} />
      {view === 'grid'
        ? (
          <ul className={css.grid}>
            {assets.map(asset => (
              <AssetCard
                key={asset.name}
                asset={asset}
                onSelect={props.onSelect}
                onAction={props.onAction}
                selectMode={props.selectMode}
                selected={props.selected.includes(asset.name)}
                onToggleSelect={props.onToggleSelect}
                t={t}
              />
            ))}
          </ul>
        )
        : <AssetTable {...props} />}
    </>
  )
}
