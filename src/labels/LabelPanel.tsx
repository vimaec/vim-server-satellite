/**
 * The label editor: the palette, what is labelled, and the write status.
 *
 * It holds no label state of its own — everything comes from useLabels — apart
 * from the two fields of the "add a label" form.
 */
import { useMemo, useState } from 'react'
import type { ModelElement } from '../tree/buildModel'
import { elementKey } from './types'
import type { Assignment, Label } from './types'
import type { LabelsStatus } from './useLabels'

export type LabelPanelProps = {
  labels: Label[]
  assignments: Map<string, Assignment>
  /** The loaded snapshot, used to resolve assignment keys back to elements. */
  elements: ModelElement[]
  status: LabelsStatus
  error: string
  /** False for the Viewer role: the whole panel is read-only. */
  canWrite: boolean
  /** How many elements the label actions would touch. */
  selectionCount: number
  onApply: (labelId: string) => void
  onRemove: () => void
  onAdd: (name: string, color: string) => void
  onDelete: (labelId: string) => void
  /** Select and frame one element (clicking a row in the labelled list). */
  onPick: (index: number) => void
}

/** Matches --accent in styles.css: the new-label form starts on the app blue. */
const NEW_LABEL_COLOR = '#1f6feb'

const STATUS_TEXT: Record<LabelsStatus, string> = {
  idle: 'Select elements, then pick a label.',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Could not save.',
  readonly: 'Read-only: labels need the Manager role.',
}

type LabelledRow = {
  element: ModelElement
  key: string
  labelName: string
  color: string
}

export function LabelPanel({
  labels,
  assignments,
  elements,
  status,
  error,
  canWrite,
  selectionCount,
  onApply,
  onRemove,
  onAdd,
  onDelete,
  onPick,
}: LabelPanelProps): JSX.Element {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(NEW_LABEL_COLOR)

  const labelled = useMemo<LabelledRow[]>(() => {
    if (assignments.size === 0) return []
    const labelById = new Map(labels.map((label) => [label.id, label]))
    const rows: LabelledRow[] = []
    for (const element of elements) {
      const key = elementKey(element)
      const assignment = assignments.get(key)
      const label = assignment ? labelById.get(assignment.labelId) : undefined
      if (!assignment || !label) continue
      rows.push({ element, key, labelName: label.name, color: label.color })
    }
    return rows.sort((a, b) => a.labelName.localeCompare(b.labelName))
  }, [assignments, elements, labels])

  const canApply = canWrite && selectionCount > 0

  return (
    <section className="label-panel" data-testid="label-panel">
      <h2>Labels</h2>

      <ul className="label-list">
        {labels.map((label) => (
          <li key={label.id} className="label-item" data-testid="label-item" data-label-id={label.id}>
            <span className="swatch" style={{ background: label.color }} />
            <span className="label-name">{label.name}</span>
            <button type="button" data-testid="label-apply" disabled={!canApply} onClick={() => onApply(label.id)}>
              Apply
            </button>
            <button
              type="button"
              className="icon"
              title={`Delete the ${label.name} label`}
              data-testid="label-delete"
              disabled={!canWrite}
              onClick={() => onDelete(label.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <button type="button" data-testid="label-remove" disabled={!canApply} onClick={onRemove}>
        Remove label from selection ({selectionCount})
      </button>

      <form
        className="label-new"
        onSubmit={(event) => {
          event.preventDefault()
          onAdd(newName, newColor)
          setNewName('')
        }}
      >
        <input
          type="text"
          data-testid="label-new-name"
          placeholder="New label"
          value={newName}
          disabled={!canWrite}
          onChange={(event) => setNewName(event.target.value)}
        />
        <input
          type="color"
          data-testid="label-new-color"
          aria-label="New label color"
          value={newColor}
          disabled={!canWrite}
          onChange={(event) => setNewColor(event.target.value)}
        />
        <button type="submit" data-testid="label-new-add" disabled={!canWrite}>
          Add
        </button>
      </form>

      <p className="label-status small" data-testid="label-status" data-state={status}>
        {status === 'error' && error ? error : STATUS_TEXT[status]}
      </p>

      <p className="small">
        <strong data-testid="labelled-count">{labelled.length}</strong> labelled element
        {labelled.length === 1 ? '' : 's'}
      </p>

      <ul className="labelled-list">
        {labelled.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              className="link labelled-element"
              data-testid="labelled-element"
              data-element-key={row.key}
              onClick={() => onPick(row.element.index)}
            >
              <span className="swatch small-swatch" style={{ background: row.color }} />
              {row.element.name || 'Element'} [{row.element.elementId}]
              <span className="muted"> · {row.labelName}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
