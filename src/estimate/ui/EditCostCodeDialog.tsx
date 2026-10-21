/**
 * Edit… (Cost Codes tab, dialogs.js `openEditCodeDialog`): every value of one
 * cost code in a two-column form. Save writes only what the user changed, so a
 * value shown rounded is never written back rounded.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, FormField, Input, Modal, Select } from '../../ds'
import { basisLabel, parseNumber } from '../i18n'
import { BASES } from '../types'
import type { Basis, CostCode } from '../types'
import type { CostCodeField } from '../useEstimate'
import { useEstimateUi } from './context'

/** The form's text for a number; adders are fractions shown as percent. */
function numberText(value: number | undefined, percent = false): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return ''
  return String(percent ? Math.round(value * 100000) / 1000 : value)
}

type Draft = Record<Exclude<CostCodeField, 'basis'>, string> & { basis: Basis }

function draftOf(code: CostCode): Draft {
  return {
    code: code.code,
    name: code.name,
    descr: code.descr,
    discipline: code.discipline,
    grp: code.grp,
    unit: code.unit,
    basis: code.basis,
    price: numberText(code.price),
    laborDays: numberText(code.laborDays),
    laborRate: numberText(code.laborRate),
    matAdd: numberText(code.matAdd, true),
    labAdd: numberText(code.labAdd, true),
  }
}

const NUMBER_FIELDS = ['price', 'laborDays', 'laborRate'] as const
const PERCENT_FIELDS = ['matAdd', 'labAdd'] as const

export function EditCostCodeDialog({ id, onClose }: { id: string; onClose: () => void }): JSX.Element | null {
  const { est } = useEstimateUi()
  const { t, canEdit } = est
  const code = est.costCodes.get(id)
  const [initial] = useState(() => (code ? draftOf(code) : null))
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  if (!code || !draft || !initial) return null

  const set = <K extends keyof Draft>(field: K, value: Draft[K]): void => setDraft({ ...draft, [field]: value })

  const save = (): void => {
    const typed = draft.code.trim()
    if (!typed) {
      setError(t('Enter a code.'))
      return
    }
    if ([...est.costCodes.values()].some((other) => other.id !== id && other.code === typed)) {
      setError(t('Another cost code already uses this code.'))
      return
    }
    for (const field of ['code', 'name', 'descr', 'discipline', 'grp', 'unit'] as const) {
      if (draft[field].trim() !== initial[field].trim()) est.updateCode(id, field, draft[field].trim())
    }
    if (draft.basis !== initial.basis) est.updateCode(id, 'basis', draft.basis)
    for (const field of NUMBER_FIELDS) {
      if (draft[field] !== initial[field]) est.updateCode(id, field, parseNumber(draft[field]) ?? 0)
    }
    for (const field of PERCENT_FIELDS) {
      if (draft[field] !== initial[field]) est.updateCode(id, field, (parseNumber(draft[field]) ?? 0) / 100)
    }
    onClose()
  }

  const text = (field: keyof Omit<Draft, 'basis'>, label: string, options: { wide?: boolean; max?: number; mono?: boolean } = {}): ReactNode => (
    <FormField
      label={label}
      className={options.wide ? 'en-form2__wide' : undefined}
      error={field === 'code' ? error : null}
    >
      <Input
        value={draft[field]}
        onChange={(value) => {
          if (field === 'code') setError(null)
          set(field, value)
        }}
        maxLength={options.max ?? 200}
        variant={options.mono ? 'mono' : undefined}
        disabled={!canEdit}
        data-testid={`edit-${field}`}
      />
    </FormField>
  )

  return (
    <Modal
      open
      size="md"
      title={t('Edit cost code')}
      data-testid="dialog"
      onClose={onClose}
      foot={
        <>
          <Button variant="ghost" data-testid="dialog-cancel" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" data-testid="dialog-confirm" disabled={!canEdit} onClick={save}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="en-form2">
        {text('code', t('Cost code'), { max: 40 })}
        {text('discipline', t('Discipline'), { max: 80 })}
        {text('name', t('Name'), { wide: true })}
        {text('descr', t('Description'), { wide: true, max: 500 })}
        {text('grp', t('Group'), { max: 80 })}
        <FormField label={t('Basis')}>
          <Select
            block
            options={BASES.map((basis) => ({ id: basis, label: basisLabel(t, basis) }))}
            value={draft.basis}
            onChange={(value) => set('basis', value as Basis)}
            disabled={!canEdit}
            data-testid="edit-basis"
          />
        </FormField>
        {text('unit', t('Unit'), { max: 20 })}
        {text('price', t('Unit price ¥'), { max: 20, mono: true })}
        {text('laborDays', t('Labor (days/unit)'), { max: 20, mono: true })}
        {text('laborRate', t('Labor rate ¥/day'), { max: 20, mono: true })}
        {text('matAdd', t('Material adders %'), { max: 20, mono: true })}
        {text('labAdd', t('Labor adders %'), { max: 20, mono: true })}
      </div>
    </Modal>
  )
}
