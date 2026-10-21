/**
 * The data-store key for one element.
 *
 * The Revit UniqueId is stable across snapshots, so an assignment survives a
 * re-export; the row index is not, and the ElementId is only unique per
 * document. Data-store keys must not contain `/`, which none of these do.
 *
 * `||` and not `??`: vim-web reports a missing UniqueId as an empty string.
 * ElementId `-1` means "no Revit id at all", so it cannot key anything — every
 * such element would share `id--1`. Those fall back to the row index, which is
 * snapshot-local: an assignment keyed that way does not survive a re-export.
 */
export function elementKey(element: {
  uniqueId?: string
  elementId: string
  index: number
}): string {
  if (element.uniqueId) return element.uniqueId
  return element.elementId === '-1' ? `index-${element.index}` : `id-${element.elementId}`
}
