/**
 * The estimate's data model: what is stored in the project data store, and
 * what the app derives from it and from the loaded VIM.
 *
 * Ids are short client-made strings (see `newId`), never "max + 1": several
 * people may add a cost code at the same moment, and a counter read from the
 * store would hand both of them the same id.
 */

/** The UI language. */
export type Lang = 'en' | 'ja'

/** What a cost code's quantity is measured in. */
export type Basis = 'count' | 'length' | 'area' | 'volume' | 'lump'

/** In the order the basis selects list them. */
export const BASES: Basis[] = ['count', 'length', 'area', 'volume', 'lump']

/** The unit a basis implies, shown when a code has no unit of its own. */
export const BASIS_UNIT: Record<Basis, string> = {
  count: '',
  length: 'm',
  area: 'm²',
  volume: 'm³',
  lump: '',
}

/** Namespace `estimate.workPackages`, key = id. Shared by every sheet. */
export type WorkPackage = {
  id: string
  /** The English name. A new package gets the typed name in both languages. */
  en: string
  ja: string
  /** Display order; ties fall back to the id. */
  sort: number
}

/** Namespace `estimate.costCodes`, key = id. Shared by every sheet. */
export type CostCode = {
  id: string
  /** The code text people type and read, e.g. "03-310". Unique by convention, not by key. */
  code: string
  name: string
  descr: string
  /** Free text; the Cost Codes tab groups by it. */
  discipline: string
  /** Free text; the second grouping level of the Cost Codes tab. */
  grp: string
  /** Free text; empty means "the basis unit" (see BASIS_UNIT). */
  unit: string
  basis: Basis
  /** Unit price, in the sheet currency. */
  price: number
  /** Labor factor: person-days per unit. */
  laborDays: number
  /** Labor rate: currency per person-day. */
  laborRate: number
  /** Material adders as a FRACTION (0.1 = 10 %); the UI shows and takes percent. */
  matAdd: number
  /** Labor adders as a fraction, like matAdd. */
  labAdd: number
}

/** A named percentage of the direct cost. */
export type Markup = {
  id: string
  name: string
  /** Percent, e.g. 5 = 5 %. */
  pct: number
}

/**
 * Namespace `estimate.sheets`, key = id: one estimation sheet (a variation of
 * the estimate). Its element assignments live in their own namespace,
 * `estimate.sheet.<id>`.
 */
export type Sheet = {
  id: string
  name: string
  sort: number
  /** ISO code (see CURRENCIES). Only the symbol shown with amounts: nothing is converted. */
  currency: string
  markups: Markup[]
  /**
   * Not stored: true for the "Estimate 1" a project shows before anyone wrote
   * a sheet. The first write creates it on the server.
   */
  virtual?: boolean
}

/**
 * Namespace `estimate.sheet.<sheetId>`, key = elementKey: what one sheet says
 * about one element. A row that says nothing (no wp, code, extra, note, and not
 * hidden) is deleted, never stored, so "absent" means exactly "nothing".
 */
export type Assignment = {
  /** Work package id. */
  wp?: string
  /** Cost code id. */
  code?: string
  /** An extra amount on top of the priced cost, in the sheet currency. */
  extra?: number
  note?: string
  /** Excluded from the sheet (and hidden in 3D). Still counted in the total. */
  hidden?: boolean
  /** Revit ElementId, for a human reading the store. */
  elementId: string
  /** Who wrote it last (session upn or name). */
  by?: string
  /** When, as an ISO timestamp. */
  at: string
}

/** A change to assignments: a field left out stays as it is, `null` clears it. */
export type AssignmentPatch = {
  wp?: string | null
  code?: string | null
  extra?: number | null
  note?: string | null
  hidden?: boolean | null
}

/** What the estimate reads of one element of the loaded VIM (see quantities.ts). */
export type ElementFacts = {
  /**
   * Row index in the VIM element table: the handle the viewer takes. Valid for
   * the loaded snapshot only, so nothing stored or kept across sessions uses it.
   */
  index: number
  /**
   * The data-store key: the Revit UniqueId (see keys.ts). Null when the element
   * has none: it is priced as unassigned and included, and nothing is stored
   * for it.
   */
  key: string | null
  /** Revit ElementId as text. */
  elementId: string
  name: string
  category: string
  family: string
  /** The family type name ('' when the element has no family instance). */
  type: string
  level: string
  /** Revit's "System Name" ('' when none). */
  system: string
  /** The title of the BIM document (Revit file) the element comes from. */
  document: string
  /** Metres, or null when the element has no length. */
  length: number | null
  /** Square metres: Revit's Area, else the area of its (non-paint) materials. */
  area: number | null
  /** Cubic metres: Revit's Volume, else the volume of its (non-paint) materials. */
  volume: number | null
}

/** One element priced in the active sheet (see pricing.ts). Every element in scope has one. */
export type PricedRow = {
  index: number
  wp: string | null
  /** The cost code id; null when none, or when the code no longer exists. */
  code: string | null
  extra: number | null
  note: string
  hidden: boolean
  /** The quantity in the code's basis; null when no code, or the element lacks it. */
  qty: number | null
  /** null when there is no code or no quantity. */
  material: number | null
  /** null when there is no code or no quantity. */
  labor: number | null
  /** material + labor + extra (missing parts count 0). */
  amount: number
  /** Has a code whose basis needs a quantity the element does not have: it costs only its extra. */
  missing: boolean
}

/** The sheet's sums (see pricing.ts `computeTotals`). */
export type Totals = {
  /** Σ amount over all elements, excluded ones included. */
  direct: number
  material: number
  labor: number
  extra: number
  /** Elements with a work package. */
  nwp: number
  /** Elements with a cost code. */
  ncode: number
  /** Elements with a code but no quantity for it. */
  nmissing: number
  /** Elements in scope. */
  nall: number
  /** Σ markup percentages. */
  markupPct: number
  /** direct × markupPct / 100. */
  markup: number
  /** direct × (1 + markupPct / 100). */
  total: number
}

/** A short random id with a type prefix, e.g. `code-1a2b3c4d`. */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

/** Whether an assignment says anything. One that does not is deleted, never stored. */
export function isEmptyAssignment(assignment: Partial<Assignment>): boolean {
  return (
    !assignment.wp &&
    !assignment.code &&
    (assignment.extra === undefined || assignment.extra === null) &&
    !assignment.note &&
    !assignment.hidden
  )
}

/**
 * `patch` applied to `current`: a field left out stays, `null` (or an empty
 * note, a `false` hidden) clears it. Returns undefined when nothing
 * changes (skip the write: an "include all" over 20k included elements must
 * not send 20k entries), null when the result says nothing (delete the entry),
 * else the new entry.
 */
export function applyPatch(
  current: Assignment | undefined,
  patch: AssignmentPatch,
  meta: { elementId: string; by?: string; at: string },
): Assignment | null | undefined {
  const next: Partial<Assignment> = { ...current }
  const set = <K extends keyof AssignmentPatch>(field: K, value: AssignmentPatch[K]): void => {
    if (value === undefined) return
    if (value === null || value === '' || value === false || (typeof value === 'number' && !Number.isFinite(value))) {
      delete next[field]
    } else {
      ;(next as Record<string, unknown>)[field] = value
    }
  }
  set('wp', patch.wp)
  set('code', patch.code)
  set('extra', patch.extra)
  set('note', patch.note)
  set('hidden', patch.hidden)
  const unchanged =
    (current?.wp ?? undefined) === next.wp &&
    (current?.code ?? undefined) === next.code &&
    (current?.extra ?? undefined) === next.extra &&
    (current?.note ?? undefined) === next.note &&
    (current?.hidden ?? undefined) === next.hidden
  if (unchanged) return undefined
  if (isEmptyAssignment(next)) return null
  return { ...next, elementId: meta.elementId, by: meta.by, at: meta.at } as Assignment
}
