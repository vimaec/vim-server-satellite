/** Turns label assignments into the color override map the viewer wants. */
import type { ModelElement } from '../tree/buildModel'
import { elementKey } from './types'
import type { Assignment, Palette } from './types'

/**
 * Assignments are keyed by UniqueId (stable across snapshots) but the viewer
 * only colors by element index, so the keys are resolved through the elements of
 * the snapshot that is actually loaded. An assignment for an element that is not
 * in this snapshot, or for a label that no longer exists, simply drops out.
 */
export function labelColors(
  assignments: Map<string, Assignment>,
  palette: Palette,
  elements: ModelElement[],
): Map<number, string> {
  if (assignments.size === 0) return new Map()
  const colorByLabel = new Map(palette.labels.map((label) => [label.id, label.color]))
  const colors = new Map<number, string>()
  for (const element of elements) {
    const assignment = assignments.get(elementKey(element))
    if (!assignment) continue
    const color = colorByLabel.get(assignment.labelId)
    if (color) colors.set(element.index, color)
  }
  return colors
}
