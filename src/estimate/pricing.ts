/**
 * The money: priced rows, the sheet totals, the cost colour ramp and the
 * "colour by level" palette. Pure functions, so the hook can memoize them and
 * the tests can call them without a browser.
 *
 * The rules are the original workflow's (README "Calculation", db.js
 * `pricedSql`):
 * - material = qty × unit price × (1 + material adders)
 * - labor    = qty × labor factor × labor rate × (1 + labor adders)
 * - amount   = material + labor + extra
 * - a lump-sum code charges its price once, on one element that carries it
 *   (see `lumpCarriers`);
 * - "missing" = the element has a code but no quantity for its basis: it then
 *   costs only its extra;
 * - direct = Σ amount (excluded elements still count); total = direct ×
 *   (1 + Σ markups / 100).
 */
import { groupValue, isNoneValue } from './grouping'
import type { GroupLevel } from './grouping'
import type {
  Assignment,
  Basis,
  CostCode,
  ElementFacts,
  Markup,
  PricedRow,
  Totals,
  WorkPackage,
} from './types'

/** The element's quantity for a basis (lump excluded: that depends on the other elements). */
export function quantityFor(basis: Basis, facts: ElementFacts): number | null {
  switch (basis) {
    case 'count':
      return 1
    case 'length':
      return facts.length
    case 'area':
      return facts.area
    case 'volume':
      return facts.volume
    default:
      return null
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The assignment of an element; none for an element with no key, which nothing can be stored for. */
function assignmentOf(
  fact: ElementFacts,
  assignments: ReadonlyMap<string, Assignment>,
): Assignment | undefined {
  return fact.key === null ? undefined : assignments.get(fact.key)
}

/**
 * Whether `a` carries a lump-sum code before `b`: the lower element key
 * (UniqueId, ordinal compare), so the element that shows the charge is the
 * same in every export of the model. The row index would move it around.
 *
 * Ties: a keyed element goes before one with no key (which cannot carry a code
 * today, as nothing is stored for it; the rule only keeps the choice total).
 * Two elements with the same key (a UniqueId repeated across linked models)
 * share one assignment; between those, and between two unkeyed elements, the
 * lower row index decides. That only picks which of them shows the charge in
 * this snapshot; the total is the same either way.
 */
function carriesBefore(a: ElementFacts, b: ElementFacts): boolean {
  if (a.key !== b.key) {
    if (a.key === null) return false
    if (b.key === null) return true
    return a.key < b.key
  }
  return a.index < b.index
}

/** Per lump-sum code id: the row index of the one element that is charged its price. */
function lumpCarriers(
  facts: ReadonlyMap<number, ElementFacts>,
  assignments: ReadonlyMap<string, Assignment>,
  costCodes: ReadonlyMap<string, CostCode>,
): Map<string, number> {
  const carrier = new Map<string, ElementFacts>()
  for (const fact of facts.values()) {
    const id = assignmentOf(fact, assignments)?.code
    if (!id || costCodes.get(id)?.basis !== 'lump') continue
    const current = carrier.get(id)
    if (current === undefined || carriesBefore(fact, current)) carrier.set(id, fact)
  }
  return new Map([...carrier].map(([id, fact]) => [id, fact.index]))
}

/**
 * One priced row per element in `facts` (an element without an assignment
 * costs 0; so does one with no key, which cannot have one). A code or work
 * package id that no longer exists counts as none: someone deleted it and the
 * clean-up of the assignments has not reached this page yet.
 *
 * O(n) over the elements: cheap enough to redo on every edit of a 20k-element
 * model, which keeps the result simply derived from the inputs.
 */
export function priceRows(
  facts: ReadonlyMap<number, ElementFacts>,
  assignments: ReadonlyMap<string, Assignment>,
  costCodes: ReadonlyMap<string, CostCode>,
  workPackages?: ReadonlyMap<string, WorkPackage>,
): Map<number, PricedRow> {
  const lumpOwner = lumpCarriers(facts, assignments, costCodes)

  const rows = new Map<number, PricedRow>()
  for (const fact of facts.values()) {
    const assignment = assignmentOf(fact, assignments)
    const code = assignment?.code ? costCodes.get(assignment.code) : undefined
    const wp =
      assignment?.wp && (!workPackages || workPackages.has(assignment.wp)) ? assignment.wp : null
    const extra = finiteOrNull(assignment?.extra)
    let qty: number | null = null
    let material: number | null = null
    let labor: number | null = null
    if (code) {
      qty =
        code.basis === 'lump'
          ? lumpOwner.get(code.id) === fact.index
            ? 1
            : 0
          : quantityFor(code.basis, fact)
      if (qty !== null) {
        material = qty * (code.price || 0) * (1 + (code.matAdd || 0))
        labor = qty * (code.laborDays || 0) * (code.laborRate || 0) * (1 + (code.labAdd || 0))
      }
    }
    rows.set(fact.index, {
      index: fact.index,
      wp,
      code: code ? code.id : null,
      extra,
      note: assignment?.note ?? '',
      hidden: assignment?.hidden === true,
      qty,
      material,
      labor,
      amount: (material ?? 0) + (labor ?? 0) + (extra ?? 0),
      missing: code !== undefined && qty === null,
    })
  }
  return rows
}

/** The sheet's sums. Excluded (hidden) elements count: visibility never changes the total. */
export function computeTotals(
  priced: ReadonlyMap<number, PricedRow>,
  markups: readonly Markup[],
): Totals {
  let direct = 0
  let material = 0
  let labor = 0
  let extra = 0
  let nwp = 0
  let ncode = 0
  let nmissing = 0
  for (const row of priced.values()) {
    direct += row.amount
    material += row.material ?? 0
    labor += row.labor ?? 0
    extra += row.extra ?? 0
    if (row.wp !== null) nwp++
    if (row.code !== null) ncode++
    if (row.missing) nmissing++
  }
  const markupPct = markups.reduce((sum, markup) => sum + (Number(markup.pct) || 0), 0)
  return {
    direct,
    material,
    labor,
    extra,
    nwp,
    ncode,
    nmissing,
    nall: priced.size,
    markupPct,
    markup: (direct * markupPct) / 100,
    total: direct * (1 + markupPct / 100),
  }
}

/** How one cost code is used in the active sheet (the Cost Codes tab's columns). */
export type CodeUsage = {
  /** Elements carrying the code. */
  count: number
  /** Σ qty; null when no element has a quantity for it. */
  qty: number | null
  amount: number
  /** The element indices, ascending. */
  elements: number[]
}

/** Usage per cost code id; codes nobody uses are absent. */
export function codeUsage(priced: ReadonlyMap<number, PricedRow>): Map<string, CodeUsage> {
  const usage = new Map<string, CodeUsage>()
  for (const row of priced.values()) {
    if (row.code === null) continue
    let entry = usage.get(row.code)
    if (!entry) {
      entry = { count: 0, qty: null, amount: 0, elements: [] }
      usage.set(row.code, entry)
    }
    entry.count++
    entry.amount += row.amount
    if (row.qty !== null) entry.qty = (entry.qty ?? 0) + row.qty
    entry.elements.push(row.index)
  }
  for (const entry of usage.values()) entry.elements.sort((a, b) => a - b)
  return usage
}

// ---- colours (ported from vim-html-ds src/color.ts) ------------------------------------------

/** Parse `#rgb` / `#rrggbb` into `[r, g, b]`, 0–255. An unreadable channel reads 0. */
export function hexToRgb(color: string): [number, number, number] {
  let hex = color.replace('#', '')
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  return [
    parseInt(hex.slice(0, 2), 16) || 0,
    parseInt(hex.slice(2, 4), 16) || 0,
    parseInt(hex.slice(4, 6), 16) || 0,
  ]
}

/** `[r, g, b]` (0–255, rounded) as `#rrggbb`. */
export function rgbToHex([r, g, b]: readonly number[]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

/** Reads a CSS custom property off the root, or the fallback without a DOM (tests) or token. */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** The DS heat ramp (calm → hot), from the live tokens: the health triad. */
export function heatGradient(): string[] {
  return [
    token('--health-green', '#6FB582'),
    token('--health-amber', '#E9B23A'),
    token('--health-red', '#E5664A'),
  ]
}

/** mulberry32: a PRNG whose whole state is its seed, so a palette comes back from its seed alone. */
function seededRandom(seed: number): () => number {
  let a = (seed >>> 0) + 0x6d2b79f5
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// OKLCH (Björn Ottosson's Oklab in polar form: lightness 0..1, chroma, hue in
// degrees). The data colours are adjusted in it, not in HSL, because equal
// steps in it look equal: a lift brightens a yellow and a blue alike, and a
// hue walk at one lightness gives colours that look equally light.

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

/** `#rrggbb` as OKLCH `[lightness, chroma, hue°]`. */
export function hexToOklch(color: string): [number, number, number] {
  const [r, g, b] = hexToRgb(color).map((v) => srgbToLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [lightness, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360]
}

/** OKLCH as linear sRGB, unclamped: a channel outside 0..1 means "outside the sRGB gamut". */
function oklchToLinear(lightness: number, chroma: number, hue: number): number[] {
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function inGamut(linear: number[]): boolean {
  return linear.every((v) => v >= -1e-6 && v <= 1 + 1e-6)
}

/**
 * OKLCH as `#rrggbb`. A colour the screen cannot show loses chroma (found by
 * bisection) rather than being clipped per channel, so it keeps its hue and
 * its lightness: a clipped channel would shift the hue.
 */
export function oklchToHex(lightness: number, chroma: number, hue: number): string {
  let c = chroma
  if (!inGamut(oklchToLinear(lightness, c, hue))) {
    let lo = 0
    let hi = chroma
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear(lightness, mid, hue))) lo = mid
      else hi = mid
    }
    c = lo
  }
  return rgbToHex(
    oklchToLinear(lightness, c, hue).map((v) => linearToSrgb(Math.min(1, Math.max(0, v))) * 255),
  )
}

/**
 * How much brighter the 3D data colours are than the DS tokens they come
 * from: OKLCH lightness + 0.07 and chroma × 1.15. The tokens are tuned for
 * small marks on the dark UI; in 3D a colour covers whole faces, and vim-web's
 * shading darkens every face that does not face its light (to half, at
 * worst), so the same values read dull there. Moderate on purpose: more
 * lightness washes the colours toward white, which is the "no value" colour.
 */
export const DATA_LIFT = { lightness: 0.07, chroma: 1.15 } as const

/** A DS colour as a 3D data colour: DATA_LIFT applied in OKLCH, the hue kept. */
export function liftColor(color: string): string {
  const [lightness, chroma, hue] = hexToOklch(color)
  return oklchToHex(Math.min(1, lightness + DATA_LIFT.lightness), chroma * DATA_LIFT.chroma, hue)
}

const GOLDEN_ANGLE = 137.508

/**
 * The OKLCH hues the categorical palette leaves out: the cyan of vim-web's
 * selection outline (#00ffff, hue 195°) ± 30°, so an outlined element never
 * looks like one coloured by the data. (This also drops the DS teal, 187°.)
 */
const OUTLINE_HUES = { from: 165, to: 225 } as const

/** The categorical palette's hue for a position 0..360 on its walk: the circle minus OUTLINE_HUES. */
function walkHue(position: number): number {
  const gap = OUTLINE_HUES.to - OUTLINE_HUES.from
  const hue = (position * (360 - gap)) / 360
  return hue < OUTLINE_HUES.from ? hue : hue + gap
}

/** The inverse of walkHue, for a hue outside OUTLINE_HUES. */
function walkPosition(hue: number): number {
  const gap = OUTLINE_HUES.to - OUTLINE_HUES.from
  return ((hue < OUTLINE_HUES.from ? hue : hue - gap) * 360) / (360 - gap)
}

/** The DS categorical series the palette is derived from (the grey --chart-5 is not a category colour). */
function chartTokens(): string[] {
  return [
    token('--chart-1', '#3DB8F5'),
    token('--chart-2', '#2BA39A'),
    token('--chart-3', '#9B8CFA'),
    token('--chart-4', '#E96A2A'),
  ]
}

/**
 * `n` mutually distinct colours as `#rrggbb`, for "Colors by <level>" in 3D
 * and in the tree's row swatches. Derived from the DS chart series in OKLCH:
 * - lightness and chroma: the mean of --chart-1..4 lifted by DATA_LIFT, the
 *   lightness alternating ± 0.04 around it so that neighbours in the walk
 *   also differ in lightness;
 * - hue: a golden-angle walk from --chart-1's hue (the DS primary series), over
 *   the circle minus the selection outline's cyan (OUTLINE_HUES).
 * A seed other than 0 starts the walk at a random hue and shuffles the
 * assignment: the "shuffle" button. The same seed always gives the same array.
 */
export function categoricalPalette(n: number, seed = 0): string[] {
  if (n <= 0) return []
  const series = chartTokens().map(hexToOklch)
  const mean = (k: number): number => series.reduce((sum, color) => sum + color[k], 0) / series.length
  const lightness = mean(0) + DATA_LIFT.lightness
  const chroma = mean(1) * DATA_LIFT.chroma
  const rand = seededRandom(seed)
  const offset = seed === 0 ? walkPosition(series[0][2]) : rand() * 360
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const hue = walkHue((offset + i * GOLDEN_ANGLE) % 360)
    out.push(oklchToHex(lightness + (i % 2 === 0 ? 0.04 : -0.04), chroma, hue))
  }
  if (seed === 0) return out
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** White: an element without a cost code (Costs), or a "none" group (Colors by level). */
export const WHITE = '#ffffff'

/** Where each colour of the cost ramp sits on the rank (0 = cheapest, 1 = dearest). */
export const COST_STOPS = [0, 0.25, 0.5, 0.9, 1]

/**
 * The cost ramp: DS green over the lowest quarter, DS amber at the median,
 * orange at the 90th percentile, red at the top, so only the top tenth reads
 * red. (The DS ramp's own hot end is already red-orange; it would turn the
 * whole upper half red.) One colour per COST_STOPS entry, each lifted for the
 * 3D view (liftColor); the legend draws these same values.
 */
export function costRamp(): string[] {
  const [green, amber] = heatGradient()
  return [green, green, amber, token('--en-cost-warm', '#EE8A2E'), token('--en-cost-hot', '#E2483D')].map(
    liftColor,
  )
}

/** The legend bar's background: the ramp at its stops (the gradient IS the data). */
export function costLegendGradient(ramp: readonly string[] = costRamp()): string {
  return `linear-gradient(to right, ${ramp.map((color, k) => `${color} ${COST_STOPS[k] * 100}%`).join(', ')})`
}

/** The ramp colour at rank `u` (0..1): linear between the two stops around it, channels rounded. */
export function rampColor(u: number, ramp: readonly string[] = costRamp()): string {
  const rgb = ramp.map(hexToRgb)
  for (let k = 0; k < COST_STOPS.length - 1; k++) {
    const top = COST_STOPS[k + 1]
    if (u <= top) {
      const f = (u - COST_STOPS[k]) / (top - COST_STOPS[k])
      return rgbToHex([0, 1, 2].map((i) => Math.round(rgb[k][i] + (rgb[k + 1][i] - rgb[k][i]) * f)))
    }
  }
  return rgbToHex(rgb[rgb.length - 1])
}

/** What "Display: Costs" paints, and what its legend shows. */
export type CostPaint = {
  /** Element index -> `#rrggbb`, for every priced element. */
  colors: Map<number, string>
  /** The lowest, median and highest amount among coded elements (0 when there are none). */
  lo: number
  mid: number
  hi: number
}

/**
 * Colours by cost. Uncoded elements are white; coded ones sit on the ramp by
 * their RANK among the coded elements (percent rank, ties share the lower
 * rank), so a few very expensive elements cannot push all the others into
 * green. The rank is rounded to 1/32: the viewer gets at most 33 colours, not
 * one material per element.
 */
export function costColors(
  priced: ReadonlyMap<number, PricedRow>,
  ramp: readonly string[] = costRamp(),
): CostPaint {
  const coded = [...priced.values()].filter((row) => row.code !== null)
  coded.sort((a, b) => a.amount - b.amount)
  const n = coded.length
  const rank = new Map<number, number>()
  let first = 0
  for (let i = 0; i < n; i++) {
    if (i > 0 && coded[i].amount !== coded[i - 1].amount) first = i
    rank.set(coded[i].index, n > 1 ? first / (n - 1) : 0)
  }
  // One colour per rounded rank: at most 33 interpolations.
  const byStep = new Map<number, string>()
  const colors = new Map<number, string>()
  for (const row of priced.values()) {
    const r = rank.get(row.index)
    if (r === undefined) {
      colors.set(row.index, WHITE)
      continue
    }
    const step = Math.round(r * 32)
    let color = byStep.get(step)
    if (!color) {
      color = rampColor(step / 32, ramp)
      byStep.set(step, color)
    }
    colors.set(row.index, color)
  }
  const amounts = coded.map((row) => row.amount)
  return {
    colors,
    lo: n ? amounts[0] : 0,
    mid: n ? median(amounts) : 0,
    hi: n ? amounts[n - 1] : 0,
  }
}

/** The continuous median of an ascending list (DuckDB `quantile_cont(x, 0.5)`). */
function median(sorted: number[]): number {
  const position = (sorted.length - 1) / 2
  const below = Math.floor(position)
  const above = Math.ceil(position)
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below)
}

/** What "Display: Colors by <level>" paints. */
export type LevelPaint = {
  /** Group value -> `#rrggbb` (the tree's row swatches). */
  byValue: Map<string, string>
  /** Element index -> `#rrggbb` (the 3D). */
  byElement: Map<number, string>
}

/**
 * Colours by one grouping level: each distinct value its own colour from the
 * DS categorical palette, handed out in sorted-value order, so a value keeps
 * its colour while a filter changes the set around it; `seed` re-rolls. A
 * group that stands for NO value ("(No work package)", "(none)") is white, as
 * an uncoded element is under Costs; the palette goes to real values only.
 *
 * `elements` are the indices to colour (the tree's filtered set).
 */
export function levelColors(
  level: GroupLevel,
  elements: Iterable<number>,
  facts: ReadonlyMap<number, ElementFacts>,
  priced: ReadonlyMap<number, PricedRow>,
  seed: number,
): LevelPaint {
  const valueOf = new Map<number, string>()
  for (const index of elements) {
    const fact = facts.get(index)
    const row = priced.get(index)
    if (fact && row) valueOf.set(index, groupValue(level, fact, row))
  }
  const values = [...new Set(valueOf.values())].sort()
  const real = values.filter((value) => !isNoneValue(value))
  const palette = categoricalPalette(real.length, seed)
  const byValue = new Map(real.map((value, i) => [value, palette[i]]))
  for (const value of values) if (isNoneValue(value)) byValue.set(value, WHITE)
  const byElement = new Map<number, string>()
  for (const [index, value] of valueOf) byElement.set(index, byValue.get(value) ?? WHITE)
  return { byValue, byElement }
}
