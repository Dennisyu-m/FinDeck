/**
 * The Help page: the quick-start path as an ordered list, with the
 * modes-and-flows explainer beside it. Copy resolves through the `ui.pages`
 * namespace so it follows locale changes.
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PagesLocaleKey } from './locales.ts'
import css from './PlaceholderPage.module.css'

/** Full component props for the Help page. */
export type HelpPageProps = PropsRuntime<'settings.section'> & PropsLocale<'ui.pages'>

const HELP_STEPS: readonly PagesLocaleKey[] = [
  'help.step1', 'help.step2', 'help.step3', 'help.step4', 'help.step5',
]

/** The feature map: one entry per shipped capability, with its entry point. */
const HELP_FEATURES: readonly { id: string; title: PagesLocaleKey; where: PagesLocaleKey; body: PagesLocaleKey }[] = [
  { id: 'assets', title: 'help.feature.assets.title', where: 'help.feature.assets.where', body: 'help.feature.assets.body' },
  { id: 'thesis', title: 'help.feature.thesis.title', where: 'help.feature.thesis.where', body: 'help.feature.thesis.body' },
  { id: 'redblue', title: 'help.feature.redblue.title', where: 'help.feature.redblue.where', body: 'help.feature.redblue.body' },
  { id: 'automation', title: 'help.feature.automation.title', where: 'help.feature.automation.where', body: 'help.feature.automation.body' },
  { id: 'schedule', title: 'help.feature.schedule.title', where: 'help.feature.schedule.where', body: 'help.feature.schedule.body' },
  { id: 'roundtable', title: 'help.feature.roundtable.title', where: 'help.feature.roundtable.where', body: 'help.feature.roundtable.body' },
  { id: 'dataenv', title: 'help.feature.dataenv.title', where: 'help.feature.dataenv.where', body: 'help.feature.dataenv.body' },
  { id: 'plugins', title: 'help.feature.plugins.title', where: 'help.feature.plugins.where', body: 'help.feature.plugins.body' },
]

/**
 * Render the Help page: the quick-start path as an ordered list, with the
 * modes-and-flows explainer beside it.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the help section element tree.
 */
export function HelpPage({ t }: HelpPageProps) {
  return (
    <div className={css.page}>
      <h2 className={css.title}>{t('help.title')}</h2>
      <p className={css.blurb}>{t('help.blurb')}</p>
      <ol className={css.list}>
        {HELP_STEPS.map(step => <li key={step} className={css.listItem}>{t(step)}</li>)}
      </ol>
      <h3 className={css.title}>{t('help.flowTitle')}</h3>
      <p className={css.blurb}>{t('help.flowBody')}</p>
      <h3 className={css.title}>{t('help.featuresTitle')}</h3>
      <ul className={css.features}>
        {HELP_FEATURES.map(feature => (
          <li key={feature.id} className={css.feature}>
            <div className={css.featureHead}>
              <strong>{t(feature.title)}</strong>
              <span className={css.note}>{t(feature.where)}</span>
            </div>
            <p className={css.featureBody}>{t(feature.body)}</p>
          </li>
        ))}
      </ul>
      <p className={css.note}>{t('help.building')}</p>
    </div>
  )
}
