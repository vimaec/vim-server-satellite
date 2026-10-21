/**
 * Every VIM Server read and write of the estimate, in terms of the project
 * data store. Everything above this file works with plain objects and never
 * sees a namespace, an ETag or a batch size.
 *
 * | Namespace               | Key        | Value                                   |
 * |-------------------------|------------|-----------------------------------------|
 * | estimate.workPackages   | wp id      | { en, ja, sort }                        |
 * | estimate.costCodes      | code id    | { code, name, …, laborRate, matAdd, … } |
 * | estimate.sheets         | sheet id   | { name, sort, currency, markups }       |
 * | estimate.sheet.<sheet>  | elementKey | Assignment                              |
 *
 * Concurrency: a sheet document is shared and edited as a whole (its markups
 * list), so it is written read-modify-write under `If-Match`. Codes, work
 * packages and assignments are one entry per thing and last-write-wins.
 */
import { ApiError } from '../api/http'
import {
  deleteEntries,
  deleteNamespace,
  getEntry,
  listEntries,
  putEntries,
  putEntry,
} from '../api/projectData'
import { BASES } from './types'
import type { Assignment, Basis, CostCode, Markup, Sheet, WorkPackage } from './types'

export const NAMESPACES = {
  workPackages: 'estimate.workPackages',
  costCodes: 'estimate.costCodes',
  sheets: 'estimate.sheets',
} as const

/** The namespace that holds one sheet's assignments. */
export function sheetNamespace(sheetId: string): string {
  return `estimate.sheet.${sheetId}`
}

/**
 * The id of the sheet a project shows before anyone wrote one. Fixed rather
 * than random so that two people who both start estimating an empty project
 * create the SAME sheet (the second create-only write gets 412 and joins it)
 * instead of two sheets both called "Estimate 1".
 */
export const FIRST_SHEET_ID = 'sheet-1'

/** The markups a new sheet starts with (names in English; the caller translates). */
export const DEFAULT_MARKUPS: Markup[] = [
  { id: 'misc', name: 'Miscellaneous', pct: 0 },
  { id: 'risk', name: 'Risk', pct: 0 },
  { id: 'safety', name: 'Safety margin', pct: 0 },
]

/** The server is asked to take at most this many entries per batch request. */
const BATCH = 1000

/** How many times a sheet write re-reads and re-applies after a 412. */
const SHEET_ATTEMPTS = 3

export type StoredWorkPackage = Omit<WorkPackage, 'id'>
export type StoredCostCode = Omit<CostCode, 'id'>
export type StoredSheet = Omit<Sheet, 'id' | 'virtual'>

// ---- reading tolerantly ------------------------------------------------------------------------
// The store is plain JSON anyone with a token can edit. A hand-edited entry must not break the
// page, so every read normalizes field by field.

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const number = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : fallback
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

function toWorkPackage(id: string, raw: unknown): WorkPackage {
  const value = record(raw)
  const en = text(value.en) || text(value.ja) || id
  return { id, en, ja: text(value.ja) || en, sort: number(value.sort) }
}

function toCostCode(id: string, raw: unknown): CostCode {
  const value = record(raw)
  const basis = (BASES as string[]).includes(text(value.basis)) ? (value.basis as Basis) : 'count'
  return {
    id,
    code: text(value.code) || id,
    name: text(value.name),
    descr: text(value.descr),
    discipline: text(value.discipline),
    grp: text(value.grp),
    unit: text(value.unit),
    basis,
    price: number(value.price),
    laborDays: number(value.laborDays),
    laborRate: number(value.laborRate),
    matAdd: number(value.matAdd),
    labAdd: number(value.labAdd),
  }
}

function toMarkups(raw: unknown): Markup[] {
  if (!Array.isArray(raw)) return DEFAULT_MARKUPS.map((markup) => ({ ...markup }))
  return raw.map((item, i) => {
    const value = record(item)
    return { id: text(value.id) || `m${i}`, name: text(value.name), pct: number(value.pct) }
  })
}

function toSheet(id: string, raw: unknown): Sheet {
  const value = record(raw)
  return {
    id,
    name: text(value.name) || id,
    sort: number(value.sort),
    currency: text(value.currency) || 'USD',
    markups: toMarkups(value.markups),
  }
}

function toAssignment(raw: unknown): Assignment | null {
  const value = record(raw)
  const out: Assignment = { elementId: text(value.elementId), at: text(value.at) }
  if (text(value.wp)) out.wp = text(value.wp)
  if (text(value.code)) out.code = text(value.code)
  if (typeof value.extra === 'number' && Number.isFinite(value.extra)) out.extra = value.extra
  if (text(value.note)) out.note = text(value.note)
  if (value.hidden === true) out.hidden = true
  if (text(value.by)) out.by = text(value.by)
  return out.wp || out.code || out.extra !== undefined || out.note || out.hidden ? out : null
}

/** The stored form of a sheet (no id, no `virtual`). */
export function storedSheet(sheet: Sheet): StoredSheet {
  return {
    name: sheet.name,
    sort: sheet.sort,
    currency: sheet.currency,
    markups: sheet.markups.map(({ id, name, pct }) => ({ id, name, pct })),
  }
}

/** Sheets in display order. */
export function sortSheets(sheets: Sheet[]): Sheet[] {
  return [...sheets].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ---- reads -------------------------------------------------------------------------------------

export async function loadWorkPackages(projectId: string): Promise<Map<string, WorkPackage>> {
  const entries = await listEntries<unknown>(projectId, NAMESPACES.workPackages)
  return new Map(entries.map((entry) => [entry.key, toWorkPackage(entry.key, entry.value)]))
}

export async function loadCostCodes(projectId: string): Promise<Map<string, CostCode>> {
  const entries = await listEntries<unknown>(projectId, NAMESPACES.costCodes)
  return new Map(entries.map((entry) => [entry.key, toCostCode(entry.key, entry.value)]))
}

/** The stored sheets, in display order (empty for a project nobody estimated yet). */
export async function loadSheets(projectId: string): Promise<Sheet[]> {
  const entries = await listEntries<unknown>(projectId, NAMESPACES.sheets)
  return sortSheets(entries.map((entry) => toSheet(entry.key, entry.value)))
}

/** One sheet's assignments, keyed by element key. */
export async function loadAssignments(
  projectId: string,
  sheetId: string,
): Promise<Map<string, Assignment>> {
  const entries = await listEntries<unknown>(projectId, sheetNamespace(sheetId))
  const out = new Map<string, Assignment>()
  for (const entry of entries) {
    const assignment = toAssignment(entry.value)
    if (assignment) out.set(entry.key, assignment)
  }
  return out
}

/** Everything the estimate needs on project open. */
export type EstimateLoad = {
  workPackages: Map<string, WorkPackage>
  costCodes: Map<string, CostCode>
  /** Stored sheets, in display order; empty when the project has none (the caller shows a virtual one). */
  sheets: Sheet[]
  /** The sheet to open: the wanted one if it exists, else the first, else FIRST_SHEET_ID. */
  sheetId: string
  assignments: Map<string, Assignment>
}

/**
 * Reads the four namespaces in parallel. The sheet to open is not known
 * before the sheet list arrives, so its assignments are read on a guess (the
 * user's last sheet, from prefs); only a wrong guess costs a second request.
 */
export async function loadEstimate(projectId: string, wantedSheetId: string | null): Promise<EstimateLoad> {
  const guess = wantedSheetId ?? FIRST_SHEET_ID
  const [workPackages, costCodes, sheets, guessed] = await Promise.all([
    loadWorkPackages(projectId),
    loadCostCodes(projectId),
    loadSheets(projectId),
    loadAssignments(projectId, guess),
  ])
  const sheetId = sheets.some((sheet) => sheet.id === guess)
    ? guess
    : (sheets[0]?.id ?? FIRST_SHEET_ID)
  const assignments =
    sheetId === guess ? guessed : sheets.length ? await loadAssignments(projectId, sheetId) : new Map()
  return { workPackages, costCodes, sheets, sheetId, assignments }
}

// ---- sheets ------------------------------------------------------------------------------------

/**
 * Creates a sheet, create-only (`If-None-Match: *`). Returns false when it
 * already exists — for FIRST_SHEET_ID that means someone else created it
 * first, which is the outcome wanted anyway.
 */
export async function createSheet(projectId: string, sheet: Sheet): Promise<boolean> {
  try {
    await putEntry(projectId, NAMESPACES.sheets, sheet.id, storedSheet(sheet), { ifNoneMatch: '*' })
    return true
  } catch (cause: unknown) {
    if (cause instanceof ApiError && cause.status === 412) return false
    throw cause
  }
}

/**
 * Read–modify–write of one sheet document: re-read, apply `mutate` to what is
 * actually stored, write back under `If-Match`; a 412 means someone else got
 * in between, so the cycle runs again over their version. Returns the sheet
 * now on the server, which the caller should adopt.
 */
export async function updateSheet(
  projectId: string,
  sheetId: string,
  mutate: (current: Sheet) => Sheet,
): Promise<Sheet> {
  for (let attempt = 0; attempt < SHEET_ATTEMPTS; attempt++) {
    const entry = await getEntry<unknown>(projectId, NAMESPACES.sheets, sheetId)
    if (!entry) throw new ApiError(404, 'The sheet is gone', 'Someone else deleted it.')
    const next = mutate(toSheet(sheetId, entry.value))
    try {
      await putEntry(projectId, NAMESPACES.sheets, sheetId, storedSheet(next), { ifMatch: entry.etag })
      return next
    } catch (cause: unknown) {
      if (!(cause instanceof ApiError) || cause.status !== 412) throw cause
    }
  }
  throw new ApiError(412, 'Could not save the sheet', 'Someone else keeps editing it. Try again.')
}

/** Its assignments first, then the sheet entry: a sheet never points at data that is gone. */
export async function deleteSheet(projectId: string, sheetId: string): Promise<void> {
  await deleteNamespace(projectId, sheetNamespace(sheetId))
  await deleteEntries(projectId, NAMESPACES.sheets, [sheetId])
}

// ---- assignments -------------------------------------------------------------------------------

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH))
  return out
}

/** One batch of assignment changes for one sheet: upserts and deletes, chunked. */
export async function writeAssignments(
  projectId: string,
  sheetId: string,
  puts: { key: string; value: Assignment }[],
  deletes: string[],
): Promise<void> {
  const namespace = sheetNamespace(sheetId)
  await Promise.all([
    ...chunks(puts).map((part) => putEntries(projectId, namespace, part)),
    ...chunks(deletes).map((part) => deleteEntries(projectId, namespace, part)),
  ])
}

/** Copies every assignment of one sheet into another (Duplicate). */
export async function copyAssignments(
  projectId: string,
  toSheetId: string,
  assignments: ReadonlyMap<string, Assignment>,
): Promise<void> {
  const puts = [...assignments].map(([key, value]) => ({ key, value }))
  await writeAssignments(projectId, toSheetId, puts, [])
}

/**
 * Clears a work package or cost code from the assignments of EVERY sheet,
 * before the entry itself is deleted. The sheet list is re-read: a sheet
 * someone else added since this page loaded must not keep a dangling id.
 */
async function stripReference(
  projectId: string,
  field: 'wp' | 'code',
  id: string,
): Promise<void> {
  const sheets = await loadSheets(projectId)
  await Promise.all(
    sheets.map(async (sheet) => {
      const current = await loadAssignments(projectId, sheet.id)
      const puts: { key: string; value: Assignment }[] = []
      const deletes: string[] = []
      for (const [key, assignment] of current) {
        if (assignment[field] !== id) continue
        const next = { ...assignment }
        delete next[field]
        if (toAssignment(next)) puts.push({ key, value: next })
        else deletes.push(key)
      }
      if (puts.length || deletes.length) await writeAssignments(projectId, sheet.id, puts, deletes)
    }),
  )
}

// ---- work packages and cost codes --------------------------------------------------------------

export async function putWorkPackage(projectId: string, wp: WorkPackage): Promise<void> {
  const { id, ...value } = wp
  await putEntry(projectId, NAMESPACES.workPackages, id, value)
}

/** Its elements keep their codes and lose the package; then the package goes. */
export async function deleteWorkPackage(projectId: string, id: string): Promise<void> {
  await stripReference(projectId, 'wp', id)
  await deleteEntries(projectId, NAMESPACES.workPackages, [id])
}

export async function putCostCode(projectId: string, code: CostCode): Promise<void> {
  const { id, ...value } = code
  await putEntry(projectId, NAMESPACES.costCodes, id, value)
}

/** Its elements lose the code (in every sheet); then the code goes. */
export async function deleteCostCode(projectId: string, id: string): Promise<void> {
  await stripReference(projectId, 'code', id)
  await deleteEntries(projectId, NAMESPACES.costCodes, [id])
}
