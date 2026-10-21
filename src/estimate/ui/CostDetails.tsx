/**
 * Cost Details (details.js): the pane right of the 3D view that describes the
 * selection. Several elements selected: a SUMMARY (what they share, or
 * "varies", and their cost) with one place to change their work package, cost
 * code, extra and note. The navigator steps through the selected elements one
 * at a time; each shows its own cost and the same fields for it alone.
 * Stepping never changes the selection; the camera toggle frames the element
 * it steps onto.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { IconButton, Label, Panel, Select, TextArea, cx } from '../../ds'
import type { SelectOption } from '../../ds'
import { COUNT, NO_KEY, categoryLabel, qtyText, tn } from '../i18n'
import type { Translator } from '../i18n'
import { costCodeLabel, workPackageName } from '../grouping'
import { BASIS_UNIT } from '../types'
import type { ElementFacts, PricedRow } from '../types'
import { InlineNumber } from './cells'
import { useEstimateUi } from './context'

/** The navigator's Summary entry: never an element index. */
const SUMMARY = 'summary'
const NONE = '+none'
/** The pager's "… and N more" entry: never an element index. */
const MORE = '+more'
const NOTE_MAX = 500
/**
 * The pager's dropdown lists this many elements at most: the DS menu renders
 * every entry, and a 20,000-element selection would freeze it. Previous /
 * Next still step through all of them.
 */
const PAGER_MAX = 200

type Shown = { facts: ElementFacts; row: PricedRow }

/** One value across rows, or the fact that it varies. */
function common<T>(rows: Shown[], pick: (shown: Shown) => T): { same: boolean; value: T | undefined } {
  if (!rows.length) return { same: true, value: undefined }
  const first = pick(rows[0])
  return { same: rows.every((shown) => pick(shown) === first), value: first }
}

/** ElementId order (numeric where it is a number), as the tree lists them. */
function byElementId(a: ElementFacts, b: ElementFacts): number {
  const x = Number(a.elementId)
  const y = Number(b.elementId)
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y
  return a.index - b.index
}

export function CostDetails({ onClose }: { onClose: () => void }): JSX.Element {
  const ui = useEstimateUi()
  const { est, selection } = ui
  const { t } = est

  // The selected elements in order: changes with the selection, not with every edit.
  const selectedFacts = useMemo(() => {
    const out: ElementFacts[] = []
    for (const index of selection) {
      const facts = est.facts.get(index)
      if (facts) out.push(facts)
    }
    return out.sort(byElementId)
  }, [est.facts, selection])
  const rows = useMemo(() => {
    const out: Shown[] = []
    for (const facts of selectedFacts) {
      const row = est.priced.get(facts.index)
      if (row) out.push({ facts, row })
    }
    return out
  }, [est.priced, selectedFacts])
  const listed = useMemo(
    () => (selectedFacts.length > 1 ? [SUMMARY, ...selectedFacts.map((facts) => String(facts.index))] : []),
    [selectedFacts],
  )
  const baseOptions = useMemo(() => pagerOptions(selectedFacts, t), [selectedFacts, t])

  // A new selection starts on its summary (or its one element).
  const [shown, setShown] = useState<string>(SUMMARY)
  useEffect(() => setShown(SUMMARY), [selection])
  const [frameOnStep, setFrameOnStep] = useState(true)

  const summary = rows.length > 1 && shown === SUMMARY
  const current = summary ? null : (rows.find((entry) => String(entry.facts.index) === shown) ?? rows[rows.length - 1])
  const key = current ? String(current.facts.index) : SUMMARY
  const steps = listed.length ? listed : [key]
  const at = Math.max(0, steps.indexOf(key))
  // An element past the dropdown's cap still shows as the pager's value.
  const options =
    at > PAGER_MAX && current
      ? [...baseOptions.slice(0, -1), elementOption(current.facts, at, rows.length), ...baseOptions.slice(-1)]
      : baseOptions

  const step = (next: string): void => {
    if (next === MORE) return
    setShown(next)
    if (frameOnStep && next !== SUMMARY) ui.frameElements([Number(next)])
  }

  return (
    <Panel
      side="right"
      fill
      title={t('Cost Details')}
      data-testid="cost-details"
      className="en-details-panel"
      actions={
        <IconButton icon="clear" size="sm" tip={t('Close the cost details panel')} data-testid="cost-details-close" onClick={onClose} />
      }
    >
      {rows.length === 0 ? (
        <Label variant="dim">{t('Select elements to see their estimate.')}</Label>
      ) : (
        <>
          <div className="ed-pager">
            <IconButton
              icon="chevron-left"
              size="sm"
              tip={steps.length > 1 ? t('Previous') : t('Select more than one element to step between them')}
              disabled={steps.length < 2}
              data-testid="details-prev"
              onClick={() => step(steps[(at - 1 + steps.length) % steps.length])}
            />
            <Select
              block
              className="ed-pagesel"
              options={options}
              value={key}
              onChange={step}
              title={
                steps.length > 1
                  ? tn(t, COUNT.stepThrough, rows.length)
                  : undefined
              }
              data-testid="details-pager"
            />
            <IconButton
              icon="chevron-right"
              size="sm"
              tip={steps.length > 1 ? t('Next') : t('Select more than one element to step between them')}
              disabled={steps.length < 2}
              data-testid="details-next"
              onClick={() => step(steps[(at + 1) % steps.length])}
            />
            <IconButton
              icon="camera"
              size="sm"
              active={frameOnStep}
              tip={t(frameOnStep ? 'Frame the shown element when stepping (on)' : 'Frame the shown element when stepping (off)')}
              data-testid="details-camera"
              onClick={() => {
                const on = !frameOnStep
                setFrameOnStep(on)
                if (on && current) ui.frameElements([current.facts.index])
              }}
            />
          </div>
          {current ? <ElementView entry={current} /> : <SummaryView rows={rows} />}
          <Fields rows={current ? [current] : rows} />
        </>
      )}
    </Panel>
  )
}

/** One element in the pager: its ElementId and name, and its place in the selection when there are several. */
function elementOption(facts: ElementFacts, place: number, of: number): SelectOption {
  return {
    id: String(facts.index),
    label: `${facts.elementId}  ${facts.name}`,
    hint: of > 1 ? `(${place}/${of})` : undefined,
  }
}

/** The pager's list: Summary, the first PAGER_MAX elements, and how many more there are. */
function pagerOptions(selected: ElementFacts[], t: Translator): SelectOption[] {
  if (selected.length === 0) return []
  if (selected.length === 1) return [elementOption(selected[0], 1, 1)]
  const options: SelectOption[] = [
    { id: SUMMARY, label: t('Summary'), hint: tn(t, COUNT.summaryHint, selected.length) },
    ...selected.slice(0, PAGER_MAX).map((facts, i) => elementOption(facts, i + 1, selected.length)),
  ]
  const more = selected.length - PAGER_MAX
  if (more > 0) options.push({ id: MORE, label: t('… and {n} more', { n: more.toLocaleString() }), disabled: true })
  return options
}

/** A read-only line; a value nobody has is not shown. */
function Line(props: { label: string; value: ReactNode; varies?: boolean; num?: boolean; total?: boolean }): JSX.Element | null {
  const { est } = useEstimateUi()
  if (!props.varies && (props.value === '' || props.value === null || props.value === undefined)) return null
  return (
    <div className="ed-line">
      <span className="ed-k">{props.label}</span>
      <span className={cx('ed-v', props.num && 'ed-v--num', props.total && 'ed-v--total', props.varies && 'ed-varies')}>
        {props.varies ? est.t('varies') : props.value}
      </span>
    </div>
  )
}

function SummaryView({ rows }: { rows: Shown[] }): JSX.Element {
  const { est } = useEstimateUi()
  const { t } = est
  const category = common(rows, (entry) => entry.facts.category)
  const level = common(rows, (entry) => entry.facts.level)
  const missing = rows.filter((entry) => entry.row.missing).length
  return (
    <>
      <div className="ed-facts">
        <Label as="div" variant="eyebrow">
          {tn(t, COUNT.selected, rows.length)}
        </Label>
        <Line label={t('Category')} value={categoryLabel(est.lang, category.value ?? '')} varies={!category.same} />
        <Line label={t('Level')} value={level.value} varies={!level.same} />
      </div>
      <div className="ed-cost">
        <Line
          label={t('Amount ¥')}
          value={est.money(rows.reduce((sum, entry) => sum + entry.row.amount, 0))}
          num
          total
        />
        {missing ? <div className="ed-warn">{t('{n} without a quantity', { n: missing.toLocaleString() })}</div> : null}
      </div>
    </>
  )
}

function ElementView({ entry }: { entry: Shown }): JSX.Element {
  const { est } = useEstimateUi()
  const { t } = est
  const { facts, row } = entry
  const code = row.code ? est.costCodes.get(row.code) : undefined
  const unit = code ? code.unit || BASIS_UNIT[code.basis] : ''
  return (
    <>
      <div className="ed-facts">
        <Label as="div" variant="eyebrow">
          {t('Element ID')} {facts.elementId}
        </Label>
        <Line label={t('Name')} value={facts.name} />
        <Line label={t('Category')} value={categoryLabel(est.lang, facts.category)} />
        <Line label={t('Family')} value={facts.family} />
        <Line label={t('Type')} value={facts.type} />
        <Line label={t('Level')} value={facts.level} />
      </div>
      <div className="ed-cost">
        {code ? (
          <>
            <Line label={t('Qty')} value={row.qty === null ? '' : `${qtyText(row.qty)} ${unit}`.trim()} num />
            <Line label={t('Material ¥')} value={row.material === null ? '' : est.money(row.material)} num />
            <Line label={t('Labor ¥')} value={row.labor === null ? '' : est.money(row.labor)} num />
          </>
        ) : null}
        <Line label={t('Amount ¥')} value={est.money(row.amount)} num total />
        {row.missing ? <div className="ed-warn">{t('{n} without a quantity', { n: 1 })}</div> : null}
      </div>
    </>
  )
}

/** Work package, cost code, extra and note, written to every row shown. */
function Fields({ rows }: { rows: Shown[] }): JSX.Element {
  const ui = useEstimateUi()
  const { est } = ui
  const { t } = est
  const elements = rows.map((entry) => entry.facts.index)
  const varies = t('varies')
  // Nothing can be stored for elements with no UniqueId (keys.ts): the fields are disabled
  // when every shown element is one, and the writes skip them when only some are.
  const noKey = est.storable(elements).length === 0
  const noKeyTip = noKey ? tn(t, NO_KEY, elements.length) : undefined
  const canEdit = est.canEdit && !noKey

  const wp = common(rows, (entry) => entry.row.wp ?? NONE)
  const packages = [...est.workPackages.values()].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1))
  const wpOptions: SelectOption[] = [
    { id: NONE, label: t('(No work package)'), separatorAfter: true },
    ...packages.map((entry, i) => ({
      id: entry.id,
      label: workPackageName(entry, est.lang),
      separatorAfter: i === packages.length - 1,
    })),
    { id: '+new', label: t('New work package…'), action: () => ui.openWorkPackage(elements) },
  ]

  const code = common(rows, (entry) => entry.row.code ?? NONE)
  const offered = new Set(est.usage.keys())
  for (const entry of rows) if (entry.row.code) offered.add(entry.row.code)
  const codes = [...offered]
    .map((id) => est.costCodes.get(id))
    .filter((entry) => entry !== undefined)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  const codeOptions: SelectOption[] = [
    { id: NONE, label: t('(No cost code)'), separatorAfter: true },
    ...codes.map((entry, i) => ({ id: entry.id, label: costCodeLabel(entry), separatorAfter: i === codes.length - 1 })),
    { id: '+choose', label: t('Choose from Cost Codes…'), action: () => ui.openCostCode(elements) },
  ]

  const extra = common(rows, (entry) => entry.row.extra)
  const note = common(rows, (entry) => entry.row.note)

  return (
    <div className="ed-fields" data-ds-tip={noKeyTip}>
      <div className="ed-line">
        <span className="ed-k">{t('Work package')}</span>
        <Select
          block
          className="ed-control"
          options={wpOptions}
          value={wp.same ? (wp.value ?? NONE) : null}
          placeholder={varies}
          disabled={!canEdit}
          data-testid="details-wp"
          onChange={(id) => est.assign(elements, { wp: id === NONE ? null : id })}
        />
      </div>
      <div className="ed-line">
        <span className="ed-k">{t('Cost code')}</span>
        <Select
          block
          className="ed-control"
          options={codeOptions}
          value={code.same ? (code.value ?? NONE) : null}
          placeholder={varies}
          disabled={!canEdit}
          data-testid="details-code"
          onChange={(id) => est.assign(elements, { code: id === NONE ? null : id })}
        />
      </div>
      <div className="ed-line">
        <span className="ed-k">{t('Extra ¥')}</span>
        <span className="ed-control">
          <InlineNumber
            variant="box"
            value={extra.same ? (extra.value ?? null) : null}
            placeholder={extra.same ? '0' : varies}
            disabled={!canEdit}
            ariaLabel={t('Extra ¥')}
            data-testid="details-extra"
            onCommit={(value) => est.assign(elements, { extra: value })}
          />
        </span>
      </div>
      <div className="ed-note">
        <span className="ed-k">{t('Note')}</span>
        <TextArea
          value={note.same ? (note.value ?? '') : ''}
          rows={3}
          maxLength={NOTE_MAX}
          placeholder={note.same ? t('Note…') : t('varies: typing here replaces every note')}
          disabled={!canEdit}
          ariaLabel={t('Note')}
          data-testid="details-note"
          onCommit={(text) => est.assign(elements, { note: text.trim() || null })}
        />
      </div>
    </div>
  )
}
