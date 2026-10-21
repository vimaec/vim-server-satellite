/**
 * The data-store key for one element: its Revit UniqueId, or null when it has
 * none.
 *
 * Only the UniqueId may key anything stored. The row index moves with every
 * export, so an assignment keyed by it would land on another element after a
 * re-export; the ElementId is only unique inside one Revit document, so in a
 * merged VIM two documents' elements would share one key. An element with no
 * UniqueId is still listed and priced (as unassigned and included), but
 * nothing can be stored for it, so the UI disables its write controls and bulk
 * writes skip it. Data-store keys must not contain `/`, which a UniqueId does
 * not.
 *
 * `||` and not `??`: vim-web reports a missing UniqueId as an empty string.
 */
export function elementKey(element: { uniqueId?: string }): string | null {
  return element.uniqueId || null
}
