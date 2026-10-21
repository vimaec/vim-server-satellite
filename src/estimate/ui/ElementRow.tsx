/**
 * One row of the Elements tree: a group (a value of a Group by level) or an
 * element. Group rows show their aggregates and set a work package or cost
 * code on all their members; element rows also take Extra and Note.
 *
 * Memoized: while the user scrolls, rows that stay in the window are not
 * rendered again. Everything a row calls goes through `ctx`, which only
 * changes with the estimate data, so the memo holds across scroll frames.
 */
import { memo } from 'react'
import type { MouseEvent } from 'react'
import { Checkbox, Select, cx } from '../../ds'
import type { CheckboxState, SelectOption } from '../../ds'
import { NO_KEY, amount, qtyText, tn } from '../i18n'
import { MIXED, checkState, groupLabel } from '../grouping'
import type { LabelContext, TreeNode } from '../grouping'
import type { Translator } from '../i18n'
import { InlineNumber, InlineText } from './cells'

/** The id of the "(Clear)" option of the row selects: never a work package or code id. */
export const CLEAR = '+clear'

/** What every row shares. Built once per data change by the tree. */
export type RowContext = {
  t: Translator
  canEdit: boolean
  labels: LabelContext
  /** (Clear), then the work packages. */
  wpOptions: SelectOption[]
  /** (Clear), then the codes the sheet uses. */
  codeOptions: SelectOption[]
  onClick: (node: TreeNode, event: MouseEvent) => void
  onContextMenu: (node: TreeNode, event: MouseEvent) => void
  onToggle: (key: string) => void
  onCheck: (node: TreeNode, included: boolean) => void
  /** A row select picked a value (an id, or CLEAR). */
  onWorkPackage: (node: TreeNode, id: string) => void
  onCode: (node: TreeNode, id: string) => void
  /** "New work package…" / "Choose from Cost Codes…". */
  onPickWorkPackage: (node: TreeNode) => void
  onPickCode: (node: TreeNode) => void
  onExtra: (index: number, value: number | null) => void
  onNote: (index: number, text: string) => void
  /** Double-click on a work package group's label. */
  onStartRename: (node: TreeNode) => void
  onRename: (wpId: string, name: string) => void
  onEndRename: () => void
}

export type ElementRowProps = {
  node: TreeNode
  open: boolean
  selected: boolean
  /** The coloured level's colour for this group, when Display colours its level. */
  swatch?: string
  renaming: boolean
  ctx: RowContext
}

const TO_DS: Record<ReturnType<typeof checkState>, CheckboxState> = {
  checked: 'on',
  unchecked: 'off',
  partial: 'partial',
}

/** The include box: the DS include family (green), as the original's checked rules. */
export function includeClass(state: CheckboxState): string | undefined {
  return state === 'on' ? 'ds-chk--include' : state === 'partial' ? 'ds-chk--includePartial' : undefined
}

/** Clicks inside a cell's control must not reach the row (which selects). */
const stop = (event: MouseEvent): void => event.stopPropagation()

export const ElementRow = memo(function ElementRow(props: ElementRowProps): JSX.Element {
  const { node, open, selected, swatch, renaming, ctx } = props
  const { t, canEdit } = ctx
  const group = node.kind === 'group' ? node : null
  const leaf = node.kind === 'element' ? node : null
  const check = TO_DS[checkState(node)]
  const missing = group ? group.missing > 0 : leaf?.row.missing === true

  const wp = group ? group.wp : (leaf?.row.wp ?? '')
  const code = group ? group.code : (leaf?.row.code ?? '')
  const qty = group ? group.qty : (leaf?.row.qty ?? null)
  const wpGroupId = group && group.level === 'wp' && group.value ? group.value : null
  // Nothing can be stored for an element with no UniqueId (keys.ts): its controls, and
  // those of a group made only of such elements, are disabled and say why.
  const noKey = leaf ? leaf.facts.key === null : group !== null && group.count > 0 && group.unkeyed === group.count
  const noKeyTip = noKey ? tn(t, NO_KEY, group ? group.count : 1) : undefined
  const writable = canEdit && !noKey

  return (
    <div
      className={cx(
        'ds-tree__item en-row',
        `ds-depth-${Math.min(node.depth, 3)}`,
        group ? open && 'ds-open' : 'ds-leaf',
        selected && 'ds-sel',
        missing && 'ds-rowtint ds-rowtint--warn',
      )}
      style={{ ['--depth' as string]: node.depth }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={group ? open : undefined}
      data-testid="tree-row"
      data-key={node.key}
      data-depth={node.depth}
      data-selected={selected ? 'true' : 'false'}
      onClick={(event) => ctx.onClick(node, event)}
      onContextMenu={(event) => ctx.onContextMenu(node, event)}
    >
      <span className="en-lead">
        <span className="ds-tree__check" onClick={stop}>
          <Checkbox
            state={check}
            className={includeClass(check)}
            disabled={!writable}
            ariaLabel={t('Included')}
            tip={noKeyTip}
            data-testid="row-check"
            onChange={(next) => ctx.onCheck(node, next === 'on')}
          />
        </span>
        <span className="en-name">
          <span
            className="ds-tree__toggle"
            onClick={(event) => {
              event.stopPropagation()
              if (group) ctx.onToggle(group.key)
            }}
          >
            <span className="ds-tree__caret" />
          </span>
          {swatch ? <span className="ds-seldot" style={{ background: swatch }} /> : null}
          {renaming && wpGroupId ? (
            <span className="en-rename" onClick={stop}>
              <InlineText
                value={group ? groupLabel('wp', wpGroupId, ctx.labels) : ''}
                autoFocus
                maxLength={200}
                ariaLabel={t('Rename work package')}
                data-testid="row-rename"
                onCommit={(name) => {
                  if (name) ctx.onRename(wpGroupId, name)
                }}
                onDone={ctx.onEndRename}
              />
            </span>
          ) : (
            <span
              className="ds-tree__label"
              onDoubleClick={wpGroupId && canEdit ? () => ctx.onStartRename(node) : undefined}
            >
              {leaf ? (
                <>
                  <span className="en-eid">{leaf.facts.elementId}</span>
                  {leaf.facts.name}
                </>
              ) : (
                groupLabel(group?.level ?? 'category', group?.value ?? '', ctx.labels)
              )}
            </span>
          )}
        </span>
      </span>
      <span className="ds-tree__cell en-c-count">{group ? group.count.toLocaleString() : ''}</span>
      <span className="ds-tree__cell en-c-amount">{amount(node.kind === 'group' ? node.amount : node.row.amount)}</span>
      <span className="ds-tree__cell en-c-qty">{qtyText(qty)}</span>
      <span className="ds-tree__cell en-ctl en-c-wp" data-ds-tip={noKeyTip} onClick={stop}>
        <Select
          inline
          block
          options={[
            ...ctx.wpOptions,
            { id: '+new', label: t('New work package…'), action: () => ctx.onPickWorkPackage(node) },
          ]}
          value={wp && wp !== MIXED ? wp : null}
          placeholder={wp === MIXED ? t('(mixed)') : '—'}
          disabled={!writable}
          ariaLabel={t('Work package')}
          data-testid="row-wp"
          onChange={(id) => ctx.onWorkPackage(node, id)}
        />
      </span>
      <span className="ds-tree__cell en-ctl en-c-code" data-ds-tip={noKeyTip} onClick={stop}>
        <Select
          inline
          block
          options={[
            ...ctx.codeOptions,
            { id: '+choose', label: t('Choose from Cost Codes…'), action: () => ctx.onPickCode(node) },
          ]}
          value={code && code !== MIXED ? code : null}
          placeholder={code === MIXED ? t('(mixed)') : '—'}
          disabled={!writable}
          ariaLabel={t('Cost code')}
          data-testid="row-code"
          onChange={(id) => ctx.onCode(node, id)}
        />
      </span>
      <span className="ds-tree__cell en-ctl en-c-extra" data-ds-tip={noKeyTip} onClick={stop}>
        {leaf ? (
          <InlineNumber
            value={leaf.row.extra}
            format={(value) => String(value)}
            disabled={!writable}
            ariaLabel={t('Extra ¥')}
            data-testid="row-extra"
            onCommit={(value) => ctx.onExtra(leaf.index, value)}
          />
        ) : null}
      </span>
      <span className="ds-tree__cell en-ctl en-c-note" data-ds-tip={noKeyTip} onClick={stop}>
        {leaf ? (
          <InlineText
            value={leaf.row.note}
            maxLength={500}
            disabled={!writable}
            ariaLabel={t('Note')}
            data-testid="row-note"
            onCommit={(text) => ctx.onNote(leaf.index, text)}
          />
        ) : null}
      </span>
    </div>
  )
})
