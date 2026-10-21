/**
 * The Elements tab: the estimation sheet and its currency, Group by, Display,
 * the search and the Show filter, then the tree (elements.js, without the
 * Filter-by rule builder, which the Show filter replaces).
 *
 * The chrome is a two-column grid: the row labels share one column, so every
 * control starts on the same vertical line whatever the language.
 */
import { useState } from 'react'
import { IconButton, Label, Search, Segmented, Select, confirm, prompt, toast } from '../../ds'
import type { SelectOption } from '../../ds'
import { LEVEL_LABEL } from '../grouping'
import { CURRENCIES, amount } from '../i18n'
import { costLegendGradient } from '../pricing'
import type { DisplayMode } from '../prefs'
import { useEstimateUi } from './context'
import { ElementTree, useOpenGroups } from './ElementTree'
import { GroupDrawer, GroupStrip } from './GroupingBar'

export function ElementsTab({ placeholder }: { placeholder?: string }): JSX.Element {
  const { est, view } = useEstimateUi()
  const { t } = est
  const [drawerOpen, setDrawerOpen] = useState(false)
  const open = useOpenGroups(view.root, view.search)
  const grouping = {
    t,
    nesting: view.prefs.nesting,
    onChange: (nesting: typeof view.prefs.nesting) => view.setPrefs({ nesting }),
    drawerOpen,
    onDrawerOpen: setDrawerOpen,
  }

  return (
    <>
      <div className="en-chrome">
        <Label variant="eyebrow" className="en-eyebrow">{t('Estimation sheet')}</Label>
        <SheetRow />
        <Label variant="eyebrow" className="en-eyebrow">{t('Group by')}</Label>
        <GroupStrip {...grouping} />
        {drawerOpen ? (
          <>
            <span />
            <GroupDrawer {...grouping} />
          </>
        ) : null}
        <Label variant="eyebrow" className="en-eyebrow">{t('Display')}</Label>
        <DisplayRow />
      </div>
      <SearchRow onCollapse={open.collapse} onExpand={open.expand} />
      <ElementTree placeholder={placeholder} open={open.keys} setOpen={open.setKeys} />
    </>
  )
}

/** The sheet picker (its verbs are action items of the same list) and the currency. */
function SheetRow(): JSX.Element {
  const { est } = useEstimateUi()
  const { t, sheet, sheets, canEdit } = est
  const ask = (title: string, value: string): Promise<string | null> =>
    prompt({ title, label: t('Name'), value, confirmLabel: t('OK'), cancelLabel: t('Cancel') })

  const options: SelectOption[] = [
    ...sheets.map((entry, i) => ({ id: entry.id, label: entry.name, separatorAfter: i === sheets.length - 1 })),
    {
      id: '+new',
      label: t('New sheet…'),
      disabled: !canEdit,
      action: () =>
        void ask(t('New sheet'), t('Estimate {n}', { n: sheets.length + 1 })).then((name) => {
          if (name) est.addSheet(name)
        }),
    },
    {
      id: '+dup',
      label: t('Duplicate…'),
      disabled: !canEdit,
      action: () =>
        void ask(t('Duplicate'), `${sheet.name} (2)`).then((name) => {
          if (name) est.addSheet(name, sheet.id)
        }),
    },
    {
      id: '+ren',
      label: t('Rename…'),
      disabled: !canEdit,
      action: () =>
        void ask(t('Rename'), sheet.name).then((name) => {
          if (name) est.renameSheet(sheet.id, name)
        }),
    },
    {
      id: '+del',
      label: t('Delete'),
      disabled: !canEdit,
      action: () => {
        if (sheets.length < 2) {
          toast(t('The last sheet cannot be deleted.'), 'warn')
          return
        }
        void confirm({
          title: t('Delete'),
          text: sheet.name,
          confirmLabel: t('Delete'),
          cancelLabel: t('Cancel'),
          destructive: true,
        }).then((ok) => {
          if (ok) est.deleteSheet(sheet.id)
        })
      },
    },
  ]

  return (
    <div className="en-line">
      <Select
        className="en-sheet"
        options={options}
        value={sheet.id}
        onChange={est.switchSheet}
        ariaLabel={t('Estimation sheet')}
        data-testid="sheet-select"
      />
      <span className="en-line__end">
        <Label variant="eyebrow" className="en-eyebrow">{t('Currency')}</Label>
        <Select
          className="en-currency"
          options={CURRENCIES.map((entry) => ({ id: entry.id, label: `${entry.id}  ${entry.symbol}` }))}
          value={sheet.currency}
          onChange={est.setCurrency}
          disabled={!canEdit}
          ariaLabel={t('Currency')}
          data-testid="currency-select"
        />
      </span>
    </div>
  )
}

/** Display: no colours, colours by cost (with the legend), or a palette over one grouping level. */
function DisplayRow(): JSX.Element {
  const { est, view } = useEstimateUi()
  const { t } = est
  const { display, nesting, seed } = view.prefs
  const legend = view.paint.legend
  const options: SelectOption[] = [
    { id: 'none', label: t('No colors') },
    { id: 'cost', label: t('Costs'), separatorAfter: nesting.length > 0 },
    ...nesting.map((level) => ({ id: `level:${level}`, label: t('Colors by {level}', { level: t(LEVEL_LABEL[level]) }) })),
  ]
  return (
    <div className="en-line">
      <Select
        options={options}
        value={display}
        onChange={(id) => view.setPrefs({ display: id as DisplayMode })}
        ariaLabel={t('Display')}
        data-testid="display-select"
      />
      <IconButton
        icon="shuffle"
        size="sm"
        tip={t('Shuffle the colors')}
        disabled={!display.startsWith('level:')}
        data-testid="display-shuffle"
        onClick={() => view.setPrefs({ seed: seed + 1 })}
      />
      {legend ? (
        <span
          className="en-legend"
          data-testid="cost-legend"
          data-ds-tip={t(
            'White: no cost code. Green → red: element cost by rank, lowest → highest. The lowest quarter of the coded elements is green; half of them cost less than ¥ {mid} (amber).',
            { mid: amount(legend.mid) },
          )}
        >
          <span>{est.money(legend.lo)}</span>
          <span
            className="en-legend__bar"
            style={{
              // The one gradient the DS allows: here the gradient IS the data.
              background: costLegendGradient(legend.ramp),
            }}
          />
          <span>{est.money(legend.hi)}</span>
        </span>
      ) : null}
    </div>
  )
}

/** The search (on Enter), the Show filter, and the tree's collapse / expand. */
function SearchRow({ onCollapse, onExpand }: { onCollapse: () => void; onExpand: () => void }): JSX.Element {
  const { est, view } = useEstimateUi()
  const { t } = est
  const [text, setText] = useState(view.search)
  return (
    <div className="en-searchrow">
      <Search
        value={text}
        onChange={setText}
        onSubmit={(value) => view.setSearch(value.trim())}
        placeholder={t('Search elements, types, codes…')}
        data-testid="element-search"
      />
      <Segmented
        options={[
          { id: 'all', label: t('All') },
          { id: 'included', label: t('Included') },
          { id: 'excluded', label: t('Excluded') },
        ]}
        value={view.prefs.show}
        onChange={(show) => view.setPrefs({ show: show as typeof view.prefs.show })}
        ariaLabel={t('Show')}
        data-testid="show-filter"
      />
      <span className="en-steps">
        <IconButton icon="chevron-up" size="sm" tip={t('Collapse all')} data-testid="tree-collapse" onClick={onCollapse} />
        <IconButton
          icon="chevron-down"
          size="sm"
          tip={t('Expand one more level')}
          data-testid="tree-expand"
          onClick={onExpand}
        />
      </span>
    </div>
  )
}
