/**
 * `window.__vimSatellite` — a small read-only view of the app for Playwright.
 *
 * Always on: it exposes nothing a user could not read off the screen, and an
 * end-to-end test that asks the app what it thinks beats one that scrapes CSS.
 * Read-only on purpose — no setter here can drive the app.
 */
import type { Assignment } from './labels/types'

export type SatelliteDebug = {
  /** The current App state machine step, e.g. 'loading' | 'sign-in' | 'project'. */
  getState: () => string
  /** Selected element indices, in the order they were selected. */
  getSelection: () => number[]
  /** The color the app applied to this element, or undefined for the model color. */
  getElementColor: (index: number) => string | undefined
  /** Every label assignment the app currently holds, keyed by element key. */
  getAssignments: () => Record<string, Assignment>
}

let stateName = 'loading'
let selection: number[] = []
let colors = new Map<number, string>()
let assignments = new Map<string, Assignment>()

export function setDebugState(next: string): void {
  stateName = next
}

export function setDebugSelection(next: number[]): void {
  selection = next
}

export function setDebugColors(next: Map<number, string>): void {
  colors = next
}

export function setDebugAssignments(next: Map<string, Assignment>): void {
  assignments = next
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
    getAssignments: () => Object.fromEntries(assignments),
  }
}
