/**
 * Set Work Package (dialogs.js `openWorkPackageDialog`): a new package (typed),
 * none, or an existing one. It opens on the elements' package when they all
 * share one, else on "New work package…".
 */
import { useState } from 'react'
import { Button, FormField, Input, Modal, Select } from '../../ds'
import type { SelectOption } from '../../ds'
import { workPackageName } from '../grouping'
import { COUNT, tn } from '../i18n'
import { useEstimateUi } from './context'

const NEW = '+new'
const NONE = '+none'

export function SetWorkPackageDialog({ elements, onClose }: { elements: number[]; onClose: () => void }): JSX.Element {
  const { est } = useEstimateUi()
  const { t, canEdit } = est

  // Read once, when the dialog opens: the choice must not jump while it is open.
  const [choice, setChoice] = useState<string>(() => {
    let first: string | null | undefined
    for (const index of elements) {
      const wp = est.priced.get(index)?.wp ?? null
      if (first === undefined) first = wp
      else if (wp !== first) return NEW
    }
    return first ?? NEW
  })
  const [name, setName] = useState('')

  const packages = [...est.workPackages.values()].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1))
  const options: SelectOption[] = [
    { id: NEW, label: t('New work package…') },
    { id: NONE, label: t('(No work package)'), separatorAfter: packages.length > 0 },
    ...packages.map((wp) => ({ id: wp.id, label: workPackageName(wp, est.lang) })),
  ]
  const ready = canEdit && (choice !== NEW || name.trim() !== '')

  const commit = (): void => {
    if (!ready) return
    // addWorkPackage returns the existing package when the typed name spells one.
    const wp = choice === NONE ? null : choice === NEW ? est.addWorkPackage(name) : choice
    if (choice === NEW && !wp) return
    onClose()
    est.assign(elements, { wp })
  }

  return (
    <Modal
      open
      variant="confirm"
      title={tn(t, COUNT.setWorkPackage, elements.length)}
      data-testid="dialog"
      onClose={onClose}
      foot={
        <>
          <Button variant="ghost" data-testid="dialog-cancel" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" data-testid="dialog-confirm" disabled={!ready} onClick={commit}>
            {t('Apply')}
          </Button>
        </>
      }
    >
      <FormField label={t('Work package')}>
        <Select block options={options} value={choice} onChange={setChoice} data-testid="wp-select" />
      </FormField>
      {choice === NEW ? (
        <FormField label={t('Name')}>
          <Input
            value={name}
            onChange={setName}
            placeholder={t('Name')}
            maxLength={200}
            autoFocus
            data-testid="wp-name"
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              commit()
            }}
          />
        </FormField>
      ) : null}
    </Modal>
  )
}
