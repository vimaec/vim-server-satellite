/**
 * The Cost Codes tab (costsheet.js): the cost codes grouped Discipline ›
 * Group, each with its basis, unit, prices, labor and adders edited in place.
 * A click on a code selects its elements in 3D (on a group: the elements of
 * all its codes). Right-click a code for Edit…, Assign and Delete.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { Button, Empty, Menu, Search, Segmented, confirm, prompt, toast } from '../../ds'
import type { MenuEntry } from '../../ds'
import { buildCodeTree, costCodeLabel, visibleCodeRows } from '../grouping'
import type { CodeTreeNode } from '../grouping'
import { CodeRow } from './CodeRow'
import type { CodeRowContext } from './CodeRow'
import { useEstimateUi } from './context'
import { VirtualTree } from './VirtualTree'

const COLUMNS = {
  count: 76,
  amount: 92,
  qty: 68,
  basis: 96,
  unit: 56,
  price: 88,
  days: 80,
  rate: 88,
  mat: 76,
  lab: 76,
} as const
const NAME_MIN = 240
/** The row gap before each column and the row's right padding (styles.css). */
const GAP = 8
const PAD = 10
const MIN_WIDTH = NAME_MIN + Object.values(COLUMNS).reduce((sum, width) => sum + width + GAP, 0) + PAD
const COLUMN_VARS = Object.fromEntries([
  ['--en-lead-min', `${NAME_MIN}px`],
  ...Object.entries(COLUMNS).map(([name, width]) => [`--en-c-${name}`, `${width}px`]),
]) as CSSProperties

export function CostCodesTab(): JSX.Element {
  const ui = useEstimateUi()
  const { est, selected, select } = ui
  const { t, canEdit } = est
  const [inUse, setInUse] = useState(false)
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  // Closed groups, not open ones: a new discipline or group shows its codes at once.
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)

  const roots = useMemo(
    () => buildCodeTree({ costCodes: est.costCodes, usage: est.usage, search, inUse }),
    [est.costCodes, est.usage, inUse, search],
  )
  const open = useMemo(() => {
    const keys = new Set<string>()
    const walk = (nodes: readonly CodeTreeNode[]): void => {
      for (const node of nodes) {
        if (node.kind !== 'group') continue
        if (!closed.has(node.key)) keys.add(node.key)
        walk(node.children)
      }
    }
    walk(roots)
    return keys
  }, [closed, roots])
  const rows = useMemo(() => visibleCodeRows(roots, open), [open, roots])

  /** The codes whose elements are all selected: their rows show as selected. */
  const selectedCodes = useMemo(() => {
    const ids = new Set<string>()
    if (selected.size === 0) return ids
    for (const [id, use] of est.usage) {
      if (use.elements.length && use.elements.every((index) => selected.has(index))) ids.add(id)
    }
    return ids
  }, [est.usage, selected])

  const uiRef = useRef(ui)
  uiRef.current = ui
  const elementsOf = useCallback((node: CodeTreeNode): number[] => {
    const usage = uiRef.current.est.usage
    const ids = node.kind === 'code' ? [node.code.id] : node.codeIds
    const out = new Set<number>()
    for (const id of ids) for (const index of usage.get(id)?.elements ?? []) out.add(index)
    return [...out]
  }, [])

  const ctx = useMemo(
    (): CodeRowContext => ({
      t,
      canEdit,
      onClick: (node, event) => select(elementsOf(node), event.ctrlKey || event.metaKey ? 'toggle' : 'replace'),
      onContextMenu: (node, event) => {
        event.preventDefault()
        if (node.kind !== 'code') return
        setMenu({ x: event.clientX, y: event.clientY, items: codeMenu(node.code.id) })
      },
      onToggle: (key) =>
        setClosed((previous) => {
          const next = new Set(previous)
          if (!next.delete(key)) next.add(key)
          return next
        }),
      onEdit: est.updateCode,
    }),
    // codeMenu reads the latest state through uiRef.
    [canEdit, elementsOf, est.updateCode, select, t],
  )

  /** The row menu of one code. */
  function codeMenu(id: string): MenuEntry[] {
    const { est: current, selection, openEditCode } = uiRef.current
    const code = current.costCodes.get(id)
    const label = code ? costCodeLabel(code) : id
    return [
      { label: t('Edit…'), action: 'edit-code', onClick: () => openEditCode(id) },
      'separator',
      {
        label: t('Assign to the selected elements'),
        action: 'assign-code',
        disabled: !current.canEdit,
        onClick: () => {
          if (selection.length === 0) {
            toast(t('Select elements in the 3D view or the Elements tab first.'), 'warn')
            return
          }
          current.assign(selection, { code: id })
          toast(t('Cost code assigned to {n} elements.', { n: selection.length.toLocaleString() }), 'good')
        },
      },
      'separator',
      {
        label: t('Delete code'),
        action: 'delete-code',
        disabled: !current.canEdit,
        onClick: () =>
          void confirm({
            title: t('Delete code'),
            text: `${label}\n${t('Its elements lose this cost code.')}`,
            confirmLabel: t('Delete'),
            cancelLabel: t('Cancel'),
            destructive: true,
          }).then((ok) => {
            if (ok) current.deleteCode(id)
          }),
      },
    ]
  }

  const addCode = (): void => {
    void prompt({ title: t('Add code'), label: t('Name'), confirmLabel: t('OK'), cancelLabel: t('Cancel') }).then(
      (name) => {
        if (name) est.upsertCode({ name })
      },
    )
  }

  const header = (
    <div className="ds-tree__item en-row en-row--head">
      <span className="en-lead">
        <span className="en-name en-th">{t('Cost code')}</span>
      </span>
      <span className="ds-tree__cell en-th en-c-count">{t('Elements')}</span>
      <span className="ds-tree__cell en-th en-c-amount">{t('Amount ¥')}</span>
      <span className="ds-tree__cell en-th en-c-qty">{t('Qty')}</span>
      <span className="ds-tree__cell en-th en-ctl en-c-basis">{t('Basis')}</span>
      <span className="ds-tree__cell en-th en-ctl en-c-unit">{t('Unit')}</span>
      <span className="ds-tree__cell en-th en-c-price">{t('Unit price ¥')}</span>
      <span className="ds-tree__cell en-th en-c-days">{t('Labor (days/unit)')}</span>
      <span className="ds-tree__cell en-th en-c-rate">{t('Labor rate ¥/day')}</span>
      <span className="ds-tree__cell en-th en-c-mat">{t('Material adders %')}</span>
      <span className="ds-tree__cell en-th en-c-lab">{t('Labor adders %')}</span>
    </div>
  )

  return (
    <>
      <div className="en-tools">
        <Button icon="add" disabled={!canEdit} data-testid="costcode-add" onClick={addCode}>
          {t('Add code')}
        </Button>
        <Segmented
          className="en-push"
          options={[
            { id: 'all', label: t('All') },
            { id: 'used', label: t('In use') },
          ]}
          value={inUse ? 'used' : 'all'}
          onChange={(id) => setInUse(id === 'used')}
          data-testid="costcode-filter"
        />
      </div>
      <div className="en-searchrow">
        <Search
          value={text}
          onChange={setText}
          onSubmit={(value) => setSearch(value.trim())}
          placeholder={t('Search codes and names…')}
          data-testid="costcode-search"
        />
      </div>
      <div className="en-treewrap" style={COLUMN_VARS}>
        <VirtualTree
          data-testid="costcode-tree"
          rowCount={rows.length}
          minWidth={MIN_WIDTH}
          header={header}
          empty={<Empty title={search || inUse ? t('No cost code matches.') : t('No cost codes yet. Add a code.')} />}
          onContextMenu={(event: MouseEvent) => event.preventDefault()}
          renderRow={(i) => {
            const node = rows[i]
            const isSelected =
              node.kind === 'code'
                ? selectedCodes.has(node.code.id)
                : node.count > 0 && node.codeIds.every((id) => selectedCodes.has(id) || !est.usage.has(id))
            return <CodeRow key={node.key} node={node} open={open.has(node.key)} selected={isSelected} ctx={ctx} />
          }}
        />
        <Menu
          open={menu !== null}
          x={menu?.x ?? 0}
          y={menu?.y ?? 0}
          items={menu?.items ?? []}
          onClose={() => setMenu(null)}
          data-testid="context-menu"
        />
      </div>
    </>
  )
}
