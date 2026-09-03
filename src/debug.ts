/**
 * `window.__vimSatellite` — a small read-only view of the app for Playwright.
 *
 * Always on: it exposes nothing a user could not read off the screen, and an
 * end-to-end test that asks the app what it thinks beats one that scrapes CSS.
 */

export type SatelliteDebug = {
  /** The current App state machine step, e.g. 'loading' | 'sign-in' | 'project'. */
  getState: () => string
}

let stateName = 'loading'

export function setDebugState(next: string): void {
  stateName = next
}

declare global {
  interface Window {
    __vimSatellite?: SatelliteDebug
  }
}

export function installDebugHook(): void {
  window.__vimSatellite = {
    getState: () => stateName,
  }
}
