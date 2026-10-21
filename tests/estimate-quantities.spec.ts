/**
 * quantities.ts against the real fixture, read with vim-format (the BIM
 * package vim-web is built on) instead of a viewer: no browser page.
 *
 * Scope here is "elements with a node", which is what vim-web's `hasGeometry`
 * means.
 */
import { expect, test } from '@playwright/test'
import { elementKey } from '../src/estimate/keys'
import { readFacts } from '../src/estimate/quantities'
import type { ElementFacts } from '../src/estimate/types'
import { fixtureFacts } from './support/fixture'

test('the fixture: quantities in metric, names from the BIM tables', async () => {
  const facts = await fixtureFacts()
  // 25 elements have a node; the saved 3D view (category Cameras) is not estimated.
  expect(facts.size).toBe(24)
  expect([...facts.values()].some((entry) => entry.category === 'Cameras')).toBe(false)

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

test('an element is keyed by its Revit UniqueId only: never its ElementId or row index', async () => {
  expect(elementKey({ uniqueId: 'f1b6322e-a0a5-48fa-a0b3-23b89552c8a3-000595db' })).toBe(
    'f1b6322e-a0a5-48fa-a0b3-23b89552c8a3-000595db',
  )
  // vim-web reports a missing UniqueId as ''.
  expect(elementKey({ uniqueId: '' })).toBeNull()
  expect(elementKey({})).toBeNull()

  // Every fixture element has one, and it is its key.
  const facts = await fixtureFacts()
  for (const entry of facts.values()) expect(entry.key).toMatch(/^[0-9a-f-]{45}$/)

  // An element read without one keeps its quantities and names, with a null key.
  const wall = facts.get(51)!
  const stripped = await readFacts(undefined, [{ index: 51, elementId: wall.elementId, uniqueId: '' }])
  expect(stripped.get(51)).toMatchObject({ index: 51, elementId: '366043', key: null })
})
