/**
 * The asset-hub primary page: one `settings.section` row over the
 * `assetOverview` Remote namespace. Tabs: the asset grid/list, reports with the
 * thesis strip, the mode flows, the lineage graph, and the Work modes created
 * from selected assets. A face detail view opens from a card, a row, or a
 * lineage node.
 *
 * The assets tab reads the v2 `assetLibrary()` snapshot; reports and flows keep
 * reading `overview()`. The host owns every read, every verb run, and the
 * workbench definition write; this component renders what the Remote answered.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AssetFaceResult, AssetLibrary, AssetLibraryAsset, AssetOverview, CreateWorkRequest, CreateWorkResult,
  WorkbenchListValue,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssetsLocaleKey } from './locales.ts'
import type { RunVerbFace } from './face/FaceRenderer.tsx'
import { AssetDetail } from './assets/AssetDetail.tsx'
import { AssetsView, type AssetView } from './assets/AssetsView.tsx'
import { LineageGraph } from './assets/LineageGraph.tsx'
import {
  filterAssets, NO_FILTER, sortAssets, type LibraryFilter, type LibrarySort,
} from './assets/library.ts'
import { FlowsTab, type SaveFlowRequest } from './flows/FlowsTab.tsx'
import { ReportsTab } from './reports/ReportsTab.tsx'
import css from './AssetsPage.module.css'

/** The tab ids in bar order. */
type TabId = 'assets' | 'reports' | 'flows' | 'graph' | 'work'

/**
 * One retained cross-page open request. `revision` advances on every request,
 * so the page can apply each request once even when the asset name repeats.
 */
export interface ExternalOpen {
  readonly revision: number
  readonly asset?: string
  readonly version?: number
  readonly thesis?: string
}

/**
 * The tab bar in order: one stable tab id and the dictionary key naming that
 * tab. The id is what selection matches and what keys the row; the label text
 * itself lives only in the `ui.assets` dictionaries.
 */
const TAB_BAR: readonly (readonly [TabId, AssetsLocaleKey])[] = [
  ['assets', 'tabAssets'],
  ['reports', 'tabReports'],
  ['flows', 'tabFlows'],
  ['work', 'tabWork'],
  ['graph', 'tabGraph'],
]

/** Full page props: the owner share, the locale seat, and the injected adapters. */
export type AssetsPageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'ui.assets'>
  & {
    /** Read the whole v2 library snapshot (`assetLibrary`). */
    readonly loadLibrary: () => Promise<AssetLibrary>
    /** Read the overview snapshot the reports and flows tabs render. */
    readonly loadOverview: () => Promise<AssetOverview>
    /** Read one version's face, manifest, and directory. */
    readonly loadFace: (asset: string, version?: number) => Promise<AssetFaceResult>
    /** Run one verb through the bridge; the returned status is the only verdict. */
    readonly runVerb: RunVerbFace
    /** Read one version-directory text file for an `embed` block. */
    readonly loadFile: (asset: string, version: number, path: string) => Promise<string>
    /** Hand one asset to a fresh AI session seeded by `assetBrief`. */
    readonly askAi: (asset: string) => Promise<void>
    /** Store one user mode through the owner's authoring Remote; failure text, or undefined. */
    readonly saveFlow: (request: SaveFlowRequest) => Promise<string | undefined>
    /** List the shipped and user Work mode definitions. */
    readonly loadWorkbenches: () => Promise<WorkbenchListValue>
    /** Create one user Work mode definition from the selected assets. */
    readonly createWork: (request: CreateWorkRequest) => Promise<CreateWorkResult>
    /** Generate one Work mode definition's session seed. */
    readonly loadWorkbenchBrief: (name: string) => Promise<string>
    /** Open a fresh session on one server-generated seed. */
    readonly openSeed: (seed: string) => Promise<void>
    /** Reactive cross-page open requests; bound by the renderer as `useExternalOpen`. */
    readonly useExternalOpen: <T>(selector: (value: ExternalOpen) => T) => T
  }

/** The page's one load state: both snapshots, each absent when its read failed. */
type HubState =
  | { readonly status: 'loading' }
  | {
    readonly status: 'ready'
    readonly library: AssetLibrary | null
    readonly overview: AssetOverview | null
  }

/** The retry row one failed section shows. */
function RetryLine({ onRetry, t }: { readonly onRetry: () => void; readonly t: AssetsPageProps['t'] }): ReactNode {
  return (
    <div className={css.failure}>
      <span role="alert">{t('error')}</span>
      <button type="button" onClick={onRetry}>{t('retry')}</button>
    </div>
  )
}

/** The selected-assets action bar and create form. */
function WorkCreatePanel({ selected, createWork, openSeed, close, t }: {
  readonly selected: readonly string[]
  readonly createWork: AssetsPageProps['createWork']
  readonly openSeed: AssetsPageProps['openSeed']
  readonly close: () => void
  readonly t: AssetsPageProps['t']
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (selected.length === 0) return null
  const submit = (): void => {
    setBusy(true)
    setError(null)
    void createWork({
      name: name.trim(),
      displayName: displayName.trim(),
      description: description.trim(),
      assets: [...selected],
    }).then(
      async (result) => {
        try {
          await openSeed(result.seed)
          close()
        } catch (failure) {
          setBusy(false)
          setError(t('createWorkError', { message: failure instanceof Error ? failure.message : String(failure) }))
        }
      },
      (failure: unknown) => {
        setBusy(false)
        setError(t('createWorkError', { message: failure instanceof Error ? failure.message : String(failure) }))
      },
    )
  }
  return (
    <section className={css.workCreate}>
      <p className={css.workCount}>{t('selectionCount', { count: String(selected.length) })}</p>
      {open
        ? (
          <div className={css.workForm}>
            <h3 className={css.sectionTitle}>{t('createWorkTitle')}</h3>
            <div className={css.formRow}>
              <label className={css.formField}>
                <span>{t('createWorkName')}</span>
                <input value={name} onChange={event => { setName(event.currentTarget.value) }} placeholder="my-work" />
              </label>
              <label className={css.formField}>
                <span>{t('createWorkDisplay')}</span>
                <input value={displayName} onChange={event => { setDisplayName(event.currentTarget.value) }} />
              </label>
              <label className={`${css.formField} ${css.formFieldWide}`}>
                <span>{t('createWorkDescription')}</span>
                <input value={description} onChange={event => { setDescription(event.currentTarget.value) }} />
              </label>
            </div>
            <div className={css.flowActions}>
              <button
                type="button"
                className={css.primary}
                disabled={busy || name.trim() === '' || displayName.trim() === '' || description.trim() === ''}
                onClick={submit}
              >
                {busy ? t('createWorkBusy') : t('createWorkSubmit')}
              </button>
              <button type="button" className={css.ghost} disabled={busy} onClick={() => { setOpen(false) }}>
                {t('newFlowCancel')}
              </button>
              {error === null ? null : <span className={css.formError} role="alert">{error}</span>}
            </div>
          </div>
        )
        : (
          <button type="button" className={css.primary} onClick={() => { setOpen(true) }}>{t('createWork')}</button>
        )}
    </section>
  )
}

/** The Work modes tab: existing definitions and a one-click session. */
function WorkTab({ loadWorkbenches, loadWorkbenchBrief, openSeed, close, onSelectAssets, t }: {
  readonly loadWorkbenches: AssetsPageProps['loadWorkbenches']
  readonly loadWorkbenchBrief: AssetsPageProps['loadWorkbenchBrief']
  readonly openSeed: AssetsPageProps['openSeed']
  readonly close: () => void
  readonly onSelectAssets: () => void
  readonly t: AssetsPageProps['t']
}): ReactNode {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'failed'; message: string }
    | { status: 'ready'; value: WorkbenchListValue }
  >({ status: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void loadWorkbenches().then(
      value => { if (alive) setState({ status: 'ready', value }) },
      (failure: unknown) => {
        if (alive) setState({ status: 'failed', message: failure instanceof Error ? failure.message : String(failure) })
      },
    )
    return () => { alive = false }
  }, [loadWorkbenches])
  const open = (name: string): void => {
    setBusy(name)
    setError(null)
    void loadWorkbenchBrief(name).then(
      async (seed) => {
        try {
          await openSeed(seed)
          close()
        } catch (failure) {
          setBusy(null)
          setError(t('workOpenError', { message: failure instanceof Error ? failure.message : String(failure) }))
        }
      },
      (failure: unknown) => {
        setBusy(null)
        setError(t('workOpenError', { message: failure instanceof Error ? failure.message : String(failure) }))
      },
    )
  }
  return (
    <section>
      <div className={css.flowActions}>
        <button type="button" className={css.primary} onClick={onSelectAssets}>{t('selectModeOn')}</button>
      </div>
      {error === null ? null : <p className={css.formError} role="alert">{error}</p>}
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'failed' ? <p className={css.formError} role="alert">{t('error')}: {state.message}</p> : null}
      {state.status === 'ready' && state.value.problems.length > 0
        ? (
          <div className={css.problems} role="status">
            <p>{t('problemsTitle')}</p>
            <ul>{state.value.problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
          </div>
        )
        : null}
      {state.status === 'ready' && state.value.workbenches.length === 0
        ? <p className={css.status}>{t('workEmpty')}</p>
        : null}
      {state.status === 'ready'
        ? (
          <ul className={css.workGrid}>
            {state.value.workbenches.map(workbench => (
              <li key={workbench.name} className={css.workCard}>
                <div className={css.flowHead}>
                  <span className={css.flowName}>{workbench.displayName}</span>
                  <span className={css.chip}>{t('workAssetsCount', { count: String(workbench.assets.length) })}</span>
                  {workbench.userDefined ? <span className={css.chip}>{t('workUserDefined')}</span> : null}
                </div>
                <p className={css.cardDesc}>{workbench.description}</p>
                <p className={css.cardDesc}>{workbench.assets.join('、')}</p>
                <button
                  type="button"
                  className={css.primary}
                  disabled={busy !== null}
                  onClick={() => { open(workbench.name) }}
                >
                  {busy === workbench.name ? t('workOpenBusy') : t('workOpen')}
                </button>
              </li>
            ))}
          </ul>
        )
        : null}
    </section>
  )
}

/** Render the asset-hub page. */
export function AssetsPage(props: AssetsPageProps): ReactNode {
  const {
    loadLibrary, loadOverview, loadFace, runVerb, loadFile, askAi, saveFlow, loadWorkbenches,
    createWork, loadWorkbenchBrief, openSeed, useExternalOpen, close, t,
  } = props
  const [tab, setTab] = useState<TabId>('assets')
  const [request, setRequest] = useState(0)
  const [view, setView] = useState<AssetView>('grid')
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER)
  const [sort, setSort] = useState<LibrarySort>('name')
  const [descending, setDescending] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(undefined)
  /** The verb a card's primary action asked the detail view to spotlight. */
  const [focusVerb, setFocusVerb] = useState<string | undefined>(undefined)
  const [state, setState] = useState<HubState>({ status: 'loading' })
  const [selectMode, setSelectMode] = useState(false)
  const [selection, setSelection] = useState<readonly string[]>([])
  const external = useExternalOpen(value => value)
  const lastExternal = useRef(0)

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    const settle = <T,>(read: () => Promise<T>): Promise<T | null> => read().then(
      value => value,
      () => null,
    )
    void Promise.all([settle(loadLibrary), settle(loadOverview)]).then(
      ([library, overview]) => { if (live) setState({ status: 'ready', library, overview }) },
    )
    return () => { live = false }
  }, [loadLibrary, loadOverview, request])

  useEffect(() => {
    if (external.revision === lastExternal.current) return
    lastExternal.current = external.revision
    if (external.asset !== undefined) {
      setTab('assets')
      setSelected(external.asset)
      setSelectedVersion(external.version)
      setFocusVerb(undefined)
      setSelectMode(false)
      return
    }
    if (external.thesis !== undefined) setTab('reports')
  }, [external])

  const library = state.status === 'ready' ? state.library : null
  const overview = state.status === 'ready' ? state.overview : null
  const all: readonly AssetLibraryAsset[] = library?.assets ?? []
  const visible = useMemo(
    () => sortAssets(filterAssets(all, filter), sort, descending),
    [all, filter, sort, descending],
  )
  const focused = selected === undefined ? undefined : all.find(asset => asset.name === selected)

  const openAsset = (name: string): void => {
    setSelected(name)
    setSelectedVersion(undefined)
    setFocusVerb(undefined)
  }
  const openAction = (name: string, verb: string): void => {
    setSelected(name)
    setSelectedVersion(undefined)
    setFocusVerb(verb)
  }
  const toggleSelection = (name: string): void => {
    setSelection(current => current.includes(name)
      ? current.filter(candidate => candidate !== name)
      : [...current, name])
  }
  // Opening a session is the page's own leave route: the shell returns to the
  // conversation whenever the current session changes, and the explicit close
  // keeps that true if the section is ever hosted without that rule.
  const handOff = (name: string): Promise<void> => askAi(name).then(() => { close() })
  const startSelect = (): void => {
    setTab('assets')
    setSelected(undefined)
    setFocusVerb(undefined)
    setSelectMode(true)
  }

  return (
    <div className={css.page}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.blurb}>{t('blurb')}</p>
      <div className={css.tabs} role="tablist">
        {TAB_BAR.map(([id, key]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={css.tab}
            onClick={() => { setTab(id) }}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}

      {state.status === 'ready'
        ? (
          <>
            {library !== null && library.problems.length > 0
              ? (
                <p className={css.problems} role="status">
                  {`${t('problemsTitle')} ${library.problems.join('；')}`}
                </p>
              )
              : null}

            {tab === 'assets'
              ? library === null
                ? <RetryLine onRetry={() => { setRequest(value => value + 1) }} t={t} />
                : focused === undefined
                  ? all.length === 0
                    ? <p className={css.status}>{t('emptyAssets')}</p>
                    : (
                      <>
                        <div className={css.workActions}>
                          <button
                            type="button"
                            className={selectMode ? css.ghost : css.primary}
                            onClick={() => {
                              if (selectMode) {
                                setSelectMode(false)
                                setSelection([])
                              } else {
                                startSelect()
                              }
                            }}
                          >
                            {selectMode ? t('selectModeOff') : t('selectModeOn')}
                          </button>
                        </div>
                        {selectMode
                          ? (
                            <WorkCreatePanel
                              selected={selection}
                              createWork={createWork}
                              openSeed={openSeed}
                              close={close}
                              t={t}
                            />
                          )
                          : null}
                        <AssetsView
                          assets={visible}
                          all={all}
                          filter={filter}
                          onFilter={setFilter}
                          view={view}
                          onView={setView}
                          sort={sort}
                          descending={descending}
                          onSort={(by, nextDescending) => { setSort(by); setDescending(nextDescending) }}
                          onSelect={openAsset}
                          onAction={openAction}
                          selectMode={selectMode}
                          selected={selection}
                          onToggleSelect={toggleSelection}
                          t={t}
                        />
                      </>
                    )
                  : (
                    <AssetDetail
                      asset={focused}
                      initialVersion={selectedVersion}
                      loadFace={loadFace}
                      runVerb={runVerb}
                      loadFile={path => loadFile(focused.name, selectedVersion ?? focused.latest_version, path)}
                      askAi={handOff}
                      onBack={() => { setSelected(undefined); setSelectedVersion(undefined) }}
                      onNavigate={openAsset}
                      focusVerb={focusVerb}
                      onFocusConsumed={() => { setFocusVerb(undefined) }}
                      t={t}
                    />
                  )
              : null}

            {tab === 'reports'
              ? overview === null
                ? <RetryLine onRetry={() => { setRequest(value => value + 1) }} t={t} />
                : <ReportsTab overview={overview} t={t} />
              : null}

            {tab === 'flows'
              ? overview === null
                ? <RetryLine onRetry={() => { setRequest(value => value + 1) }} t={t} />
                : <FlowsTab overview={overview} saveFlow={saveFlow} onCreated={() => { setRequest(value => value + 1) }} t={t} />
              : null}

            {tab === 'work'
              ? (
                <WorkTab
                  loadWorkbenches={loadWorkbenches}
                  loadWorkbenchBrief={loadWorkbenchBrief}
                  openSeed={openSeed}
                  close={close}
                  onSelectAssets={startSelect}
                  t={t}
                />
              )
              : null}

            {tab === 'graph'
              ? library === null
                ? <RetryLine onRetry={() => { setRequest(value => value + 1) }} t={t} />
                : (
                  <LineageGraph
                    assets={all}
                    onSelect={(name) => { setSelected(name); setSelectedVersion(undefined); setTab('assets') }}
                    t={t}
                  />
                )
              : null}
          </>
        )
        : null}
    </div>
  )
}
