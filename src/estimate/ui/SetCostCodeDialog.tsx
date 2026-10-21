/**
 * Set Cost Code (dialogs.js `openCostCodeDialog`): search the cost codes and
 * pick one, or pick "New cost code…" (first in the list) and type a new one.
 * Apply puts the code on the elements; "Clear cost code" removes theirs.
 */
import { useMemo, useState } from 'react'
import { Button, FormField, Icon, Input, Modal, Search, Select, cx } from '../../ds'
import { amount, basisLabel, parseNumber } from '../i18n'
import { costCodeLabel } from '../grouping'
import { BASES } from '../types'
import type { Basis } from '../types'
import { useEstimateUi } from './context'

/** The "New cost code…" row's id: never a code id (those are `code-…`). */
const NEW = '+new'

export function SetCostCodeDialog({ elements, onClose }: { elements: number[]; onClose: () => void }): JSX.Element {
  const { est } = useEstimateUi()
  const { t, canEdit } = est
  const [filter, setFilter] = useState('')
  const [choice, setChoice] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [basis, setBasis] = useState<Basis>('count')
  const [unit, setUnit] = useState('')
  const [price, setPrice] = useState('')

  const all = useMemo(
    () =>
      [...est.costCodes.values()]
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
        .map((entry) => ({
          id: entry.id,
          label: costCodeLabel(entry),
          meta: `${amount(entry.price)} / ${entry.unit || basisLabel(t, entry.basis)}`,
          tip: entry.descr,
          hay: `${entry.code} ${entry.name} ${entry.descr}`.toLowerCase(),
        })),
    [est.costCodes, t],
  )
  const needle = filter.trim().toLowerCase()
  const shown = needle ? all.filter((item) => item.hay.includes(needle)) : all

  const creating = choice === NEW
  const ready = canEdit && choice !== null && (!creating || name.trim() !== '')

  const apply = (id: string | null): void => {
    onClose()
    est.assign(elements, { code: id })
  }
  const commit = (): void => {
    if (!ready || choice === null) return
    if (!creating) {
      apply(choice)
      return
    }
    const typed = code.trim()
    // A typed code that already exists is that code: the dialog never overwrites a priced code.
    const hit = typed ? [...est.costCodes.values()].find((entry) => entry.code === typed) : undefined
    const id =
      hit?.id ??
      est.upsertCode({
        ...(typed ? { code: typed } : {}),
        name: name.trim(),
        basis,
        unit: unit.trim(),
        price: parseNumber(price) ?? 0,
      })
    if (id) apply(id)
  }

  return (
    <Modal
      open
      size="lg"
      title={t('Set Cost Code — {n} elements', { n: elements.length.toLocaleString() })}
      data-testid="dialog"
      onClose={onClose}
      foot={
        <>
          <Button variant="ghost" data-testid="dialog-clear" disabled={!canEdit} onClick={() => apply(null)}>
            {t('Clear cost code')}
          </Button>
          <span className="en-spacer" />
          <Button variant="ghost" data-testid="dialog-cancel" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" data-testid="dialog-confirm" disabled={!ready} onClick={commit}>
            {t('Apply')}
          </Button>
        </>
      }
    >
      <div className="en-dialog">
        <Search
          value={filter}
          onChange={setFilter}
          placeholder={t('Search codes and names…')}
          data-testid="dialog-search"
        />
        <div
          className={cx('ds-list ds-list--selectable ds-list--scroll en-picklist', creating && 'en-picklist--short')}
          role="listbox"
          aria-label={t('Cost code')}
        >
          <PickRow id={NEW} label={t('New cost code…')} icon="add" chosen={choice === NEW} onPick={setChoice} />
          {shown.map((item) => (
            <PickRow
              key={item.id}
              id={item.id}
              label={item.label}
              meta={item.meta}
              tip={item.tip || undefined}
              chosen={choice === item.id}
              onPick={setChoice}
              onActivate={() => {
                if (canEdit) apply(item.id)
              }}
            />
          ))}
          {shown.length === 0 && needle ? (
            <div className="ds-list__item ds-list__item--dim">{t('No cost code matches.')}</div>
          ) : null}
        </div>
        {creating ? (
          <div className="en-form2">
            <FormField label={t('Cost code')}>
              <Input value={code} onChange={setCode} placeholder={t('(automatic)')} maxLength={40} data-testid="new-code" />
            </FormField>
            <FormField label={t('Name')}>
              <Input value={name} onChange={setName} placeholder={t('Name')} maxLength={200} autoFocus data-testid="new-name" />
            </FormField>
            <FormField label={t('Basis')}>
              <Select
                block
                options={BASES.map((id) => ({ id, label: basisLabel(t, id) }))}
                value={basis}
                onChange={(id) => setBasis(id as Basis)}
                data-testid="new-basis"
              />
            </FormField>
            <FormField label={t('Unit')}>
              <Input value={unit} onChange={setUnit} placeholder={t('Unit')} maxLength={20} data-testid="new-unit" />
            </FormField>
            <FormField label={t('Unit price ¥')}>
              <Input value={price} onChange={setPrice} placeholder="0" maxLength={20} variant="mono" data-testid="new-price" />
            </FormField>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

/** One row of the pick list: a click picks it, a double-click applies it. */
function PickRow(props: {
  id: string
  label: string
  meta?: string
  tip?: string
  icon?: string
  chosen: boolean
  onPick: (id: string) => void
  onActivate?: () => void
}): JSX.Element {
  const { id, chosen, onPick } = props
  return (
    <div
      className={cx('ds-list__item', chosen && 'ds-sel')}
      role="option"
      aria-selected={chosen}
      tabIndex={0}
      data-testid="code-option"
      data-id={id}
      data-ds-tip={props.tip}
      onClick={() => onPick(id)}
      onDoubleClick={props.onActivate}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onPick(id)
      }}
    >
      {props.icon ? <Icon icon={props.icon} size="sm" /> : null}
      <span className="ds-list__label">{props.label}</span>
      {props.meta ? <span className="ds-list__meta">{props.meta}</span> : null}
    </div>
  )
}
