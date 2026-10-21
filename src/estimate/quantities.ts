/**
 * What the estimate reads of each element of the loaded VIM: its quantities
 * (length, area, volume, in metric units), its system, and the names the tree
 * groups by (category, family, type, level, BIM document).
 *
 * Everything is read with the BIM tables' column getters (`getAll…`): one call
 * per column for the whole model. The per-element helpers (`getBimParameters`,
 * `VimHelpers.getElementsParameters`) either cost one round trip per element or
 * drop the element index, and on a 20k-element model either is far too slow.
 */
import type * as VIM from 'vim-web'
import { elementKey } from './keys'
import type { ElementFacts } from './types'

type IWebglVim = VIM.Core.Webgl.IWebglVim

/** The vim-format BIM document (`vim.bim`). Typed by its own package so tests can pass one in. */
export type BimDocument = NonNullable<IWebglVim['bim']>

/** The elements in scope, as the viewer knows them. */
export type ScopeElement = {
  index: number
  elementId: string
  /** '' or undefined when the element has none. */
  uniqueId?: string
}

/** Revit's own parameter names, in English and in Japanese (a model exported from a Japanese Revit). */
const LENGTH_NAMES = ['Length', '長さ']
const AREA_NAMES = ['Area', '面積']
const VOLUME_NAMES = ['Volume', '体積']
const SYSTEM_NAMES = ['System Name', 'システム名']

/** Revit stores lengths in feet: these turn ft, ft², ft³ into m, m², m³. */
const FT = 0.3048
const FT2 = 0.09290304
const FT3 = 0.028316846592

/** The Revit category of saved views and cameras: never part of an estimate. */
const EXCLUDED_CATEGORY = 'Cameras'

const KIND_NONE = 0
const KIND_LENGTH = 1
const KIND_AREA = 2
const KIND_VOLUME = 3
const KIND_SYSTEM = 4

/** Thrown (and swallowed by the caller) when a newer build made this one pointless. */
export class BuildCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'BuildCancelled'
  }
}

/**
 * The facts of every element of `vim` that has geometry: those are the ones a
 * user can see and click, so they are the ones the estimate covers.
 *
 * `isCancelled` is checked after every await; a build that is no longer wanted
 * (another snapshot loaded, the page left) throws `BuildCancelled`.
 */
export async function buildFacts(
  vim: IWebglVim,
  isCancelled: () => boolean = () => false,
): Promise<Map<number, ElementFacts>> {
  const stripped = testNoUniqueId()
  const scope: ScopeElement[] = vim
    .getAllElements()
    .filter((element) => element.hasGeometry)
    .map((element) => {
      const elementId = String(element.elementId)
      return {
        index: element.element,
        elementId,
        uniqueId: stripped.has(elementId) ? undefined : element.elementUniqueId || undefined,
      }
    })
  return readFacts(vim.bim, scope, isCancelled)
}

declare global {
  interface Window {
    /**
     * TEST ONLY, dev server only: ElementIds whose UniqueId `buildFacts` drops.
     * See `testNoUniqueId`.
     */
    __vimSatelliteTestNoUniqueId?: unknown
  }
}

/**
 * TEST ONLY. The ElementIds whose UniqueId `buildFacts` drops, so an
 * end-to-end test can check how the app treats an element that has none: the
 * Tiny House fixture gives every element one, and editing the binary fixture
 * would hide what the test does. Playwright sets
 * `window.__vimSatelliteTestNoUniqueId` with `addInitScript` before the page
 * loads (tests/element-keys.spec.ts).
 *
 * Read only by the dev server (`import.meta.env.DEV`), which is what Playwright
 * runs against: a production build replaces the flag with `false` and drops
 * the read, so a deployed app never looks at the global.
 */
function testNoUniqueId(): ReadonlySet<string> {
  if (!import.meta.env.DEV || typeof window === 'undefined') return new Set()
  const ids = window.__vimSatelliteTestNoUniqueId
  return new Set(Array.isArray(ids) ? ids.map(String) : [])
}

/** A relation column holds -1 (or nothing) for "none". */
function at<T>(column: ArrayLike<T> | undefined, index: number | undefined): T | undefined {
  if (!column || index === undefined || index < 0 || index >= column.length) return undefined
  return column[index]
}

/** The numeric part of a stored parameter value: `<raw>|<display>`, e.g. `13.12|13' - 1 1/2"`. */
function rawNumber(value: string): number | null {
  const bar = value.indexOf('|')
  const raw = (bar >= 0 ? value.slice(0, bar) : value).trim()
  if (!raw) return null
  const number = Number(raw)
  return Number.isFinite(number) ? number : null
}

/** The text a person reads: the display part of `<raw>|<display>`, else the whole value. */
function displayText(value: string): string {
  const bar = value.indexOf('|')
  return (bar >= 0 ? value.slice(bar + 1) : value).trim()
}

/**
 * The facts of `scope`, read from a BIM document. Split from `buildFacts` so a
 * test can run it on a fixture without a viewer.
 *
 * Quantities follow the original workflow (db.js `buildQuantities`):
 * - Length = Revit's `Length`; Area = `Area`, else the summed area of the
 *   element's materials; Volume = `Volume`, else its materials' volume. Paint
 *   is not a material layer, so it is left out.
 * - A zero counts as "no value" (it would price the element at nothing).
 * - Several values of one parameter on one element: the largest wins.
 *
 * Every BIM table is optional in a VIM file; a missing one leaves its facts
 * empty instead of failing the build.
 */
export async function readFacts(
  bim: BimDocument | undefined,
  scope: ScopeElement[],
  isCancelled: () => boolean = () => false,
): Promise<Map<number, ElementFacts>> {
  const none = Promise.resolve(undefined)
  const [
    paramElement,
    paramValue,
    paramDescriptor,
    descriptorName,
    elementName,
    elementFamily,
    elementLevel,
    elementCategory,
    elementDocument,
    levelElement,
    categoryName,
    documentTitle,
    instanceElement,
    instanceType,
    typeElement,
    materialElement,
    materialArea,
    materialVolume,
    materialPaint,
  ] = await Promise.all([
    bim?.parameter?.getAllElementIndex() ?? none,
    bim?.parameter?.getAllValue() ?? none,
    bim?.parameter?.getAllParameterDescriptorIndex() ?? none,
    bim?.parameterDescriptor?.getAllName() ?? none,
    bim?.element?.getAllName() ?? none,
    bim?.element?.getAllFamilyName() ?? none,
    bim?.element?.getAllLevelIndex() ?? none,
    bim?.element?.getAllCategoryIndex() ?? none,
    bim?.element?.getAllBimDocumentIndex() ?? none,
    bim?.level?.getAllElementIndex() ?? none,
    bim?.category?.getAllName() ?? none,
    bim?.bimDocument?.getAllTitle() ?? none,
    bim?.familyInstance?.getAllElementIndex() ?? none,
    bim?.familyInstance?.getAllFamilyTypeIndex() ?? none,
    bim?.familyType?.getAllElementIndex() ?? none,
    bim?.materialInElement?.getAllElementIndex() ?? none,
    bim?.materialInElement?.getAllArea() ?? none,
    bim?.materialInElement?.getAllVolume() ?? none,
    bim?.materialInElement?.getAllIsPaint() ?? none,
  ])
  if (isCancelled()) throw new BuildCancelled()

  // Per-element accumulators, indexed by element row. NaN = no value yet.
  const inScope = new Set(scope.map((element) => element.index))
  let size = elementName?.length ?? 0
  for (const element of scope) size = Math.max(size, element.index + 1)
  const lengthFt = new Float64Array(size).fill(NaN)
  const areaFt = new Float64Array(size).fill(NaN)
  const volumeFt = new Float64Array(size).fill(NaN)
  const system = new Map<number, string>()

  // Classify each descriptor once, so the (large) parameter loop only does a lookup.
  if (paramElement && paramValue && paramDescriptor && descriptorName) {
    const kindOf = new Uint8Array(descriptorName.length)
    descriptorName.forEach((name, index) => {
      kindOf[index] = LENGTH_NAMES.includes(name)
        ? KIND_LENGTH
        : AREA_NAMES.includes(name)
          ? KIND_AREA
          : VOLUME_NAMES.includes(name)
            ? KIND_VOLUME
            : SYSTEM_NAMES.includes(name)
              ? KIND_SYSTEM
              : KIND_NONE
    })
    const count = paramElement.length
    for (let i = 0; i < count; i++) {
      const kind = kindOf[paramDescriptor[i]] ?? KIND_NONE
      if (kind === KIND_NONE) continue
      const element = paramElement[i]
      if (!inScope.has(element)) continue
      const value = paramValue[i] ?? ''
      if (kind === KIND_SYSTEM) {
        const text = displayText(value)
        const current = system.get(element)
        if (text && (current === undefined || text > current)) system.set(element, text)
        continue
      }
      const number = rawNumber(value)
      if (number === null) continue
      const target = kind === KIND_LENGTH ? lengthFt : kind === KIND_AREA ? areaFt : volumeFt
      if (!(number <= target[element])) target[element] = number
    }
  }
  if (isCancelled()) throw new BuildCancelled()

  // Material areas and volumes, summed per element (paint excluded).
  const materialAreaFt = new Float64Array(size)
  const materialVolumeFt = new Float64Array(size)
  if (materialElement) {
    for (let i = 0; i < materialElement.length; i++) {
      if (materialPaint?.[i]) continue
      const element = materialElement[i]
      if (element < 0 || element >= size) continue
      materialAreaFt[element] += materialArea?.[i] ?? 0
      materialVolumeFt[element] += materialVolume?.[i] ?? 0
    }
  }

  // Element -> family type name, through its family instance.
  const typeName = new Map<number, string>()
  if (instanceElement && instanceType) {
    for (let i = 0; i < instanceElement.length; i++) {
      const name = at(elementName, at(typeElement, instanceType[i]))
      if (name) typeName.set(instanceElement[i], name)
    }
  }

  /** null for "no value": NaN (never set) or 0. */
  const positive = (value: number): number | null => (value ? value : null)
  const scaled = (value: number | null, factor: number): number | null =>
    value === null ? null : value * factor

  const facts = new Map<number, ElementFacts>()
  for (const element of scope) {
    const i = element.index
    const category = at(categoryName, at(elementCategory, i)) ?? ''
    // A saved 3D view ("VIM Custom View") carries geometry, but it is not a
    // thing anyone builds or prices: the original workflow's Physical-Visible
    // domain leaves cameras out, so the estimate does too.
    if (category === EXCLUDED_CATEGORY) continue
    const length = positive(lengthFt[i] || 0)
    const area = positive(areaFt[i] || 0) ?? positive(materialAreaFt[i] || 0)
    const volume = positive(volumeFt[i] || 0) ?? positive(materialVolumeFt[i] || 0)
    facts.set(i, {
      index: i,
      key: elementKey(element),
      elementId: element.elementId,
      name: at(elementName, i) ?? '',
      category,
      family: at(elementFamily, i) ?? '',
      type: typeName.get(i) ?? '',
      level: at(elementName, at(levelElement, at(elementLevel, i))) ?? '',
      system: system.get(i) ?? '',
      document: at(documentTitle, at(elementDocument, i)) ?? '',
      length: scaled(length, FT),
      area: scaled(area, FT2),
      volume: scaled(volume, FT3),
    })
  }
  return facts
}
