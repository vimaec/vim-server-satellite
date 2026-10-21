/**
 * The right-click menu on elements, shared by the tree rows and the 3D view
 * (the same verbs as estimate.html's viewport menu and elements.js `menuFor`).
 * Write verbs are shown disabled for a read-only user, so the menu still says
 * what the estimate can do.
 *
 * Every item carries a stable `data-action` for tests.
 */
import { confirm } from '../../ds'
import type { MenuEntry } from '../../ds'
import { costCodeLabel, workPackageName } from '../grouping'
import type { EstimateUi } from './context'

export type ElementMenuOptions = {
  /** The element whose cost code Copy takes, or null (Copy disabled). */
  copyFrom: number | null
  /** On a work package group row: that package's id (adds Rename… and Delete). */
  workPackage?: string
  /** Rename… of that package (the tree edits the group label in place). */
  onRenameWorkPackage?: () => void
}

export function elementMenu(ui: EstimateUi, targets: readonly number[], options: ElementMenuOptions): MenuEntry[] {
  const { est } = ui
  const { t, canEdit } = est
  const none = targets.length === 0
  const write = !canEdit || none
  const copied = est.copiedCode ? est.costCodes.get(est.copiedCode) : undefined
  const items: MenuEntry[] = [
    { label: t('Set Cost Code…'), action: 'set-code', disabled: write, onClick: () => ui.openCostCode(targets) },
    {
      label: t('Copy Cost Code'),
      hint: 'Ctrl+C',
      action: 'copy-code',
      disabled: options.copyFrom === null,
      onClick: () => {
        if (options.copyFrom !== null) ui.notify(est.copyCode([options.copyFrom]))
      },
    },
    {
      label: t('Paste Cost Code'),
      hint: 'Ctrl+V',
      action: 'paste-code',
      disabled: write || !copied,
      tip: copied ? costCodeLabel(copied) : undefined,
      onClick: () => ui.notify(est.pasteCode(targets)),
    },
    'separator',
    { label: t('Set Work Package…'), action: 'set-wp', disabled: write, onClick: () => ui.openWorkPackage(targets) },
    'separator',
    { label: t('Include'), action: 'include', disabled: write, onClick: () => est.setIncluded(targets, true) },
    { label: t('Exclude'), action: 'exclude', disabled: write, onClick: () => est.setIncluded(targets, false) },
    'separator',
    {
      label: t('Clear work package and cost code'),
      action: 'clear',
      disabled: write,
      onClick: () => est.assign(targets, { wp: null, code: null }),
    },
  ]
  const wp = options.workPackage ? est.workPackages.get(options.workPackage) : undefined
  if (wp) {
    items.push(
      'separator',
      {
        label: t('Rename…'),
        action: 'rename-wp',
        disabled: !canEdit,
        onClick: () => options.onRenameWorkPackage?.(),
      },
      {
        label: t('Delete work package'),
        action: 'delete-wp',
        disabled: !canEdit,
        onClick: () => void deleteWorkPackage(ui, wp.id),
      },
    )
  }
  return items
}

async function deleteWorkPackage(ui: EstimateUi, id: string): Promise<void> {
  const { est } = ui
  const wp = est.workPackages.get(id)
  if (!wp) return
  const ok = await confirm({
    title: est.t('Delete work package'),
    text: `${workPackageName(wp, est.lang)}\n${est.t('Its elements keep their cost codes and lose the work package.')}`,
    confirmLabel: est.t('Delete'),
    cancelLabel: est.t('Cancel'),
    destructive: true,
  })
  if (ok) est.deleteWorkPackage(id)
}
