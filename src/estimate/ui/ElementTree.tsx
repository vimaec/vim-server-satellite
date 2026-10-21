/**
 * The Elements tree: the view's groups and elements in a virtual list, with
 * the include checkboxes, the inline Work package / Cost code / Extra / Note
 * cells, row selection and the row menu.
 *
 * A row click selects its elements in 3D (Ctrl / Cmd toggles, Shift selects
 * the visible rows in between). A right-click opens the menu and leaves the
 * selection alone: the menu then acts on the whole selection when the row is
 * part of it, else on the row.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, MouseEvent, SetStateAction } from 'react'
import { Checkbox, Empty, Menu } from '../../ds'
import type { MenuEntry, SelectOption } from '../../ds'
import { checkState, costCodeLabel, groupKeysAbove, shownDepth, visibleRows, workPackageName } from '../grouping'
import type { GroupNode, TreeNode } from '../grouping'
import { useEstimateUi } from './context'
import { CLEAR, ElementRow, includeClass } from './ElementRow'
import type { RowContext } from './ElementRow'
import { elementMenu } from './menus'
import { VirtualTree } from './VirtualTree'

/** Column widths (px). One table for the CSS (custom properties) and the minimum width. */
const COLUMNS = { count: 56, amount: 92, qty: 68, wp: 132, code: 172, extra: 72, note: 160 } as const
/** The name column never gets narrower than this; below it the tree scrolls sideways. */
const NAME_MIN = 220
/** The check column, the row gap before each column, and the row's right padding (styles.css). */
const CHECK = 22
const GAP = 8
const PAD = 10
const MIN_WIDTH =
  CHECK + NAME_MIN + Object.values(COLUMNS).reduce((sum, width) => sum + width + GAP, 0) + PAD

const COLUMN_VARS = Object.fromEntries([
  ['--en-lead-min', `${CHECK + GAP - 2 + NAME_MIN}px`],
  ...Object.entries(COLUMNS).map(([name, width]) => [`--en-c-${name}`, `${width}px`]),
]) as CSSProperties

const elementsOf = (node: TreeNode): number[] => (node.kind === 'group' ? node.elements : [node.index])

/** The keys of the groups whose every element is selected (they show as selected rows). */
function selectedGroups(root: GroupNode, selected: ReadonlySet<number>): Set<string> {
  const keys = new Set<string>()
  if (selected.size === 0) return keys
  const walk = (node: GroupNode): boolean => {
    let all = node.children.length > 0
    for (const child of node.children) {
      const on = child.kind === 'group' ? walk(child) : selected.has(child.index)
      all &&= on
    }
    if (all && node.depth >= 0) keys.add(node.key)
    return all
  }
  walk(root)
  return keys
}

/** The open groups (by key, so they stay open across data changes), with the toolbar's two steps. */
export type OpenGroups = {
  keys: Set<string>
  setKeys: Dispatch<SetStateAction<Set<string>>>
  /** Collapse all. */
  collapse: () => void
  /** Open one more level below the deepest one showing. */
  expand: () => void
}

export function useOpenGroups(root: GroupNode, search: string): OpenGroups {
  const [keys, setKeys] = useState<Set<string>>(() => new Set())
  const rootRef = useRef(root)
  rootRef.current = root

  // First look at a model: open the top level, so the tree does not start as one closed row.
  const openedOnce = useRef(false)
  useEffect(() => {
    if (openedOnce.current || root.children.length === 0) return
    openedOnce.current = true
    setKeys(groupKeysAbove(root, 1))
  }, [root])

  // A search opens every group, so its matches are on screen. Only when the
  // search text changes (this render's root already reflects it): later data
  // changes keep the reader's open groups.
  useEffect(() => {
    if (search) setKeys(groupKeysAbove(rootRef.current, Number.POSITIVE_INFINITY))
  }, [search])

  const collapse = useCallback(() => setKeys(new Set()), [])
  const expand = useCallback(
    () =>
      setKeys((previous) => {
        const next = new Set(previous)
        for (const key of groupKeysAbove(rootRef.current, shownDepth(rootRef.current, previous) + 1)) next.add(key)
        return next
      }),
    [],
  )
  return useMemo(() => ({ keys, setKeys, collapse, expand }), [collapse, expand, keys])
}

export type ElementTreeProps = {
  /** Shown instead of the tree while there is no model to list (opening, loading, no VIM). */
  placeholder?: string
  open: Set<string>
  setOpen: Dispatch<SetStateAction<Set<string>>>
}

export function ElementTree({ placeholder, open, setOpen }: ElementTreeProps): JSX.Element {
  const ui = useEstimateUi()
  const { est, view, selected, select } = ui
  const { t, canEdit } = est
  const { root, prefs, search, paint } = view

  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const anchorRef = useRef<string | null>(null)

  const rows = useMemo(() => visibleRows(root, open), [root, open])
  const selectedKeys = useMemo(() => selectedGroups(root, selected), [root, selected])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const uiRef = useRef(ui)
  uiRef.current = ui

  const wpOptions = useMemo((): SelectOption[] => {
    const packages = [...est.workPackages.values()].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1))
    return [
      { id: CLEAR, label: t('(Clear)'), separatorAfter: true },
      ...packages.map((wp, i) => ({
        id: wp.id,
        label: workPackageName(wp, est.lang),
        separatorAfter: i === packages.length - 1,
      })),
    ]
  }, [est.lang, est.workPackages, t])

  // The codes the sheet uses (as the original): the full list is one click away in the dialog.
  const codeOptions = useMemo((): SelectOption[] => {
    const used = [...est.usage.keys()]
      .map((id) => est.costCodes.get(id))
      .filter((code) => code !== undefined)
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    return [
      { id: CLEAR, label: t('(Clear)'), separatorAfter: true },
      ...used.map((code, i) => ({ id: code.id, label: costCodeLabel(code), separatorAfter: i === used.length - 1 })),
    ]
  }, [est.costCodes, est.usage, t])

  const onClick = useCallback(
    (node: TreeNode, event: MouseEvent) => {
      const additive = event.ctrlKey || event.metaKey
      const list = rowsRef.current
      const from = anchorRef.current === null ? -1 : list.findIndex((row) => row.key === anchorRef.current)
      if (event.shiftKey && from >= 0) {
        const to = list.findIndex((row) => row.key === node.key)
        const range = new Set<number>()
        for (let i = Math.min(from, to); i <= Math.max(from, to); i++) for (const index of elementsOf(list[i])) range.add(index)
        select([...range], additive ? 'add' : 'replace')
        return
      }
      anchorRef.current = node.key
      select(elementsOf(node), additive ? 'toggle' : 'replace')
    },
    [select],
  )

  const onContextMenu = useCallback((node: TreeNode, event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const current = uiRef.current
    const own = elementsOf(node)
    // As the original: on a row that is part of the selection, the menu acts on all of it.
    const targets = own.length > 0 && own.every((index) => current.selected.has(index)) ? current.selection : own
    const copyFrom = node.kind === 'element' && node.row.code ? node.index : null
    const workPackage = node.kind === 'group' && node.level === 'wp' && node.value ? node.value : undefined
    const items = elementMenu(current, targets, {
      copyFrom,
      workPackage,
      // Rename… edits the group label in place, as a double-click does.
      onRenameWorkPackage: () => setRenaming(node.key),
    })
    setMenu({ x: event.clientX, y: event.clientY, items })
  }, [])

  // The rows' context depends on the stable verbs and the data the rows show, not on `est`
  // itself: a new `est` must not re-render every visible row unless what they show changed.
  const { assign, setIncluded, renameWorkPackage, lang, workPackages, costCodes } = est
  const ctx = useMemo(
    (): RowContext => ({
      t,
      canEdit,
      labels: { t, lang, workPackages, costCodes },
      wpOptions,
      codeOptions,
      onClick,
      onContextMenu,
      onToggle: (key) =>
        setOpen((previous) => {
          const next = new Set(previous)
          if (!next.delete(key)) next.add(key)
          return next
        }),
      onCheck: (node, included) => setIncluded(elementsOf(node), included),
      onWorkPackage: (node, id) => void assign(elementsOf(node), { wp: id === CLEAR ? null : id }),
      onCode: (node, id) => void assign(elementsOf(node), { code: id === CLEAR ? null : id }),
      onPickWorkPackage: (node) => uiRef.current.openWorkPackage(elementsOf(node)),
      onPickCode: (node) => uiRef.current.openCostCode(elementsOf(node)),
      onExtra: (index, value) => void assign([index], { extra: value }),
      onNote: (index, text) => void assign([index], { note: text || null }),
      onStartRename: (node) => setRenaming(node.key),
      onRename: (wpId, name) => renameWorkPackage(wpId, name),
      onEndRename: () => setRenaming(null),
    }),
    [
      assign,
      canEdit,
      codeOptions,
      costCodes,
      lang,
      onClick,
      onContextMenu,
      renameWorkPackage,
      setIncluded,
      setOpen,
      t,
      workPackages,
      wpOptions,
    ],
  )

  const swatches = paint.swatches
  const rootCheck = checkState(root)
  const headState = rootCheck === 'checked' ? 'on' : rootCheck === 'partial' ? 'partial' : 'off'
  const header = (
    <div className="ds-tree__item en-row en-row--head">
      <span className="en-lead">
        <span className="ds-tree__check">
          <Checkbox
            state={root.count === 0 ? 'off' : headState}
            className={includeClass(headState)}
            disabled={!canEdit || root.count === 0 || root.unkeyed === root.count}
            ariaLabel={t('Included')}
            tip={`${t('Include')} / ${t('Exclude')}`}
            data-testid="tree-check-all"
            onChange={(next) => est.setIncluded(root.elements, next === 'on')}
          />
        </span>
        <span className="en-name en-th">{t('Name')}</span>
      </span>
      <span className="ds-tree__cell en-th en-c-count">{t('Count')}</span>
      <span className="ds-tree__cell en-th en-c-amount">{t('Amount ¥')}</span>
      <span className="ds-tree__cell en-th en-c-qty">{t('Qty')}</span>
      <span className="ds-tree__cell en-th en-ctl en-c-wp">{t('Work package')}</span>
      <span className="ds-tree__cell en-th en-ctl en-c-code">{t('Cost code')}</span>
      <span className="ds-tree__cell en-th en-ctl en-c-extra">{t('Extra ¥')}</span>
      <span className="ds-tree__cell en-th en-ctl en-c-note">{t('Note')}</span>
    </div>
  )

  const emptyText = placeholder ?? (search || prefs.show !== 'all' ? t('No element matches the search.') : t('No elements.'))

  return (
    <div className="en-treewrap" style={COLUMN_VARS}>
      <VirtualTree
        data-testid="estimate-tree"
        rowCount={placeholder ? 0 : rows.length}
        minWidth={MIN_WIDTH}
        header={header}
        empty={<Empty title={emptyText} />}
        renderRow={(i) => {
          const node = rows[i]
          return (
            <ElementRow
              key={node.key}
              node={node}
              open={open.has(node.key)}
              selected={node.kind === 'element' ? selected.has(node.index) : selectedKeys.has(node.key)}
              swatch={
                swatches && node.kind === 'group' && node.level === swatches.level
                  ? swatches.byValue.get(node.value)
                  : undefined
              }
              renaming={renaming === node.key}
              ctx={ctx}
            />
          )
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
  )
}
