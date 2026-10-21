/**
 * The Elements tab's tree (Group by, search, the Show filter) and the Cost
 * Codes tab's tree (Discipline › Group), as plain data. Pure functions: the UI
 * renders the result through a virtual list, the tests check it directly.
 *
 * A group's VALUE is a string: a work package or cost code id, a name, or ''
 * for "no value". Labels are separate (`groupLabel`) because they depend on
 * the language and on names that can change without regrouping anything.
 */
import { categoryLabel } from './i18n'
import type { Translator } from './i18n'
import type { CostCode, ElementFacts, Lang, PricedRow, WorkPackage } from './types'

/** What the tree can group by. */
export type GroupLevel =
  | 'wp'
  | 'code'
  | 'category'
  | 'family'
  | 'type'
  | 'famtype'
  | 'level'
  | 'system'
  | 'document'

/** Every groupable level, estimate levels first (the order of the grouping drawer). */
export const GROUPABLE: GroupLevel[] = [
  'wp',
  'code',
  'category',
  'family',
  'type',
  'famtype',
  'level',
  'system',
  'document',
]

/** Work package › Cost code › Category › Family › Type › element. */
export const DEFAULT_NESTING: GroupLevel[] = ['wp', 'code', 'category', 'famtype']

/** A group row's WP / code value when its members differ. */
export const MIXED = '*'

/** Joins family and type in a `famtype` value (a character no name contains). */
export const FAMTYPE_SEPARATOR = '\u001f'

/** Whether a group value stands for "no value". */
export function isNoneValue(value: string): boolean {
  return value === ''
}

/** The English label of a level (pass it through `t`). */
export const LEVEL_LABEL: Record<GroupLevel, string> = {
  wp: 'Work package',
  code: 'Cost code',
  category: 'Category',
  family: 'Family',
  type: 'Type',
  famtype: 'Family › Type',
  level: 'Level',
  system: 'System',
  document: 'BIM Document',
}

/** One element's value at a level. */
export function groupValue(level: GroupLevel, facts: ElementFacts, row: PricedRow): string {
  switch (level) {
    case 'wp':
      return row.wp ?? ''
    case 'code':
      return row.code ?? ''
    case 'family':
      return facts.family
    case 'type':
      return facts.type
    case 'famtype':
      // A type named like its family (or no type) adds nothing: show the family alone.
      return !facts.type || facts.type === facts.family
        ? facts.family
        : `${facts.family}${FAMTYPE_SEPARATOR}${facts.type}`
    case 'level':
      return facts.level
    case 'system':
      return facts.system
    case 'document':
      return facts.document
    case 'category':
    default:
      return facts.category
  }
}

/** A work package's name in the UI language. */
export function workPackageName(wp: WorkPackage, lang: Lang): string {
  return (lang === 'ja' ? wp.ja : wp.en) || wp.en || wp.ja
}

/** "03-310  Concrete slab": how selects and rows show a code. */
export function costCodeLabel(code: CostCode): string {
  return `${code.code}  ${code.name ?? ''}`.trimEnd()
}

/** What `groupLabel` needs besides the value. */
export type LabelContext = {
  t: Translator
  lang: Lang
  workPackages: ReadonlyMap<string, WorkPackage>
  costCodes: ReadonlyMap<string, CostCode>
}

/** A family › type value as its two parts, or null for any other value. */
export function groupParts(level: GroupLevel, value: string): [string, string] | null {
  if (level !== 'famtype' || !value.includes(FAMTYPE_SEPARATOR)) return null
  const [family, type] = value.split(FAMTYPE_SEPARATOR)
  return [family, type]
}

/** The text of a group row. */
export function groupLabel(level: GroupLevel, value: string, context: LabelContext): string {
  const { t, lang } = context
  if (isNoneValue(value)) {
    return level === 'wp' ? t('(No work package)') : level === 'code' ? t('(No cost code)') : t('(none)')
  }
  if (level === 'wp') {
    const wp = context.workPackages.get(value)
    return wp ? workPackageName(wp, lang) : value
  }
  if (level === 'code') {
    const code = context.costCodes.get(value)
    return code ? costCodeLabel(code) : value
  }
  if (level === 'category') return categoryLabel(lang, value)
  const parts = groupParts(level, value)
  return parts ? `${parts[0]} › ${parts[1]}` : value
}

/** The Show filter (it replaces the original's Filter-by rule builder). */
export type ShowFilter = 'all' | 'included' | 'excluded'

/** Checkbox state: included, excluded, or a group with both. */
export type CheckState = 'checked' | 'unchecked' | 'partial'

/** A group row (or the root, which has `level: null` and `depth: -1`). */
export type GroupNode = {
  kind: 'group'
  /** Unique and stable across rebuilds (the path of values): the open state is kept by it. */
  key: string
  level: GroupLevel | null
  value: string
  depth: number
  children: TreeNode[]
  /** Every element under the group, in tree order. A group's select applies to all of them. */
  elements: number[]
  count: number
  amount: number
  /** Σ qty, only when every member has the same cost code (one unit); else null. */
  qty: number | null
  /** The shared work package id; '' when no member has one; MIXED when they differ. */
  wp: string
  /** The shared cost code id; '' when no member has one; MIXED when they differ. */
  code: string
  /** Excluded members. */
  hidden: number
  /** Members with a code but no quantity (the row gets the warn tint). */
  missing: number
}

/** An element row: the leaf. */
export type ElementNode = {
  kind: 'element'
  /** `el-<index>`. */
  key: string
  index: number
  depth: number
  facts: ElementFacts
  row: PricedRow
}

export type TreeNode = GroupNode | ElementNode

/** What `buildTree` reads. */
export type TreeInput = {
  facts: ReadonlyMap<number, ElementFacts>
  priced: ReadonlyMap<number, PricedRow>
  nesting: readonly GroupLevel[]
  /** Free text; matches name, type, category, cost code and name, note, ElementId. */
  search?: string
  show?: ShowFilter
  workPackages: ReadonlyMap<string, WorkPackage>
  costCodes: ReadonlyMap<string, CostCode>
}

/** ElementIds are numeric text; compare as numbers, then by index for ties and odd ids. */
function byElementId(a: ElementFacts, b: ElementFacts): number {
  const x = Number(a.elementId)
  const y = Number(b.elementId)
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y
  if (a.elementId !== b.elementId) return a.elementId < b.elementId ? -1 : 1
  return a.index - b.index
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Value order within a level: work packages in their own order, codes by their
 * code text, everything else by name; "no value" always last.
 */
function valueComparator(
  level: GroupLevel,
  workPackages: ReadonlyMap<string, WorkPackage>,
  costCodes: ReadonlyMap<string, CostCode>,
): (a: string, b: string) => number {
  const rest = (a: string, b: string): number => {
    if (level === 'wp') {
      const x = workPackages.get(a)
      const y = workPackages.get(b)
      return (x?.sort ?? 0) - (y?.sort ?? 0) || (a < b ? -1 : a > b ? 1 : 0)
    }
    if (level === 'code') {
      return collator.compare(costCodes.get(a)?.code ?? a, costCodes.get(b)?.code ?? b) || (a < b ? -1 : 1)
    }
    return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
  }
  return (a, b) => {
    if (isNoneValue(a) !== isNoneValue(b)) return isNoneValue(a) ? 1 : -1
    return rest(a, b)
  }
}

/** The text the search looks in, lower-cased. */
function haystack(
  facts: ElementFacts,
  row: PricedRow,
  costCodes: ReadonlyMap<string, CostCode>,
): string {
  const code = row.code ? costCodes.get(row.code) : undefined
  return [
    facts.name,
    facts.type,
    facts.category,
    code ? costCodeLabel(code) : '',
    row.note,
    facts.elementId,
  ]
    .join('\n')
    .toLowerCase()
}

/** The value every row shares, '' when none has one, MIXED when they differ. */
function sharedOf(values: (string | null)[]): string {
  let first: string | null | undefined
  let any = false
  for (const value of values) {
    if (value !== null) any = true
    if (first === undefined) first = value
    else if (value !== first) return MIXED
  }
  return any ? (first ?? '') : ''
}

function aggregate(node: GroupNode, priced: ReadonlyMap<number, PricedRow>): void {
  const rows = node.elements.map((index) => priced.get(index) as PricedRow)
  node.count = rows.length
  node.amount = rows.reduce((sum, row) => sum + row.amount, 0)
  node.hidden = rows.filter((row) => row.hidden).length
  node.missing = rows.filter((row) => row.missing).length
  node.wp = sharedOf(rows.map((row) => row.wp))
  node.code = sharedOf(rows.map((row) => row.code))
  const oneCode = rows.length > 0 && node.code !== '' && node.code !== MIXED
  const quantities = rows.filter((row) => row.qty !== null)
  node.qty = oneCode && quantities.length ? quantities.reduce((sum, row) => sum + (row.qty ?? 0), 0) : null
}

function emptyGroup(key: string, level: GroupLevel | null, value: string, depth: number): GroupNode {
  return {
    kind: 'group',
    key,
    level,
    value,
    depth,
    children: [],
    elements: [],
    count: 0,
    amount: 0,
    qty: null,
    wp: '',
    code: '',
    hidden: 0,
    missing: 0,
  }
}

/**
 * The tree: the elements that pass the Show filter and the search, grouped by
 * `nesting`, each group with its aggregates. Groups exist only where elements
 * are, so the search narrows the groups too. Returns the root (`depth -1`):
 * its aggregates describe everything listed, e.g. for the header checkbox.
 */
export function buildTree(input: TreeInput): GroupNode {
  const { facts, priced, nesting, workPackages, costCodes } = input
  const needle = (input.search ?? '').trim().toLowerCase()
  const show = input.show ?? 'all'

  const listed: ElementFacts[] = []
  for (const fact of facts.values()) {
    const row = priced.get(fact.index)
    if (!row) continue
    if (show === 'included' && row.hidden) continue
    if (show === 'excluded' && !row.hidden) continue
    if (needle && !haystack(fact, row, costCodes).includes(needle)) continue
    listed.push(fact)
  }
  listed.sort(byElementId)

  const root = emptyGroup('root', null, '', -1)
  const fill = (parent: GroupNode, members: ElementFacts[], depth: number): void => {
    parent.elements = members.map((fact) => fact.index)
    aggregate(parent, priced)
    if (depth >= nesting.length) {
      parent.children = members.map((fact) => ({
        kind: 'element',
        key: `el-${fact.index}`,
        index: fact.index,
        depth,
        facts: fact,
        row: priced.get(fact.index) as PricedRow,
      }))
      return
    }
    const level = nesting[depth]
    const buckets = new Map<string, ElementFacts[]>()
    for (const fact of members) {
      const value = groupValue(level, fact, priced.get(fact.index) as PricedRow)
      const bucket = buckets.get(value)
      if (bucket) bucket.push(fact)
      else buckets.set(value, [fact])
    }
    const order = [...buckets.keys()].sort(valueComparator(level, workPackages, costCodes))
    parent.children = order.map((value) => {
      // Level and value both go in the key: the same value at two levels is two groups.
      const key = `${parent.key}\u001e${level}:${value}`
      const child = emptyGroup(key, level, value, depth)
      fill(child, buckets.get(value) as ElementFacts[], depth + 1)
      return child
    })
  }
  fill(root, listed, 0)
  return root
}

/** The include checkbox of a row. */
export function checkState(node: TreeNode): CheckState {
  if (node.kind === 'element') return node.row.hidden ? 'unchecked' : 'checked'
  if (node.hidden === 0) return 'checked'
  return node.hidden >= node.count ? 'unchecked' : 'partial'
}

/** The rows a virtual list shows: depth-first, children of open groups only. The root is not a row. */
export function visibleRows(root: GroupNode, open: ReadonlySet<string>): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (node: GroupNode): void => {
    for (const child of node.children) {
      out.push(child)
      if (child.kind === 'group' && open.has(child.key)) walk(child)
    }
  }
  walk(root)
  return out
}

/** The keys of every group above `depth` ("expand to level"): open them to show rows down to `depth`. */
export function groupKeysAbove(root: GroupNode, depth: number): Set<string> {
  const keys = new Set<string>()
  const walk = (node: GroupNode): void => {
    for (const child of node.children) {
      if (child.kind !== 'group' || child.depth >= depth) continue
      keys.add(child.key)
      walk(child)
    }
  }
  walk(root)
  return keys
}

/** The deepest depth whose rows are showing (0 = only top-level groups): "Expand one more level" opens one below it. */
export function shownDepth(root: GroupNode, open: ReadonlySet<string>): number {
  let deepest = 0
  for (const node of visibleRows(root, open)) deepest = Math.max(deepest, node.depth)
  return deepest
}

// ---- Cost Codes tab --------------------------------------------------------------------------

/** A Discipline or Group row of the Cost Codes tree. */
export type CodeGroupNode = {
  kind: 'group'
  /** `d:<discipline>` or `d:<discipline>\u001eg:<group>`. */
  key: string
  level: 'discipline' | 'grp'
  /** '' = "(No discipline)" / "(No group)". */
  value: string
  depth: number
  children: CodeTreeNode[]
  /** Every code id under the group: a click selects the elements of all of them. */
  codeIds: string[]
  /** Elements carrying any of its codes. */
  count: number
  amount: number
}

/** A cost code row. */
export type CodeLeafNode = {
  kind: 'code'
  /** `code-<id>`. */
  key: string
  depth: number
  code: CostCode
  count: number
  qty: number | null
  amount: number
}

export type CodeTreeNode = CodeGroupNode | CodeLeafNode

/** How a code is used (pricing.ts `codeUsage`). */
type Usage = ReadonlyMap<string, { count: number; qty: number | null; amount: number }>

/**
 * The Cost Codes tree: Discipline › Group › code, codes by their code text,
 * "none" groups last. `search` matches code, name and description; `inUse`
 * keeps only codes some element carries.
 */
export function buildCodeTree(input: {
  costCodes: ReadonlyMap<string, CostCode>
  usage: Usage
  search?: string
  inUse?: boolean
}): CodeGroupNode[] {
  const needle = (input.search ?? '').trim().toLowerCase()
  const codes = [...input.costCodes.values()]
    .filter((code) => !input.inUse || (input.usage.get(code.id)?.count ?? 0) > 0)
    .filter(
      (code) =>
        !needle || `${code.code}\n${code.name}\n${code.descr}`.toLowerCase().includes(needle),
    )
    .sort((a, b) => collator.compare(a.code, b.code) || (a.id < b.id ? -1 : 1))
  const byNone = (a: string, b: string): number =>
    isNoneValue(a) !== isNoneValue(b) ? (isNoneValue(a) ? 1 : -1) : collator.compare(a, b)

  const leaf = (code: CostCode): CodeLeafNode => {
    const use = input.usage.get(code.id)
    return {
      kind: 'code',
      key: `code-${code.id}`,
      depth: 2,
      code,
      count: use?.count ?? 0,
      qty: use?.qty ?? null,
      amount: use?.amount ?? 0,
    }
  }
  const group = (
    key: string,
    level: 'discipline' | 'grp',
    value: string,
    depth: number,
    children: CodeTreeNode[],
  ): CodeGroupNode => {
    const leaves: CodeLeafNode[] = []
    const collect = (nodes: CodeTreeNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'code') leaves.push(node)
        else collect(node.children)
      }
    }
    collect(children)
    return {
      kind: 'group',
      key,
      level,
      value,
      depth,
      children,
      codeIds: leaves.map((node) => node.code.id),
      count: leaves.reduce((sum, node) => sum + node.count, 0),
      amount: leaves.reduce((sum, node) => sum + node.amount, 0),
    }
  }

  const disciplines = new Map<string, Map<string, CostCode[]>>()
  for (const code of codes) {
    const discipline = (code.discipline ?? '').trim()
    const grp = (code.grp ?? '').trim()
    let groups = disciplines.get(discipline)
    if (!groups) disciplines.set(discipline, (groups = new Map()))
    const list = groups.get(grp)
    if (list) list.push(code)
    else groups.set(grp, [code])
  }
  return [...disciplines.keys()].sort(byNone).map((discipline) => {
    const dKey = `d:${discipline}`
    const groups = disciplines.get(discipline) as Map<string, CostCode[]>
    const children = [...groups.keys()].sort(byNone).map((grp) =>
      group(`${dKey}\u001eg:${grp}`, 'grp', grp, 1, (groups.get(grp) as CostCode[]).map(leaf)),
    )
    return group(dKey, 'discipline', discipline, 0, children)
  })
}

/** The rows of the Cost Codes tree under the open groups (for a virtual list). */
export function visibleCodeRows(
  roots: readonly CodeGroupNode[],
  open: ReadonlySet<string>,
): CodeTreeNode[] {
  const out: CodeTreeNode[] = []
  const walk = (nodes: readonly CodeTreeNode[]): void => {
    for (const node of nodes) {
      out.push(node)
      if (node.kind === 'group' && open.has(node.key)) walk(node.children)
    }
  }
  walk(roots)
  return out
}
