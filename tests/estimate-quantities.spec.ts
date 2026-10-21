/**
 * quantities.ts against the real fixture, read with vim-format (the BIM
 * package vim-web is built on) instead of a viewer: no browser page.
 *
 * Scope here is "elements with a node", which is what vim-web's `hasGeometry`
 * means.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { readFacts } from '../src/estimate/quantities'
import type { ElementFacts } from '../src/estimate/types'

// vim-format ships CommonJS with no "main", so neither an ESM import nor a bare
// require finds it; require its entry file directly.
const { BFast, VimDocument } = createRequire(import.meta.url)(
  'vim-format/dist/index.js',
) as typeof import('vim-format')

const FIXTURE = new URL('./fixtures/Tiny_House_Imperial.r2026.vim', import.meta.url)

async function fixtureFacts(): Promise<Map<number, ElementFacts>> {
  const file = readFileSync(FIXTURE)
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
  const bim = await VimDocument.createFromBfast(new BFast({ buffer }))
  if (!bim) throw new Error('The fixture has no BIM document.')
  const [nodeElement, ids, uniqueIds] = await Promise.all([
    bim.node?.getAllElementIndex(),
    bim.element?.getAllId(),
    bim.element?.getAllUniqueId(),
  ])
  const withGeometry = [...new Set((nodeElement ?? []).filter((index) => index >= 0))].sort((a, b) => a - b)
  const scope = withGeometry.map((index) => ({
    index,
    elementId: String(ids?.[index] ?? -1),
    uniqueId: uniqueIds?.[index] || undefined,
  }))
  return readFacts(bim, scope)
}

test('the fixture: quantities in metric, names from the BIM tables', async () => {
  const facts = await fixtureFacts()
  expect(facts.size).toBe(25)

  // A wall: Revit's own Length / Area / Volume (feet), converted.
  const wall = facts.get(51)!
  expect(wall).toMatchObject({
    elementId: '366043',
    category: 'Walls',
    family: 'Basic Wall',
    type: 'Exterior - Brick and Block on Mtl. Stud',
    level: 'Level 1',
    document: 'Tiny_House_Imperial.r2026',
    system: '',
  })
  expect(wall.length).toBeCloseTo(4, 3)
  expect(wall.area).toBeCloseTo(14.88, 2)
  expect(wall.volume).toBeCloseTo(5.0646, 3)
  expect(wall.key).toBeTruthy()

  // A window has no Area / Volume parameter: the material sums stand in.
  const window = facts.get(76)!
  expect(window.category).toBe('Windows')
  expect(window.type).toBe('1400 x 1800mm')
  expect(window.length).toBeNull()
  expect(window.area).toBeCloseTo(15.422, 2)
  expect(window.volume).toBeCloseTo(0.1033, 3)

  // The sloped glazing roof has neither parameters nor materials.
  const roof = facts.get(67)!
  expect(roof.area).toBeNull()
  expect(roof.volume).toBeNull()

  const count = (pick: (entry: ElementFacts) => number | null): number =>
    [...facts.values()].filter((entry) => pick(entry) !== null).length
  expect(count((entry) => entry.length)).toBe(4)
  expect(count((entry) => entry.area)).toBe(23)
  expect(count((entry) => entry.volume)).toBe(23)
})
