/**
 * The estimate's pure functions: pricing, totals, the cost ramp, grouping,
 * the translator. No browser page: these run in the test runner's Node.
 */
import { expect, test } from '@playwright/test'
import {
  DEFAULT_NESTING,
  FAMTYPE_SEPARATOR,
  MIXED,
  buildCodeTree,
  buildTree,
  checkState,
  groupKeysAbove,
  groupLabel,
  groupValue,
  visibleRows,
} from '../src/estimate/grouping'
import type { GroupNode, TreeNode } from '../src/estimate/grouping'
import { makeT, money, parseNumber } from '../src/estimate/i18n'
import {
  COST_STOPS,
  WHITE,
  codeUsage,
  computeTotals,
  costColors,
  levelColors,
  priceRows,
  rampColor,
} from '../src/estimate/pricing'
import { applyPatch } from '../src/estimate/types'
import type { Assignment, CostCode, ElementFacts, WorkPackage } from '../src/estimate/types'

function fact(index: number, extra: Partial<ElementFacts> = {}): ElementFacts {
  return {
    index,
    key: `u-${index}`,
    elementId: String(1000 + index),
    name: `Element ${index}`,
    category: 'Walls',
    family: 'Basic Wall',
    type: 'Generic 200',
    level: 'Level 1',
    system: '',
    document: 'House',
    length: 2,
    area: 10,
    volume: 3,
    ...extra,
  }
}

function code(id: string, extra: Partial<CostCode> = {}): CostCode {
  return {
    id,
    code: id.toUpperCase(),
    name: `Code ${id}`,
    descr: '',
    discipline: '',
    grp: '',
    unit: '',
    basis: 'count',
    price: 0,
    laborDays: 0,
    laborRate: 0,
    matAdd: 0,
    labAdd: 0,
    ...extra,
  }
}

function assigned(fields: Partial<Assignment>): Assignment {
  return { elementId: '', at: '2026-01-01T00:00:00Z', ...fields }
}

const factsOf = (list: ElementFacts[]): Map<number, ElementFacts> =>
  new Map(list.map((entry) => [entry.index, entry]))

test.describe('pricing', () => {
  test('material, labor and extra add up with their adders', () => {
    const facts = factsOf([fact(0)])
    const codes = new Map([
      ['c', code('c', { price: 10, matAdd: 0.1, laborDays: 0.5, laborRate: 100, labAdd: 0.2 })],
    ])
    const rows = priceRows(facts, new Map([['u-0', assigned({ code: 'c', extra: 5 })]]), codes)
    const row = rows.get(0)!
    expect(row.qty).toBe(1)
    expect(row.material).toBeCloseTo(11)
    expect(row.labor).toBeCloseTo(60)
    expect(row.amount).toBeCloseTo(76)
    expect(row.missing).toBe(false)
  })

  test('each basis reads its own quantity', () => {
    const facts = factsOf([fact(0), fact(1), fact(2)])
    const codes = new Map([
      ['len', code('len', { basis: 'length', price: 1 })],
      ['area', code('area', { basis: 'area', price: 1 })],
      ['vol', code('vol', { basis: 'volume', price: 1 })],
    ])
    const assignments = new Map([
      ['u-0', assigned({ code: 'len' })],
      ['u-1', assigned({ code: 'area' })],
      ['u-2', assigned({ code: 'vol' })],
    ])
    const rows = priceRows(facts, assignments, codes)
    expect([0, 1, 2].map((i) => rows.get(i)!.amount)).toEqual([2, 10, 3])
  })

  test('a lump sum is charged once, on the lowest element index', () => {
    const facts = factsOf([fact(7), fact(3), fact(5), fact(9)])
    const codes = new Map([['lump', code('lump', { basis: 'lump', price: 1000 })]])
    const assignments = new Map(
      [7, 3, 5].map((i) => [`u-${i}`, assigned({ code: 'lump' })] as const),
    )
    const rows = priceRows(facts, assignments, codes)
    expect(rows.get(3)!.amount).toBe(1000)
    expect(rows.get(3)!.qty).toBe(1)
    expect(rows.get(5)!.qty).toBe(0)
    expect(rows.get(7)!.amount).toBe(0)
    expect(rows.get(9)!.code).toBeNull()
    expect(computeTotals(rows, []).direct).toBe(1000)
  })

  test('a code without a quantity is missing and costs only its extra', () => {
    const facts = factsOf([fact(0, { area: null })])
    const codes = new Map([['a', code('a', { basis: 'area', price: 50 })]])
    const rows = priceRows(facts, new Map([['u-0', assigned({ code: 'a', extra: 7 })]]), codes)
    const row = rows.get(0)!
    expect(row.missing).toBe(true)
    expect(row.qty).toBeNull()
    expect(row.material).toBeNull()
    expect(row.labor).toBeNull()
    expect(row.amount).toBe(7)
    expect(computeTotals(rows, []).nmissing).toBe(1)
  })

  test('an element without an assignment costs nothing; a deleted code counts as none', () => {
    const facts = factsOf([fact(0), fact(1)])
    const rows = priceRows(facts, new Map([['u-1', assigned({ code: 'gone', wp: 'gone' })]]), new Map(), new Map())
    expect(rows.get(0)!.amount).toBe(0)
    expect(rows.get(1)!.code).toBeNull()
    expect(rows.get(1)!.wp).toBeNull()
    expect(rows.get(1)!.missing).toBe(false)
  })

  test('markups add to the direct cost; hidden elements still count', () => {
    const facts = factsOf([fact(0), fact(1), fact(2)])
    const codes = new Map([['c', code('c', { price: 100 })]])
    const assignments = new Map([
      ['u-0', assigned({ code: 'c', wp: 'w' })],
      ['u-1', assigned({ code: 'c', hidden: true })],
      ['u-2', assigned({ extra: 50 })],
    ])
    const rows = priceRows(facts, assignments, codes)
    const totals = computeTotals(rows, [
      { id: 'a', name: 'A', pct: 5 },
      { id: 'b', name: 'B', pct: 10 },
    ])
    expect(totals.direct).toBe(250)
    expect(totals.material).toBe(200)
    expect(totals.extra).toBe(50)
    expect(totals.ncode).toBe(2)
    expect(totals.nwp).toBe(1)
    expect(totals.nall).toBe(3)
    expect(totals.markupPct).toBe(15)
    expect(totals.markup).toBeCloseTo(37.5)
    expect(totals.total).toBeCloseTo(287.5)
  })

  test('code usage sums count, quantity and amount per code', () => {
    const facts = factsOf([fact(0), fact(1), fact(2)])
    const codes = new Map([['c', code('c', { basis: 'area', price: 2 })]])
    const assignments = new Map([
      ['u-0', assigned({ code: 'c' })],
      ['u-2', assigned({ code: 'c' })],
    ])
    const usage = codeUsage(priceRows(facts, assignments, codes))
    expect(usage.get('c')).toEqual({ count: 2, qty: 20, amount: 40, elements: [0, 2] })
  })

  test('applyPatch clears with null, deletes an empty row and skips a no-op', () => {
    const meta = { elementId: '1', at: 'now' }
    expect(applyPatch(undefined, { hidden: false }, meta)).toBeUndefined()
    const set = applyPatch(undefined, { code: 'c', note: 'n' }, meta)
    expect(set).toMatchObject({ code: 'c', note: 'n', elementId: '1' })
    expect(applyPatch(set!, { code: 'c' }, meta)).toBeUndefined()
    expect(applyPatch(set!, { code: null, note: null }, meta)).toBeNull()
    expect(applyPatch(set!, { hidden: true }, meta)).toMatchObject({ code: 'c', hidden: true })
  })
})

test.describe('cost ramp', () => {
  const ramp = ['#000000', '#000000', '#808080', '#c0c0c0', '#ffffff']

  test('stops sit at 0, .25, .5, .9 and 1', () => {
    expect(COST_STOPS).toEqual([0, 0.25, 0.5, 0.9, 1])
    expect(rampColor(0, ramp)).toBe('#000000')
    expect(rampColor(0.25, ramp)).toBe('#000000')
    expect(rampColor(0.5, ramp)).toBe('#808080')
    expect(rampColor(0.9, ramp)).toBe('#c0c0c0')
    expect(rampColor(1, ramp)).toBe('#ffffff')
    expect(rampColor(0.375, ramp)).toBe('#404040')
  })

  test('colours follow the rank of the coded elements; uncoded are white', () => {
    const facts = factsOf([0, 1, 2, 3, 4, 5].map((i) => fact(i)))
    const codes = new Map([['c', code('c', { price: 1 })]])
    // Amounts 1, 10, 100, 1000, 100000 (extra adds to the count price of 1).
    const extras = [0, 9, 99, 999, 99999]
    const assignments = new Map(
      extras.map((extra, i) => [`u-${i}`, assigned({ code: 'c', extra })] as const),
    )
    const paint = costColors(priceRows(facts, assignments, codes), ramp)
    expect(paint.colors.get(5)).toBe(WHITE)
    expect(paint.colors.get(0)).toBe('#000000') // rank 0
    expect(paint.colors.get(1)).toBe('#000000') // rank .25
    expect(paint.colors.get(2)).toBe('#808080') // rank .5
    expect(paint.colors.get(4)).toBe('#ffffff') // rank 1
    expect(paint.lo).toBe(1)
    expect(paint.mid).toBe(100)
    expect(paint.hi).toBe(100000)
  })

  test('ties share the lower rank', () => {
    const facts = factsOf([fact(0), fact(1), fact(2)])
    const codes = new Map([['c', code('c', { price: 5 })]])
    const assignments = new Map([0, 1, 2].map((i) => [`u-${i}`, assigned({ code: 'c' })] as const))
    const paint = costColors(priceRows(facts, assignments, codes), ramp)
    expect(new Set(paint.colors.values())).toEqual(new Set(['#000000']))
  })

  test('colours by level: one colour per value, white for none, stable per seed', () => {
    const facts = factsOf([fact(0, { level: 'L1' }), fact(1, { level: 'L2' }), fact(2, { level: '' })])
    const rows = priceRows(facts, new Map(), new Map())
    const a = levelColors('level', facts.keys(), facts, rows, 0)
    const b = levelColors('level', facts.keys(), facts, rows, 0)
    expect(a.byElement.get(2)).toBe(WHITE)
    expect(a.byElement.get(0)).not.toBe(a.byElement.get(1))
    expect([...a.byValue]).toEqual([...b.byValue])
  })
})

test.describe('grouping', () => {
  const workPackages = new Map<string, WorkPackage>([
    ['wp-b', { id: 'wp-b', en: 'Bravo', ja: 'ブラボー', sort: 1 }],
    ['wp-a', { id: 'wp-a', en: 'Alpha', ja: 'アルファ', sort: 2 }],
  ])
  const costCodes = new Map([
    ['c1', code('c1', { code: '02', basis: 'area', price: 1 })],
    ['c2', code('c2', { code: '01', basis: 'count', price: 1 })],
  ])
  const facts = factsOf([
    fact(0, { elementId: '30' }),
    fact(1, { elementId: '10', category: 'Doors', family: 'Door', type: 'Door' }),
    fact(2, { elementId: '20', type: '' }),
    fact(3, { elementId: '40', name: 'Special slab' }),
  ])
  const assignments = new Map([
    ['u-0', assigned({ wp: 'wp-a', code: 'c1' })],
    ['u-1', assigned({ wp: 'wp-b', code: 'c2', note: 'check the frame' })],
    ['u-2', assigned({ wp: 'wp-a', code: 'c1', hidden: true })],
  ])
  const priced = priceRows(facts, assignments, costCodes, workPackages)
  const tree = (extra: Partial<Parameters<typeof buildTree>[0]> = {}): GroupNode =>
    buildTree({ facts, priced, nesting: ['wp', 'code'], workPackages, costCodes, ...extra })
  const groups = (node: GroupNode): GroupNode[] =>
    node.children.filter((child): child is GroupNode => child.kind === 'group')

  test('nests by level; work packages in their order, none last; leaves by ElementId', () => {
    const root = tree()
    expect(root.count).toBe(4)
    expect(groups(root).map((g) => g.value)).toEqual(['wp-b', 'wp-a', ''])
    const alpha = groups(root)[1]
    expect(alpha.depth).toBe(0)
    expect(groups(alpha).map((g) => g.value)).toEqual(['c1'])
    const leaves = groups(alpha)[0].children as TreeNode[]
    expect(leaves.map((leaf) => leaf.key)).toEqual(['el-2', 'el-0'])
    expect(leaves[0].depth).toBe(2)
  })

  test('group aggregates: shared and mixed values, qty under one code, hidden, amount', () => {
    const root = tree({ nesting: ['category'] })
    const walls = groups(root).find((g) => g.value === 'Walls')!
    expect(walls.count).toBe(3)
    expect(walls.wp).toBe(MIXED) // wp-a, wp-a, none
    expect(walls.code).toBe(MIXED)
    expect(walls.qty).toBeNull()
    expect(checkState(walls)).toBe('partial')
    const alpha = groups(tree())[1]
    expect(alpha.wp).toBe('wp-a')
    expect(alpha.code).toBe('c1')
    expect(alpha.qty).toBe(20)
    expect(alpha.amount).toBe(20)
    const none = groups(tree())[2]
    expect(none.wp).toBe('')
    expect(none.code).toBe('')
    expect(checkState(none)).toBe('checked')
  })

  test('code groups sort by code text', () => {
    expect(groups(tree({ nesting: ['code'] })).map((g) => g.value)).toEqual(['c2', 'c1', ''])
  })

  test('search narrows the leaves and the groups', () => {
    expect(tree({ search: 'FRAME' }).elements).toEqual([1])
    expect(tree({ search: '40' }).elements).toEqual([3])
    expect(tree({ search: '02  code' }).elements).toEqual([2, 0])
    expect(groups(tree({ search: 'special' })).map((g) => g.value)).toEqual([''])
  })

  test('the Show filter keeps included or excluded elements', () => {
    expect(tree({ show: 'excluded' }).elements).toEqual([2])
    expect(tree({ show: 'included' }).elements).toEqual([1, 0, 3])
  })

  test('family › type joins two names, unless the type adds nothing', () => {
    const row = priced.get(0)!
    expect(groupValue('famtype', facts.get(0)!, row)).toBe(`Basic Wall${FAMTYPE_SEPARATOR}Generic 200`)
    expect(groupValue('famtype', facts.get(1)!, priced.get(1)!)).toBe('Door')
    expect(groupValue('famtype', facts.get(2)!, priced.get(2)!)).toBe('Basic Wall')
    const t = makeT('ja', 'USD')
    const context = { t, lang: 'ja' as const, workPackages, costCodes }
    expect(groupLabel('famtype', `A${FAMTYPE_SEPARATOR}B`, context)).toBe('A › B')
    expect(groupLabel('wp', 'wp-a', context)).toBe('アルファ')
    expect(groupLabel('wp', '', context)).toBe('（工種なし）')
    expect(groupLabel('category', 'Walls', context)).toBe('壁')
  })

  test('only open groups show their rows; expand-to-depth opens the levels above it', () => {
    const root = buildTree({ facts, priced, nesting: DEFAULT_NESTING, workPackages, costCodes })
    expect(visibleRows(root, new Set()).length).toBe(3)
    const open = groupKeysAbove(root, 1)
    expect(open.size).toBe(3)
    const rows = visibleRows(root, open)
    expect(rows.every((row) => row.depth <= 1)).toBe(true)
    expect(rows.length).toBe(3 + 3)
  })

  test('the cost code tree groups by discipline and group, none last', () => {
    const codes = new Map([
      ['a', code('a', { code: 'P-2', discipline: 'Plumbing', grp: 'Pipes' })],
      ['b', code('b', { code: 'P-1', discipline: 'Plumbing', grp: 'Pipes' })],
      ['c', code('c', { code: 'X-1' })],
      ['d', code('d', { code: 'E-1', discipline: 'Electrical' })],
    ])
    const usage = new Map([['b', { count: 3, qty: 3, amount: 30 }]])
    const roots = buildCodeTree({ costCodes: codes, usage })
    expect(roots.map((root) => root.value)).toEqual(['Electrical', 'Plumbing', ''])
    const pipes = roots[1].children[0]
    expect(pipes.kind === 'group' && pipes.children.map((leaf) => leaf.key)).toEqual(['code-b', 'code-a'])
    expect(roots[1].count).toBe(3)
    expect(buildCodeTree({ costCodes: codes, usage, inUse: true }).map((root) => root.value)).toEqual(['Plumbing'])
    expect(buildCodeTree({ costCodes: codes, usage, search: 'x-1' })[0].codeIds).toEqual(['c'])
  })
})

test.describe('i18n', () => {
  test('the yen labels show the sheet currency; slot data keeps its own text', () => {
    expect(makeT('en', 'USD')('Amount ¥')).toBe('Amount $')
    expect(makeT('ja', 'EUR')('Amount ¥')).toBe('金額（€）')
    expect(makeT('ja', 'JPY')('Amount ¥')).toBe('金額（円）')
    expect(makeT('en', 'USD')('Cost code {code} copied.', { code: '¥-1' })).toBe('Cost code ¥-1 copied.')
    expect(makeT('ja', 'USD')('{n} without a quantity', { n: 3 })).toBe('数量なし 3 件')
    expect(money(1234.4, 'GBP')).toBe('£ 1,234')
  })

  test('typed numbers allow full-width digits, symbols and commas', () => {
    expect(parseNumber('１，２００円')).toBe(1200)
    expect(parseNumber('$ 3.5')).toBe(3.5)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
  })
})
