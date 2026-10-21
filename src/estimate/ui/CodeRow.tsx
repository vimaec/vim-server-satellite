/**
 * One row of the Cost Codes tree: a Discipline or Group row (its counts), or a
 * cost code whose values are edited in place. Memoized as the element rows are.
 */
import { memo } from 'react'
import type { MouseEvent } from 'react'
import { Select, cx } from '../../ds'
import { amount, basisLabel, qtyText } from '../i18n'
import type { Translator } from '../i18n'
import { costCodeLabel } from '../grouping'
import type { CodeTreeNode } from '../grouping'
import { BASES } from '../types'
import type { Basis, CostCode } from '../types'
import type { CostCodeField } from '../useEstimate'
import { InlineNumber, InlineText } from './cells'

export type CodeRowContext = {
  t: Translator
  canEdit: boolean
  onClick: (node: CodeTreeNode, event: MouseEvent) => void
  onContextMenu: (node: CodeTreeNode, event: MouseEvent) => void
  onToggle: (key: string) => void
  onEdit: <K extends CostCodeField>(id: string, field: K, value: CostCode[K]) => void
}

/** Adders are fractions; the column shows and takes percent, to 3 decimals. */
const percent = (fraction: number): number => Math.round(fraction * 100000) / 1000

const stop = (event: MouseEvent): void => event.stopPropagation()

export const CodeRow = memo(function CodeRow(props: {
  node: CodeTreeNode
  open: boolean
  selected: boolean
  ctx: CodeRowContext
}): JSX.Element {
  const { node, open, selected, ctx } = props
  const { t, canEdit } = ctx
  const code = node.kind === 'code' ? node.code : null
  const number = (field: 'price' | 'laborDays' | 'laborRate', label: string): JSX.Element => (
    <InlineNumber
      value={code ? code[field] : null}
      disabled={!canEdit}
      placeholder="0"
      ariaLabel={label}
      data-testid={`code-${field}`}
      onCommit={(value) => code && ctx.onEdit(code.id, field, value ?? 0)}
    />
  )
  const adder = (field: 'matAdd' | 'labAdd', label: string): JSX.Element => (
    <InlineNumber
      value={code ? percent(code[field]) : null}
      disabled={!canEdit}
      placeholder="0"
      ariaLabel={label}
      data-testid={`code-${field}`}
      onCommit={(value) => code && ctx.onEdit(code.id, field, (value ?? 0) / 100)}
    />
  )

  return (
    <div
      className={cx(
        'ds-tree__item en-row',
        `ds-depth-${Math.min(node.depth, 3)}`,
        node.kind === 'group' ? open && 'ds-open' : 'ds-leaf',
        selected && 'ds-sel',
      )}
      style={{ ['--depth' as string]: node.depth }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={node.kind === 'group' ? open : undefined}
      data-testid="costcode-row"
      data-key={node.key}
      data-id={code?.id}
      data-depth={node.depth}
      data-selected={selected ? 'true' : 'false'}
      onClick={(event) => ctx.onClick(node, event)}
      onContextMenu={(event) => ctx.onContextMenu(node, event)}
    >
      <span className="en-lead">
        <span className="en-name">
          <span
            className="ds-tree__toggle"
            onClick={(event) => {
              event.stopPropagation()
              if (node.kind === 'group') ctx.onToggle(node.key)
            }}
          >
            <span className="ds-tree__caret" />
          </span>
          <span className="ds-tree__label">
            {node.kind === 'code'
              ? costCodeLabel(node.code)
              : node.value || t(node.level === 'discipline' ? '(No discipline)' : '(No group)')}
          </span>
        </span>
      </span>
      <span className="ds-tree__cell en-c-count">{node.count.toLocaleString()}</span>
      <span className="ds-tree__cell en-c-amount">{amount(node.amount)}</span>
      <span className="ds-tree__cell en-c-qty">{node.kind === 'code' ? qtyText(node.qty) : ''}</span>
      <span className="ds-tree__cell en-ctl en-c-basis" onClick={stop}>
        {code ? (
          <Select
            inline
            block
            options={BASES.map((basis) => ({ id: basis, label: basisLabel(t, basis) }))}
            value={code.basis}
            disabled={!canEdit}
            ariaLabel={t('Basis')}
            data-testid="code-basis"
            onChange={(basis) => ctx.onEdit(code.id, 'basis', basis as Basis)}
          />
        ) : null}
      </span>
      <span className="ds-tree__cell en-ctl en-c-unit" onClick={stop}>
        {code ? (
          <InlineText
            value={code.unit}
            maxLength={20}
            disabled={!canEdit}
            ariaLabel={t('Unit')}
            data-testid="code-unit"
            onCommit={(unit) => ctx.onEdit(code.id, 'unit', unit)}
          />
        ) : null}
      </span>
      <span className="ds-tree__cell en-ctl en-c-price" onClick={stop}>
        {code ? number('price', t('Unit price ¥')) : null}
      </span>
      <span className="ds-tree__cell en-ctl en-c-days" onClick={stop}>
        {code ? number('laborDays', t('Labor (days/unit)')) : null}
      </span>
      <span className="ds-tree__cell en-ctl en-c-rate" onClick={stop}>
        {code ? number('laborRate', t('Labor rate ¥/day')) : null}
      </span>
      <span className="ds-tree__cell en-ctl en-c-mat" onClick={stop}>
        {code ? adder('matAdd', t('Material adders %')) : null}
      </span>
      <span className="ds-tree__cell en-ctl en-c-lab" onClick={stop}>
        {code ? adder('labAdd', t('Labor adders %')) : null}
      </span>
    </div>
  )
})
