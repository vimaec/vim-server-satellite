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
 * - a lump-sum code charges its price once, on the lowest element index that
 *   carries it;
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

/**
 * One priced row per element in `facts` (an element without an assignment
 * costs 0). A code or work package id that no longer exists counts as none:
 * someone deleted it and the clean-up of the assignments has not reached this
 * page yet.
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
  // The lump rule: the lowest element index carrying each lump-sum code.
  const lumpOwner = new Map<string, number>()
  for (const fact of facts.values()) {
    const id = assignments.get(fact.key)?.code
    if (!id || costCodes.get(id)?.basis !== 'lump') continue
    const owner = lumpOwner.get(id)
    if (owner === undefined || fact.index < owner) lumpOwner.set(id, fact.index)
  }

  const rows = new Map<number, PricedRow>()
  for (const fact of facts.values()) {
    const assignment = assignments.get(fact.key)
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

function hslHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const segment = Math.floor((((h % 360) + 360) % 360) / 60)
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][segment]
  return `#${rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`
}

const GOLDEN_ANGLE = 137.508

/**
 * `n` mutually distinct colours as `#rrggbb` (the DS categorical palette).
 * Hues walk the golden angle; lightness alternates between two bands. A seed
 * other than 0 rotates the walk and shuffles the assignment: the "shuffle"
 * button. The same seed always gives the same array.
 */
export function categoricalPalette(n: number, seed = 0): string[] {
  if (n <= 0) return []
  const rand = seededRandom(seed)
  const offset = seed === 0 ? 20 : rand() * 360
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const hue = (offset + i * GOLDEN_ANGLE) % 360
    const light = i % 2 === 0
    out.push(hslHex(hue, light ? 0.62 : 0.5, light ? 0.62 : 0.46))
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
 * red. (The DS ramp's own hot end already reads red under the 3D shading; it
 * would turn the whole upper half red.) One colour per COST_STOPS entry.
 */
export function costRamp(): string[] {
  const [green, amber] = heatGradient()
  return [green, green, amber, token('--en-cost-warm', '#EE8A2E'), token('--en-cost-hot', '#E2483D')]
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
