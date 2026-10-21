/**
 * The left panel: "Estimate" with the EN / 日本語 switch in its head, the
 * Elements and Cost Codes tabs, and the markups + TOTAL foot (estimate.html).
 *
 * Until the estimate has been read it shows that it is loading, or why it
 * could not be read with a Retry. A Viewer sees everything with the inputs
 * disabled, and a banner says why.
 */
import { useState } from 'react'
import { Banner, Empty, Panel, Segmented, TabPanel, Tabs } from '../../ds'
import type { Lang } from '../types'
import { CostCodesTab } from './CostCodesTab'
import { useEstimateUi } from './context'
import { ElementsTab } from './ElementsTab'
import { Footer } from './Footer'

/** The product name: the same in every language. */
const NAME = 'Estimate'

export type EstimatePanelProps = {
  /** Why there is nothing to list yet (opening, loading the model, no VIM), or undefined. */
  modelPlaceholder?: string
  /** The project role is Viewer: say why every input is disabled. */
  readOnly?: boolean
}

export function EstimatePanel({ modelPlaceholder, readOnly }: EstimatePanelProps): JSX.Element {
  const { est } = useEstimateUi()
  const { t } = est
  const [tab, setTab] = useState('elements')

  const placeholder =
    modelPlaceholder ??
    (est.factsStatus === 'building'
      ? t('Reading the model quantities…')
      : est.factsStatus === 'error'
        ? t('Could not read the model quantities.')
        : undefined)

  const ready = est.status === 'ready'
  return (
    <Panel
      side="left"
      fill
      title={NAME}
      className="en-panel"
      bodyClassName="en-body"
      data-testid="estimate-panel"
      actions={
        <Segmented
          options={[
            { id: 'en', label: 'EN' },
            { id: 'ja', label: '日本語' },
          ]}
          value={est.lang}
          onChange={(lang) => est.setLang(lang as Lang)}
          ariaLabel="Language"
          data-testid="lang-switch"
        />
      }
      foot={ready ? <Footer /> : undefined}
    >
      {est.status === 'loading' ? <Empty fill title={t('Loading the estimate…')} data-testid="estimate-loading" /> : null}
      {est.status === 'error' ? (
        <div className="en-state">
          <Banner
            tone="bad"
            role="alert"
            data-testid="estimate-error"
            action={{ label: t('Retry'), onClick: est.retry, 'data-testid': 'estimate-retry' }}
          >
            {t('Could not load the estimate.')} {est.error}
          </Banner>
        </div>
      ) : null}
      {ready ? (
        <>
          {readOnly ? (
            <Banner tone="info" data-testid="estimate-readonly" className="en-readonly">
              {t('Read only: your project role is Viewer.')}
            </Banner>
          ) : null}
          <Tabs
            className="en-tabs"
            options={[
              { id: 'elements', label: t('Elements'), 'data-testid': 'tab-elements' },
              { id: 'costcodes', label: t('Cost Codes'), 'data-testid': 'tab-costcodes' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <TabPanel active={tab === 'elements'} className="en-page">
            <ElementsTab placeholder={placeholder} />
          </TabPanel>
          <TabPanel active={tab === 'costcodes'} className="en-page">
            <CostCodesTab />
          </TabPanel>
        </>
      ) : null}
    </Panel>
  )
}
