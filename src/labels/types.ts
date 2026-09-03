/** The label feature's data model, as it is stored in the project data store. */

export type Label = {
  id: string
  name: string
  /** `#rrggbb`; also what the viewer paints the element. */
  color: string
}

/** Namespace `satellite.palette`, key `palette`. */
export type Palette = {
  labels: Label[]
}

/** Namespace `satellite.labels`, one entry per labelled element. */
export type Assignment = {
  labelId: string
  /** Revit ElementId, for a human reading the store. */
  elementId: string
  elementName?: string
  /** Who assigned it (session upn or name). */
  by?: string
  /** When, as an ISO timestamp. */
  at: string
}

/**
 * The data-store key for one element.
 *
 * The Revit UniqueId is stable across snapshots, so a label survives a re-export;
 * the row index is not, and the ElementId is only unique per document. Data-store
 * keys must not contain `/`, which a UniqueId never does.
 */
export function elementKey(element: { uniqueId?: string; elementId: string }): string {
  return element.uniqueId ?? `id-${element.elementId}`
}

/**
 * Used when the project has no palette yet. It is only written to the server on
 * the first label write, so browsing a project never modifies it.
 */
export function defaultPalette(): Palette {
  return {
    labels: [
      { id: 'review', name: 'Review', color: '#e5484d' },
      { id: 'approved', name: 'Approved', color: '#30a46c' },
      { id: 'question', name: 'Question', color: '#f5a524' },
    ],
  }
}
