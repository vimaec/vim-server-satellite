/**
 * The Elements tab's way of looking at the estimate: the Group by levels, the
 * Show filter, the search, the Display colours, and the tree they make.
 *
 * It lives above the panel (the page calls it) because two places read it:
 * the tree, and the 3D view, whose colours depend on what the tree lists ("Colors
 * by level" paints the listed elements only). Computing it once here keeps the
 * two in step and builds the 20k-element tree once per change, not per reader.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { buildTree } from '../grouping'
import type { GroupLevel, GroupNode } from '../grouping'
import { costColors, costRamp, levelColors } from '../pricing'
import { loadViewPrefs, saveViewPrefs } from '../prefs'
import type { ViewPrefs } from '../prefs'
import type { Estimate } from '../useEstimate'

/** What Display paints, in 3D and in the panel. */
export type Paint = {
  /** Element index -> `#rrggbb` for the viewer; empty for "No colors". */
  colors: Map<number, string>
  /** The coloured grouping level and its value -> colour (the tree's row swatches). */
  swatches: { level: GroupLevel; byValue: Map<string, string> } | null
  /** The cost legend: lowest, median and highest coded amount, and the ramp it is drawn with. */
  legend: { lo: number; mid: number; hi: number; ramp: string[] } | null
}

export type ElementsView = {
  prefs: ViewPrefs
  /** Change the view; saved in localStorage. A colour by a level that left the grouping goes too. */
  setPrefs: (patch: Partial<ViewPrefs>) => void
  /** The submitted search text (the tree filters on Enter, not per keystroke). */
  search: string
  setSearch: (text: string) => void
  /** The tree's root (depth -1); its aggregates describe everything listed. */
  root: GroupNode
  paint: Paint
}

const NO_COLORS = new Map<number, string>()

export function useElementsView(est: Estimate): ElementsView {
  const [prefs, setPrefsState] = useState<ViewPrefs>(loadViewPrefs)
  const prefsRef = useRef(prefs)
  const [search, setSearch] = useState('')

  const setPrefs = useCallback((patch: Partial<ViewPrefs>) => {
    const next = { ...prefsRef.current, ...patch }
    if (next.display.startsWith('level:') && !next.nesting.includes(next.display.slice(6) as GroupLevel)) {
      next.display = 'none'
    }
    prefsRef.current = next
    setPrefsState(next)
    saveViewPrefs(next)
  }, [])

  const { facts, priced, workPackages, costCodes } = est
  const root = useMemo(
    () => buildTree({ facts, priced, nesting: prefs.nesting, search, show: prefs.show, workPackages, costCodes }),
    [costCodes, facts, prefs.nesting, prefs.show, priced, search, workPackages],
  )

  const { display, seed } = prefs
  const paint = useMemo((): Paint => {
    if (display === 'cost') {
      const ramp = costRamp()
      const cost = costColors(priced, ramp)
      return { colors: cost.colors, swatches: null, legend: { lo: cost.lo, mid: cost.mid, hi: cost.hi, ramp } }
    }
    if (display.startsWith('level:')) {
      const level = display.slice(6) as GroupLevel
      const byLevel = levelColors(level, root.elements, facts, priced, seed)
      return { colors: byLevel.byElement, swatches: { level, byValue: byLevel.byValue }, legend: null }
    }
    return { colors: NO_COLORS, swatches: null, legend: null }
  }, [display, facts, priced, root, seed])

  return useMemo(
    () => ({ prefs, setPrefs, search, setSearch, root, paint }),
    [paint, prefs, root, search, setPrefs],
  )
}
