/**
 * `window.__vimSatellite` — a small read-only view of the app for Playwright.
 *
 * Always on: it exposes nothing a user could not read off the screen, and an
 * end-to-end test that asks the app what it thinks beats one that scrapes CSS.
 * Read-only on purpose — no setter here can drive the app.
 */
import type { Assignment, Sheet, Totals } from './estimate/types'

/** What `getEstimate()` returns: the active sheet as the app holds it right now. */
export type DebugEstimate = {
  sheetId: string
  sheets: Sheet[]
  totals: Totals
  /** The active sheet's assignments, by element key. */
  assignments: Record<string, Assignment>
  /** Excluded element indices, ascending. */
  hidden: number[]
}

export type SatelliteDebug = {
  /** The current App state machine step, e.g. 'loading' | 'sign-in' | 'project'. */
  getState: () => string
  /** Selected element indices, in the order they were selected. */
  getSelection: () => number[]
  /** The color the app applied to this element, or undefined for the model color. */
  getElementColor: (index: number) => string | undefined
  /** The estimate's active sheet, or null before a project page has loaded one. */
  getEstimate: () => DebugEstimate | null
  /** Whether the app hides this element in 3D (it is excluded in the active sheet). */
  isElementHidden: (index: number) => boolean
}

/** The estimate fields the hook reads; the snapshot is built on demand, not on every change. */
export type DebugEstimateSource = {
  sheet: Sheet
  sheets: Sheet[]
  totals: Totals
  assignments: Map<string, Assignment>
  hidden: Set<number>
}

let stateName = 'loading'
let selection: number[] = []
let colors = new Map<number, string>()
let estimate: DebugEstimateSource | null = null

export function setDebugState(next: string): void {
  stateName = next
}

export function setDebugSelection(next: number[]): void {
  selection = next
}

export function setDebugColors(next: Map<number, string>): void {
  colors = next
}

export function setDebugEstimate(next: DebugEstimateSource | null): void {
  estimate = next
}

declare global {
  interface Window {
    __vimSatellite?: SatelliteDebug
  }
}

export function installDebugHook(): void {
  window.__vimSatellite = {
    getState: () => stateName,
    getSelection: () => [...selection],
    getElementColor: (index) => colors.get(index),
    getEstimate: () =>
      estimate && {
        sheetId: estimate.sheet.id,
        sheets: estimate.sheets.map((sheet) => ({ ...sheet })),
        totals: { ...estimate.totals },
        assignments: Object.fromEntries(estimate.assignments),
        hidden: [...estimate.hidden].sort((a, b) => a - b),
      },
    isElementHidden: (index) => estimate?.hidden.has(index) ?? false,
  }
}
