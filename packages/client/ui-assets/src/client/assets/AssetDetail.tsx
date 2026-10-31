/**
 * The asset console's detail view: one fixed skeleton — title row, status bar,
 * action buttons, face blocks, lineage chips, and a collapsed technical-details
 * section. Machine identifiers (session UUID, version directory, dependencies,
 * supersedes, the raw manifest) never reach the first screen; they live in the
 * collapsed section at the bottom. The page opens it from a grid card, a list
 * row, or a lineage node.
 */

import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import type { AssetFaceResult, AssetLibraryAsset, RunVerbResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { FaceRenderer, type RunVerbFace } from '../face/FaceRenderer.tsx'
import { parseFace, textOf } from '../face/spec.ts'
import { asOfOf, freshnessTone, lineageInputsOf, primaryVerbOf } from './library.ts'
import { kindLabel } from './AssetsView.tsx'
import { originLocaleKey, verbLocaleKey } from './labels.ts'
import css from '../AssetsPage.module.css'
import faceCss from '../face/FaceRenderer.module.css'

/** The ui.assets translate seat this package's components read. */
type Translate = TranslateNS<'ui.assets'>

/** The detail view's load state. */
type FaceState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: AssetFaceResult }
  | { readonly status: 'failed'; readonly message: string }

/** One verb run from the action row. */
type VerbOutcome =
  | { readonly status: 'running'; readonly verb: string }
  | { readonly status: 'done'; readonly verb: string; readonly value: RunVerbResult }

/** Full props of the face detail view. */
export interface AssetDetailProps {
  /** The library entry the face belongs to. */
  readonly asset: AssetLibraryAsset
  /** Exact version to open; absent opens the latest. */
  readonly initialVersion?: number | undefined
  /** Read one version's face and manifest. */
  readonly loadFace: (asset: string, version?: number) => Promise<AssetFaceResult>
  /** Run one verb through the bridge. */
  readonly runVerb: RunVerbFace
  /** Read one version-directory text file. */
  readonly loadFile: (path: string) => Promise<string>
  /** Hand this asset to a fresh AI session; rejects with the failure text. */
  readonly askAi: (asset: string) => Promise<void>
  /** Return to the list/grid. */
  readonly onBack: () => void
  /** Open another asset's detail (the lineage chips). */
  readonly onNavigate: (name: string) => void
  /**
   * The verb the entry gesture asks this view to spotlight (a card's primary
   * action). Read-only verbs run once on arrival; the rest only highlight.
   */
  readonly focusVerb?: string | undefined
  /** Acknowledge {@link AssetDetailProps.focusVerb} once it has been applied. */
  readonly onFocusConsumed?: (() => void) | undefined
  readonly t: Translate
}

/** Verbs the detail view may run without a click: read-only by convention. */
const SAFE_AUTORUN: ReadonlySet<string> = new Set(['preview', 'summary', 'predict'])

/** The verb's display label: the dictionary's word, or the manifest token verbatim. */
function verbLabel(verb: string, t: Translate): string {
  const key = verbLocaleKey(verb)
  return key === null ? verb : t(key)
}

/** One labelled fact inside the collapsed technical-details section. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div>
      <dt>{`${label}: `}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** The status bar: freshness badge, as-of date, last update, and read health. */
function StatusBar({ asset, created, health, t }: {
  readonly asset: AssetLibraryAsset
  readonly created: string
  readonly health: 'loading' | 'ok' | 'failed'
  readonly t: Translate
}): ReactNode {
  const tone = freshnessTone(asset)
  const toneText = tone === 'fresh'
    ? t('freshLabel')
    : tone === 'due'
      ? t('dueLabel')
      : tone === 'stale'
        ? t('staleLabel')
        : t('noFreshnessLabel')
  const asOf = asOfOf(asset)
  return (
    <div className={css.statusBar}>
      <span className={css.freshBadge} data-tone={tone}>{toneText}</span>
      {asOf === ''
        ? null
        : <span className={css.statusItem}>{`${t('asOfLabel')} ${asOf}`}</span>}
      {created === ''
        ? null
        : <span className={css.statusItem}>{`${t('updatedLabel')} ${created}`}</span>}
      <span className={css.statusItem} data-health={health}>
        {`${t('healthLabel')} ${health === 'ok' ? t('healthOk') : health === 'failed' ? t('healthFailed') : t('blockLoading')}`}
      </span>
    </div>
  )
}

/** The latest verb run's inline report under the action row. */
function VerbReport({ outcome, t }: { readonly outcome: VerbOutcome; readonly t: Translate }): ReactNode {
  if (outcome.status === 'running') {
    return <p className={faceCss.message} role="status">{t('runBusy')}</p>
  }
  const value = outcome.value
  if (value.status !== 'ok') {
    return <p className={faceCss.resultError} role="alert">{t('runFailed', { message: value.error ?? '' })}</p>
  }
  const output = textOf(value.result, value.stdout).trim()
  return (
    <div className={faceCss.resultOk}>
      <p className={faceCss.message}>{t('runOk', { duration: value.duration_s.toFixed(2) })}</p>
      {output === '' ? null : <pre className={faceCss.log}>{output.slice(0, 4000)}</pre>}
    </div>
  )
}

/** The collapsed technical-details section; the raw manifest loads on first open. */
function TechDetails({ asset, manifest, dir, loadFile, t }: {
  readonly asset: AssetLibraryAsset
  readonly manifest: AssetFaceResult['manifest'] | null
  readonly dir: string
  readonly loadFile: (path: string) => Promise<string>
  readonly t: Translate
}): ReactNode {
  const [raw, setRaw] = useState<
    { readonly status: 'idle' } | { readonly status: 'loading' } | { readonly status: 'ready'; readonly text: string } | { readonly status: 'failed'; readonly message: string }
  >({ status: 'idle' })
  const open = (event: SyntheticEvent<HTMLDetailsElement>): void => {
    if (!event.currentTarget.open || raw.status !== 'idle') return
    setRaw({ status: 'loading' })
    void loadFile('manifest.yaml').then(
      text => { setRaw({ status: 'ready', text }) },
      (error: unknown) => { setRaw({ status: 'failed', message: String(error) }) },
    )
  }
  return (
    <details className={css.techDetails} onToggle={open}>
      <summary>{t('techDetailsTitle')}</summary>
      <dl className={css.cardFacts}>
        {manifest === null || manifest.source_session === '' ? null : <Fact label={t('sessionLabel')}>{manifest.source_session}</Fact>}
        {dir === '' ? null : <Fact label={t('dirLabel')}><code>{dir}</code></Fact>}
        {manifest === null || manifest.dependencies.length === 0 ? null : <Fact label={t('depsLabel')}>{manifest.dependencies.join(', ')}</Fact>}
        {manifest === null || manifest.supersedes === null ? null : <Fact label={t('supersedesLabel')}>{manifest.supersedes}</Fact>}
        {manifest === null || manifest.interface === '' ? null : <Fact label={t('interfaceLabel')}>{manifest.interface}</Fact>}
        {asset.tags.length === 0 ? null : <Fact label={t('tagsLabel')}>{asset.tags.join(', ')}</Fact>}
        {asset.verbs.length === 0 ? null : <Fact label={t('verbsLabel')}>{asset.verbs.join(', ')}</Fact>}
      </dl>
      <p className={css.techRawTitle}>{t('manifestRawLabel')}</p>
      {raw.status === 'ready'
        ? <pre className={faceCss.log}>{raw.text}</pre>
        : raw.status === 'failed'
          ? <p className={faceCss.resultError} role="alert">{t('blockFailed', { message: raw.message })}</p>
          : <p className={faceCss.message}>{t('blockLoading')}</p>}
    </details>
  )
}

/** Render one asset's console: title, status, actions, face, lineage, details. */
export function AssetDetail({ asset, initialVersion, loadFace, runVerb, loadFile, askAi, onBack, onNavigate, focusVerb, onFocusConsumed, t }: AssetDetailProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<FaceState>({ status: 'loading' })
  const [outcome, setOutcome] = useState<VerbOutcome | undefined>(undefined)
  const [handoff, setHandoff] = useState<
    { readonly status: 'idle' } | { readonly status: 'busy' } | { readonly status: 'failed'; readonly message: string }
  >({ status: 'idle' })

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    setOutcome(undefined)
    void loadFace(asset.name, initialVersion ?? asset.latest_version).then(
      (value) => { if (live) setState({ status: 'ready', value }) },
      (error: unknown) => { if (live) setState({ status: 'failed', message: String(error) }) },
    )
    return () => { live = false }
  }, [asset.name, asset.latest_version, initialVersion, loadFace, request])

  const run = (verb: string, confirmed: boolean): void => {
    if (!confirmed && !SAFE_AUTORUN.has(verb) && !window.confirm(t('confirmVerb', { verb: verbLabel(verb, t) }))) return
    setOutcome({ status: 'running', verb })
    void runVerb({ asset: asset.name, version, verb }).then(
      value => { setOutcome({ status: 'done', verb, value }) },
      (error: unknown) => {
        setOutcome({
          status: 'done',
          verb,
          value: { status: 'error', asset: asset.name, version, verb, duration_s: 0, error: String(error) },
        })
      },
    )
  }

  // A card's primary action opens this view with `focusVerb`: read-only verbs
  // run once on arrival, side-effecting verbs only light up their button. The
  // applied marker keys on asset + verb so re-entering with the same verb on
  // another asset still applies.
  const focused = useRef<string | undefined>(undefined)
  const version = state.status === 'ready' ? state.value.version : asset.latest_version
  useEffect(() => {
    if (state.status !== 'ready' || focusVerb === undefined || !asset.verbs.includes(focusVerb)) return
    const mark = `${asset.name} ${focusVerb}`
    if (focused.current === mark) return
    focused.current = mark
    onFocusConsumed?.()
    if (SAFE_AUTORUN.has(focusVerb)) run(focusVerb, true)
    // `run` closes over `version`, resolved above from the same state.
  }) // eslint-disable-line react-hooks/exhaustive-deps -- intentional post-render focus application

  const hand = (): void => {
    setHandoff({ status: 'busy' })
    void askAi(asset.name).then(
      () => { setHandoff({ status: 'idle' }) },
      (error: unknown) => { setHandoff({ status: 'failed', message: String(error) }) },
    )
  }

  const originKey = originLocaleKey(asset.origin)
  const inputs = lineageInputsOf(asset)
  const manifest = state.status === 'ready' ? state.value.manifest : null
  const parsed = state.status === 'ready' ? parseFace(state.value.face) : null
  const rawBlocks = state.status === 'ready' && Array.isArray(state.value.face?.blocks)
    ? state.value.face.blocks.length
    : 0
  const skipped = rawBlocks - (parsed?.blocks.length ?? 0)
  const primary = focusVerb ?? primaryVerbOf(asset.verbs)
  const health = state.status === 'ready' ? 'ok' : state.status === 'failed' ? 'failed' : 'loading'

  return (
    <section className={css.detail}>
      <div className={css.detailBar}>
        <button type="button" className={css.ghost} onClick={onBack}>{t('backToAssets')}</button>
      </div>

      <header className={css.detailHead}>
        <h3 className={css.detailTitle} title={asset.name}>{asset.name}</h3>
        <span className={css.chip} data-kind={asset.kind}>{kindLabel(asset.kind, t)}</span>
        <span className={css.chip}>{t('version', { version: String(version) })}</span>
        <span className={css.chip}>{originKey === null ? asset.origin : t(originKey)}</span>
      </header>

      {asset.description === '' ? null : <p className={css.detailDesc}>{asset.description}</p>}

      <StatusBar asset={asset} created={manifest?.created ?? ''} health={health} t={t} />

      <div className={css.actionRow} role="group" aria-label={t('actionsLabel')}>
        {asset.verbs.map(verb => (
          <button
            key={verb}
            type="button"
            className={verb === primary ? css.primary : css.ghost}
            disabled={outcome?.status === 'running'}
            onClick={() => { run(verb, false) }}
          >
            {verbLabel(verb, t)}
          </button>
        ))}
        <button
          type="button"
          className={css.ghost}
          disabled={handoff.status === 'busy'}
          onClick={hand}
        >
          {handoff.status === 'busy' ? t('askAiBusy') : t('askAi')}
        </button>
        {handoff.status === 'failed'
          ? <span className={css.formError} role="alert">{t('askAiFailed', { message: handoff.message })}</span>
          : null}
      </div>
      {outcome === undefined ? null : <VerbReport outcome={outcome} t={t} />}

      {state.status === 'loading' ? <p className={css.status}>{t('faceLoading')}</p> : null}
      {state.status === 'failed'
        ? (
          <div className={css.failure}>
            <span role="alert">{t('faceFailed', { message: state.message })}</span>
            <button type="button" onClick={() => { setRequest(value => value + 1) }}>{t('faceRetry')}</button>
          </div>
        )
        : null}
      {state.status === 'ready'
        ? (
          <FaceRenderer
            key={`${asset.name}@v${String(state.value.version)}`}
            asset={asset.name}
            version={state.value.version}
            kind={asset.kind}
            face={parsed}
            skipped={skipped}
            runVerb={runVerb}
            loadFile={loadFile}
            t={t}
          />
        )
        : null}

      {inputs.length === 0
        ? null
        : (
          <div className={css.lineageBar}>
            <span className={css.lineageTitle}>{t('lineageTitle')}</span>
            {inputs.map(name => (
              <button
                key={name}
                type="button"
                className={css.lineageChip}
                onClick={() => { onNavigate(name) }}
              >
                {name}
              </button>
            ))}
          </div>
        )}

      <TechDetails
        asset={asset}
        manifest={manifest}
        dir={state.status === 'ready' ? state.value.dir : asset.versionDir}
        loadFile={loadFile}
        t={t}
      />
    </section>
  )
}
