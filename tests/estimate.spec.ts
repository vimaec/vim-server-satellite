/**
 * The Estimate, end to end against the mock server: a real vim-web viewer
 * loads the Tiny House fixture over mocked HTTP Range requests, and every
 * estimate write lands in the mock's data store, where the tests read it back.
 *
 * The tests wait on what the app reports through `window.__vimSatellite` and
 * on the mock's write log, never on a timer.
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { defaultOrgs, installMockVimServer } from './support/mockVimServer'
import type { MockHandle, MockOptions, RecordedWrite } from './support/mockVimServer'
import { useFakeSession } from './support/auth'
import { fixtureElement } from './support/fixture'

/** Parsing and building the whole snapshot under software GL is not quick. */
const LOAD_TIMEOUT = 60_000

/** The 25 fixture elements with geometry, minus the saved 3D view (see estimate-quantities.spec.ts). */
const ELEMENT_COUNT = 24

/** Fixture elements by index. WALL is 4 m long; the walls are the ones the search "Walls" lists. */
const WALL = 51 // Basic Wall, ElementId 366043
const WALL_2 = 64 // Basic Wall, ElementId 366048
const WINDOW = 76 // M_Window-Casement-Double, ElementId 366534

const CODES = 'estimate.costCodes'
const PACKAGES = 'estimate.workPackages'
const SHEETS = 'estimate.sheets'
const SHEET_1 = 'estimate.sheet.sheet-1'
const SHEET_2 = 'estimate.sheet.sheet-2'

// ---- the app -----------------------------------------------------------------------------------

/** Opens the Tiny House project and waits until the estimate covers its elements. */
async function openEstimate(page: Page, options: MockOptions = {}): Promise<MockHandle> {
  const mock = await installMockVimServer(page, options)
  await useFakeSession(page)
  await page.goto('/?project=p-tiny')
  await waitForEstimate(page)
  return mock
}

/** The snapshot is in the viewer, the estimate is read, and the model's quantities are built. */
async function waitForEstimate(page: Page): Promise<void> {
  await expect(page.getByTestId('viewer-status')).toHaveAttribute('data-state', 'loaded', {
    timeout: LOAD_TIMEOUT,
  })
  await expect
    .poll(() => page.evaluate(() => window.__vimSatellite?.getEstimate()?.totals.nall), {
      timeout: LOAD_TIMEOUT,
    })
    .toBe(ELEMENT_COUNT)
}

function estimate(page: Page) {
  return page.evaluate(() => window.__vimSatellite?.getEstimate() ?? null)
}

function selection(page: Page): Promise<number[] | undefined> {
  return page.evaluate(() => window.__vimSatellite?.getSelection())
}

/** The active sheet's assignments are read: after a switch, edits are only taken once they are. */
async function waitForSheet(page: Page): Promise<void> {
  await expect.poll(async () => (await estimate(page))?.sheetStatus).toBe('ready')
}

/** Submits a search: the tree filters on Enter, and a search opens every group. */
async function search(page: Page, text: string): Promise<void> {
  const box = page.getByTestId('element-search')
  await box.fill(text)
  await box.press('Enter')
}

function elementRow(page: Page, index: number): Locator {
  return page.locator(`[data-testid="tree-row"][data-key="el-${index}"]`)
}

/** A click on the row's label: a click on one of its cell controls does not select. */
async function clickElement(
  page: Page,
  index: number,
  modifiers?: ('ControlOrMeta' | 'Shift')[],
): Promise<void> {
  await elementRow(page, index).locator('.ds-tree__label').click({ modifiers })
}

/** Lists one element (a search on its ElementId) and selects it alone. */
async function selectElement(page: Page, index: number): Promise<void> {
  await search(page, (await fixtureElement(index)).elementId)
  await clickElement(page, index)
  await expect.poll(() => selection(page)).toEqual([index])
}

/** Right-clicks an element row and picks a menu verb. */
async function rowMenu(page: Page, index: number, action: string): Promise<void> {
  await elementRow(page, index).locator('.ds-tree__label').click({ button: 'right' })
  await menuItem(page, action).click()
}

function menuItem(page: Page, action: string): Locator {
  return page.getByTestId('context-menu').locator(`[data-testid="menu-item"][data-action="${action}"]`)
}

/** Opens a DS select and picks the option (or action item) with this id. */
async function pick(page: Page, select: Locator, value: string): Promise<void> {
  await select.click()
  await page.locator(`[data-testid="select-option"][data-value="${value}"]`).click()
}

// ---- the store ---------------------------------------------------------------------------------

/** A markup as the store holds it in a sheet entry. */
type StoredMarkup = { id: string; name: string; pct: number }

function writesTo(mock: MockHandle, namespace: string): RecordedWrite[] {
  return mock.writes.filter((write) => write.namespace === namespace)
}

/** Position of the first recorded write that matches, -1 when none does. */
function writeIndex(mock: MockHandle, match: (write: RecordedWrite) => boolean): number {
  return mock.writes.findIndex(match)
}

/** The keys stored in a namespace. */
function storedKeys(mock: MockHandle, namespace: string): string[] {
  return [...(mock.store.get(namespace)?.keys() ?? [])].sort()
}

/** Every request that is not a read. */
function writeCalls(mock: MockHandle): string[] {
  return mock.calls.filter((call) => !call.startsWith('GET '))
}

/**
 * A project somebody already estimated. Sheet "Base" (sheet-1) prices two
 * elements with a count code: (1000 × 1.1) + (0.5 × 400) = 1300 each, one with
 * an extra 50, so direct = 2650 and, with 15 % + 5 % markups, total = 3180.
 * Sheet "Option B" (sheet-2, EUR, no markups) prices WALL by length
 * (4 m × 100 = 400) and WINDOW by count (1300): 1700.
 */
async function seededData(): Promise<NonNullable<MockOptions['data']>> {
  const [wall, wall2, window] = await Promise.all([WALL, WALL_2, WINDOW].map(fixtureElement))
  const at = '2026-10-01T09:00:00.000Z'
  const base = { discipline: 'Architecture', descr: '', laborDays: 0, laborRate: 0, matAdd: 0, labAdd: 0 }
  return {
    [CODES]: {
      'code-unit': {
        ...base,
        code: '10-100',
        name: 'Unit item',
        grp: 'Openings',
        unit: 'ea',
        basis: 'count',
        price: 1000,
        laborDays: 0.5,
        laborRate: 400,
        matAdd: 0.1,
      },
      'code-wall': { ...base, code: '20-200', name: 'Brick wall', grp: 'Walls', unit: '', basis: 'length', price: 100 },
    },
    [PACKAGES]: { 'wp-shell': { en: 'Shell', ja: '躯体', sort: 1 } },
    [SHEETS]: {
      'sheet-1': {
        name: 'Base',
        sort: 1,
        currency: 'USD',
        markups: [
          { id: 'misc', name: 'Miscellaneous', pct: 15 },
          { id: 'risk', name: 'Risk', pct: 5 },
        ],
      },
      'sheet-2': { name: 'Option B', sort: 2, currency: 'EUR', markups: [] },
    },
    [SHEET_1]: {
      [window.key]: { code: 'code-unit', wp: 'wp-shell', elementId: window.elementId, at },
      [wall2.key]: { code: 'code-unit', extra: 50, elementId: wall2.elementId, at },
    },
    [SHEET_2]: {
      [wall.key]: { code: 'code-wall', wp: 'wp-shell', elementId: wall.elementId, at },
      [window.key]: { code: 'code-unit', elementId: window.elementId, at },
    },
  }
}

// ---- the tests ---------------------------------------------------------------------------------

test.describe('estimate', () => {
  test('a project with no estimate shows "Estimate 1" and browsing writes nothing', async ({ page }) => {
    const mock = await openEstimate(page)

    await expect(page.getByTestId('estimate-panel')).toBeVisible()
    await expect(page.getByTestId('sheet-select')).toHaveText('Estimate 1')
    await expect(page.getByTestId('sheet-select')).toHaveAttribute('data-value', 'sheet-1')
    await expect(page.getByTestId('markup-row')).toHaveCount(3)
    await expect(page.getByTestId('total-value')).toHaveText('$ 0')
    await expect(page.getByTestId('coded-count')).toHaveText(`0 of ${ELEMENT_COUNT} elements have a cost code`)
    const first = await estimate(page)
    expect(first?.sheets).toEqual([
      expect.objectContaining({ id: 'sheet-1', name: 'Estimate 1', currency: 'USD', virtual: true }),
    ])
    expect(first?.assignments).toEqual({})

    // Look around the way a reader does: search, select, open groups, change the view.
    await search(page, 'Walls')
    await expect(elementRow(page, WALL)).toBeVisible()
    await clickElement(page, WALL)
    await clickElement(page, WALL_2, ['ControlOrMeta'])
    await expect.poll(() => selection(page)).toEqual([WALL, WALL_2])
    await page.getByTestId('cost-details-open').click()
    await expect(page.getByTestId('cost-details')).toBeVisible()
    await page.getByTestId('details-next').click()
    await pick(page, page.getByTestId('display-select'), 'cost')
    await page.getByTestId('show-filter').locator('[data-value="included"]').click()
    await page.getByTestId('tree-collapse').click()
    await page.getByTestId('tree-expand').click()
    await page.getByTestId('tab-costcodes').click()
    await expect(page.getByTestId('costcode-tree')).toBeVisible()
    await page.getByTestId('tab-elements').click()

    expect(mock.writes).toEqual([])
    expect(writeCalls(mock)).toEqual([])
  })

  test('Set Cost Code creates the code, stores the sheet and the assignment, and survives a reload', async ({
    page,
  }) => {
    const mock = await openEstimate(page)
    const wall = await fixtureElement(WALL)

    await selectElement(page, WALL)
    await rowMenu(page, WALL, 'set-code')
    const dialog = page.getByTestId('dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('[data-testid="code-option"][data-id="+new"]').click()
    await page.getByTestId('new-code').fill('20-200')
    await page.getByTestId('new-name').fill('Brick wall')
    await pick(page, page.getByTestId('new-basis'), 'length')
    await page.getByTestId('new-price').fill('100')
    await page.getByTestId('dialog-confirm').click()
    await expect(dialog).toBeHidden()

    // 4 m × 100, no markups yet.
    await expect(page.getByTestId('total-value')).toHaveText('$ 400')
    await expect(page.getByTestId('direct-cost')).toHaveText('Direct cost $ 400')
    await expect(page.getByTestId('coded-count')).toHaveText(`1 of ${ELEMENT_COUNT} elements have a cost code`)

    await expect.poll(() => writesTo(mock, SHEET_1).length).toBe(1)

    // The code is a client-made id, stored as one entry.
    const codeWrites = writesTo(mock, CODES)
    expect(codeWrites).toHaveLength(1)
    const codeWrite = codeWrites[0] as Extract<RecordedWrite, { kind: 'put' }>
    expect(codeWrite.kind).toBe('put')
    expect(codeWrite.key).toMatch(/^code-/)
    expect(codeWrite.value).toMatchObject({ code: '20-200', name: 'Brick wall', basis: 'length', price: 100 })

    // The virtual sheet is created on the first write, create-only, with the fixed id.
    const sheetWrites = writesTo(mock, SHEETS)
    expect(sheetWrites).toHaveLength(1)
    expect(sheetWrites[0]).toMatchObject({ kind: 'put', key: 'sheet-1', ifNoneMatch: '*' })
    expect(mock.entry(SHEETS, 'sheet-1')).toMatchObject({
      name: 'Estimate 1',
      currency: 'USD',
      markups: [{ pct: 0 }, { pct: 0 }, { pct: 0 }],
    })

    // The assignment is keyed by the element's UniqueId.
    expect(wall.key).toBe('f1b6322e-a0a5-48fa-a0b3-23b89552c8a3-000595db')
    expect(writesTo(mock, SHEET_1)[0]).toEqual({
      kind: 'put-batch',
      namespace: SHEET_1,
      entries: [
        {
          key: wall.key,
          value: { code: codeWrite.key, elementId: '366043', by: 'ada@example.com', at: expect.any(String) },
        },
      ],
    })

    // The server sees the code first, then the sheet, then what refers to both.
    const codeAt = writeIndex(mock, (write) => write.namespace === CODES)
    const sheetAt = writeIndex(mock, (write) => write.namespace === SHEETS)
    const assignmentAt = writeIndex(mock, (write) => write.namespace === SHEET_1)
    expect(codeAt).toBeLessThan(sheetAt)
    expect(sheetAt).toBeLessThan(assignmentAt)
    expect((await estimate(page))?.sheets[0].virtual).toBeUndefined()

    const writes = mock.writes.length
    await page.reload()
    await waitForEstimate(page)

    // No user action: the estimate came back from the store.
    await expect(page.getByTestId('total-value')).toHaveText('$ 400')
    const reloaded = await estimate(page)
    expect(reloaded?.assignments[wall.key]).toMatchObject({ code: codeWrite.key, elementId: '366043' })
    expect(reloaded?.sheets).toEqual([expect.objectContaining({ id: 'sheet-1', name: 'Estimate 1' })])
    expect(mock.writes).toHaveLength(writes)
  })

  test('seeded codes, work packages, sheets and markups load from the store', async ({ page }) => {
    const mock = await openEstimate(page, { data: await seededData() })
    const window = await fixtureElement(WINDOW)

    await expect(page.getByTestId('sheet-select')).toHaveText('Base')
    await expect(page.getByTestId('markup-row')).toHaveCount(2)
    await expect(page.getByTestId('direct-cost')).toHaveText('Direct cost $ 2,650')
    await expect(page.getByTestId('total-value')).toHaveText('$ 3,180')
    await expect(page.getByTestId('coded-count')).toHaveText(`2 of ${ELEMENT_COUNT} elements have a cost code`)
    const loaded = await estimate(page)
    expect(loaded?.totals).toMatchObject({ direct: 2650, markupPct: 20, ncode: 2, nwp: 1 })
    expect(loaded?.totals.total).toBeCloseTo(3180, 6)
    expect(loaded?.sheets.map((sheet) => sheet.name)).toEqual(['Base', 'Option B'])
    expect(loaded?.assignments[window.key]).toMatchObject({ code: 'code-unit', wp: 'wp-shell' })

    // The default grouping starts with the work package: its name is on a group row.
    await expect(page.getByTestId('tree-row').filter({ hasText: 'Shell' }).first()).toBeVisible()

    // Another sheet: its own assignments, currency and markups.
    await pick(page, page.getByTestId('sheet-select'), 'sheet-2')
    await expect(page.getByTestId('total-value')).toHaveText('€ 1,700')
    await expect(page.getByTestId('markup-row')).toHaveCount(0)
    expect((await estimate(page))?.sheetId).toBe('sheet-2')

    expect(mock.writes).toEqual([])
  })

  test('Exclude hides the element and is stored; Include removes what says nothing else', async ({ page }) => {
    const mock = await openEstimate(page, { data: await seededData() })
    const [wall, wall2] = await Promise.all([fixtureElement(WALL), fixtureElement(WALL_2)])

    await selectElement(page, WALL)
    await rowMenu(page, WALL, 'exclude')

    await expect.poll(() => page.evaluate((i) => window.__vimSatellite?.isElementHidden(i), WALL)).toBe(true)
    await expect(elementRow(page, WALL).getByTestId('row-check')).toHaveAttribute('aria-checked', 'false')
    await expect.poll(() => mock.entry(SHEET_1, wall.key)).toMatchObject({ hidden: true, elementId: '366043' })
    // Excluded elements still count in the total.
    await expect(page.getByTestId('total-value')).toHaveText('$ 3,180')

    // The row checkbox includes it again; the entry then says nothing and is deleted.
    await elementRow(page, WALL).getByTestId('row-check').click()
    await expect.poll(() => page.evaluate((i) => window.__vimSatellite?.isElementHidden(i), WALL)).toBe(false)
    await expect
      .poll(() => mock.writes.some((write) => write.kind === 'delete' && write.namespace === SHEET_1 && write.keys.includes(wall.key)))
      .toBe(true)
    expect(mock.entry(SHEET_1, wall.key)).toBeUndefined()
    expect((await estimate(page))?.assignments[wall.key]).toBeUndefined()

    // An element with a cost code keeps its entry, without `hidden`.
    await selectElement(page, WALL_2)
    await rowMenu(page, WALL_2, 'exclude')
    await expect.poll(() => mock.entry(SHEET_1, wall2.key)).toMatchObject({ hidden: true, code: 'code-unit' })
    expect((await estimate(page))?.hidden).toEqual([WALL_2])
    await rowMenu(page, WALL_2, 'include')
    await expect.poll(() => (mock.entry(SHEET_1, wall2.key) as { hidden?: boolean }).hidden).toBeUndefined()
    expect(mock.entry(SHEET_1, wall2.key)).toMatchObject({ code: 'code-unit', extra: 50 })
    expect((await estimate(page))?.hidden).toEqual([])
  })

  test('Display "Costs" colours coded elements and leaves the others white', async ({ page }) => {
    await openEstimate(page, { data: await seededData() })
    const color = (index: number) => page.evaluate((i) => window.__vimSatellite?.getElementColor(i), index)

    expect(await color(WINDOW)).toBeUndefined()
    await pick(page, page.getByTestId('display-select'), 'cost')
    await expect(page.getByTestId('cost-legend')).toBeVisible()

    await expect.poll(() => color(WALL)).toBe('#ffffff')
    const cheaper = await color(WINDOW)
    const dearer = await color(WALL_2)
    expect(cheaper).toMatch(/^#[0-9a-f]{6}$/)
    expect(dearer).toMatch(/^#[0-9a-f]{6}$/)
    expect(cheaper).not.toBe('#ffffff')
    expect(dearer).not.toBe('#ffffff')
    // Ranked: the cheapest coded element is the green end, the dearest the red end.
    expect(cheaper).not.toBe(dearer)

    await pick(page, page.getByTestId('display-select'), 'none')
    await expect.poll(() => color(WINDOW)).toBeUndefined()
    await expect(page.getByTestId('cost-legend')).toHaveCount(0)
  })

  test('New sheet, Duplicate and Delete sheet', async ({ page }) => {
    const mock = await openEstimate(page, { data: await seededData() })
    const sheetSelect = page.getByTestId('sheet-select')
    const seededKeys = storedKeys(mock, SHEET_1)

    // Duplicate: assignments, markups and currency are copied.
    await pick(page, sheetSelect, '+dup')
    await expect(page.getByTestId('dialog-input')).toHaveValue('Base (2)')
    await page.getByTestId('dialog-confirm').click()
    await expect(sheetSelect).toHaveText('Base (2)')
    const copyId = (await estimate(page))?.sheetId ?? ''
    expect(copyId).toMatch(/^sheet-/)
    expect(copyId).not.toBe('sheet-1')
    await expect.poll(() => storedKeys(mock, `estimate.sheet.${copyId}`)).toEqual(seededKeys)
    expect(mock.entry(SHEETS, copyId)).toMatchObject({
      name: 'Base (2)',
      currency: 'USD',
      markups: [
        { id: 'misc', pct: 15 },
        { id: 'risk', pct: 5 },
      ],
    })
    await expect(page.getByTestId('total-value')).toHaveText('$ 3,180')

    // New sheet: empty, default markups.
    await pick(page, sheetSelect, '+new')
    await page.getByTestId('dialog-input').fill('Empty')
    await page.getByTestId('dialog-confirm').click()
    await expect(sheetSelect).toHaveText('Empty')
    const newId = (await estimate(page))?.sheetId ?? ''
    expect(newId).not.toBe(copyId)
    await expect.poll(() => mock.entry(SHEETS, newId)).toMatchObject({ name: 'Empty', markups: [{ pct: 0 }, { pct: 0 }, { pct: 0 }] })
    await expect(page.getByTestId('total-value')).toHaveText('$ 0')
    expect((await estimate(page))?.assignments).toEqual({})
    expect((await estimate(page))?.sheets).toHaveLength(4)

    // Delete the empty sheet: its namespace first, then its entry.
    await pick(page, sheetSelect, '+del')
    await page.getByTestId('dialog-confirm').click()
    await expect.poll(() => mock.entry(SHEETS, newId)).toBeUndefined()
    const namespaceGone = writeIndex(
      mock,
      (write) => write.kind === 'delete' && write.namespace === `estimate.sheet.${newId}` && write.keys[0] === '*',
    )
    const entryGone = writeIndex(
      mock,
      (write) => write.kind === 'delete' && write.namespace === SHEETS && write.keys.includes(newId),
    )
    expect(namespaceGone).toBeGreaterThanOrEqual(0)
    expect(namespaceGone).toBeLessThan(entryGone)
    expect((await estimate(page))?.sheets).toHaveLength(3)

    // Delete the copy: its assignments go with it, the original's stay.
    await pick(page, sheetSelect, copyId)
    await expect(sheetSelect).toHaveText('Base (2)')
    await waitForSheet(page)
    await pick(page, sheetSelect, '+del')
    await page.getByTestId('dialog-confirm').click()
    await expect.poll(() => mock.entry(SHEETS, copyId)).toBeUndefined()
    expect(mock.store.has(`estimate.sheet.${copyId}`)).toBe(false)
    expect(storedKeys(mock, SHEET_1)).toEqual(seededKeys)
    expect(storedKeys(mock, SHEETS)).toEqual(['sheet-1', 'sheet-2'])
  })

  test('the last sheet cannot be deleted', async ({ page }) => {
    const mock = await openEstimate(page)

    await pick(page, page.getByTestId('sheet-select'), '+del')

    await expect(page.getByTestId('toast').filter({ hasText: 'The last sheet cannot be deleted.' })).toBeVisible()
    await expect(page.getByTestId('dialog')).toHaveCount(0)
    expect(mock.writes).toEqual([])
  })

  test('deleting a cost code clears it from the assignments of every sheet', async ({ page }) => {
    const mock = await openEstimate(page, { data: await seededData() })
    const [wall, wall2, window] = await Promise.all([WALL, WALL_2, WINDOW].map(fixtureElement))

    await page.getByTestId('tab-costcodes').click()
    const row = page.locator('[data-testid="costcode-row"][data-id="code-unit"]')
    await row.locator('.ds-tree__label').click({ button: 'right' })
    await menuItem(page, 'delete-code').click()
    await page.getByTestId('dialog-confirm').click()

    await expect.poll(() => mock.entry(CODES, 'code-unit')).toBeUndefined()
    await expect(row).toHaveCount(0)

    // Sheet 1: what else the entries said stays; sheet 2: an entry with only the code goes.
    expect(mock.entry(SHEET_1, window.key)).toEqual(expect.objectContaining({ wp: 'wp-shell' }))
    expect(mock.entry(SHEET_1, window.key)).not.toHaveProperty('code')
    expect(mock.entry(SHEET_1, wall2.key)).toEqual(expect.objectContaining({ extra: 50 }))
    expect(mock.entry(SHEET_1, wall2.key)).not.toHaveProperty('code')
    expect(mock.entry(SHEET_2, window.key)).toBeUndefined()
    expect(mock.entry(SHEET_2, wall.key)).toMatchObject({ code: 'code-wall' })

    // The clean-up runs before the code itself goes.
    const codeGone = writeIndex(mock, (write) => write.namespace === CODES)
    const lastAssignment = mock.writes.reduce(
      (last, write, i) => (write.namespace === SHEET_1 || write.namespace === SHEET_2 ? i : last),
      -1,
    )
    expect(lastAssignment).toBeGreaterThanOrEqual(0)
    expect(lastAssignment).toBeLessThan(codeGone)

    // Only the extra is left: 50 × 1.2.
    await expect(page.getByTestId('total-value')).toHaveText('$ 60')
    await expect(page.getByTestId('coded-count')).toHaveText(`0 of ${ELEMENT_COUNT} elements have a cost code`)
  })

  test('editing a unit price in the Cost Codes tab reprices the sheet', async ({ page }) => {
    const mock = await openEstimate(page, { data: await seededData() })

    await page.getByTestId('tab-costcodes').click()
    const price = page.locator('[data-testid="costcode-row"][data-id="code-unit"]').getByTestId('code-price')
    await price.fill('2000')
    await price.press('Enter')

    await expect.poll(() => mock.entry(CODES, 'code-unit')).toMatchObject({ price: 2000, code: '10-100' })
    // (2000 × 1.1 + 200) × 2 + 50 = 4850; × 1.2 = 5820.
    await expect(page.getByTestId('direct-cost')).toHaveText('Direct cost $ 4,850')
    await expect(page.getByTestId('total-value')).toHaveText('$ 5,820')
  })

  test('a markup change is a read-modify-write that survives a concurrent edit', async ({ page }) => {
    let interfered = false
    const mock = await openEstimate(page, {
      data: await seededData(),
      beforeEntryWrite: ({ namespace, key }, store) => {
        if (interfered || namespace !== SHEETS || key !== 'sheet-1') return
        interfered = true
        // Another user renames the sheet between this page's read and its write,
        // so the ETag it holds is stale and its PUT gets a 412.
        const entry = store.get(namespace)?.get(key)
        if (entry) store.get(namespace)?.set(key, { value: { ...(entry.value as object), name: 'Renamed' }, version: entry.version + 1 })
      },
    })

    const pct = page.getByTestId('markup-pct').first()
    await pct.fill('5')
    await pct.press('Enter')

    await expect(page.getByTestId('total-value')).toHaveText('$ 2,915')
    await expect.poll(() => writesTo(mock, SHEETS).length).toBe(2)
    const [stale, fresh] = writesTo(mock, SHEETS) as Extract<RecordedWrite, { kind: 'put' }>[]
    expect(stale.ifMatch).toBe('"1"')
    expect(fresh.ifMatch).toBe('"2"')
    // The retry applied the change to the other user's version instead of overwriting it.
    expect(mock.entry(SHEETS, 'sheet-1')).toMatchObject({
      name: 'Renamed',
      markups: [
        { id: 'misc', pct: 5 },
        { id: 'risk', pct: 5 },
      ],
    })
    // And the page adopts the merged sheet, rename included.
    await expect(page.getByTestId('sheet-select')).toHaveText('Renamed')
  })

  test('two users editing the markups at once both keep their change', async ({ page }) => {
    // The other user: a change to the stored markups between this page's read of the sheet and
    // its write, so the page's If-Match is stale and its write is retried over theirs.
    let other: ((markups: StoredMarkup[]) => StoredMarkup[]) | null = null
    const mock = await openEstimate(page, {
      data: await seededData(),
      beforeEntryWrite: ({ namespace, key }, store) => {
        const change = other
        if (!change || namespace !== SHEETS || key !== 'sheet-1') return
        other = null
        const entry = store.get(namespace)?.get(key)
        if (!entry) return
        const value = entry.value as { markups: StoredMarkup[] }
        store.get(namespace)?.set(key, { value: { ...value, markups: change(value.markups) }, version: entry.version + 1 })
      },
    })
    const stored = () => (mock.entry(SHEETS, 'sheet-1') as { markups: StoredMarkup[] }).markups

    // They add "Insurance 2 %" while this page raises Risk to 7 %.
    other = (markups) => [...markups, { id: 'insurance', name: 'Insurance', pct: 2 }]
    const risk = page.locator('[data-testid="markup-row"][data-id="risk"]').getByTestId('markup-pct')
    await risk.fill('7')
    await risk.press('Enter')
    await expect.poll(stored).toEqual([
      { id: 'misc', name: 'Miscellaneous', pct: 15 },
      { id: 'risk', name: 'Risk', pct: 7 },
      { id: 'insurance', name: 'Insurance', pct: 2 },
    ])
    // The page shows the merged list.
    await expect(page.getByTestId('markup-row')).toHaveCount(3)

    // They lower Miscellaneous to 10 % while this page adds a markup.
    other = (markups) => markups.map((markup) => (markup.id === 'misc' ? { ...markup, pct: 10 } : markup))
    await page.getByTestId('markup-add').click()
    await expect.poll(() => stored().length).toBe(4)
    expect(stored()).toEqual([
      { id: 'misc', name: 'Miscellaneous', pct: 10 },
      { id: 'risk', name: 'Risk', pct: 7 },
      { id: 'insurance', name: 'Insurance', pct: 2 },
      { id: expect.stringMatching(/^markup-/), name: 'New markup', pct: 0 },
    ])
    await expect(page.getByTestId('markup-row')).toHaveCount(4)
    await expect.poll(async () => (await estimate(page))?.totals.markupPct).toBe(19)
  })

  test('the Viewer role cannot edit', async ({ page }) => {
    const orgs = defaultOrgs()
    orgs[0].projects[0].role = 'Viewer'
    const mock = await openEstimate(page, { orgs, data: await seededData() })

    await expect(page.getByTestId('role-badge')).toHaveText('Viewer')
    await expect(page.getByTestId('estimate-readonly')).toBeVisible()

    await selectElement(page, WALL_2)
    const row = elementRow(page, WALL_2)
    await expect(row.getByTestId('row-check')).toBeDisabled()
    await expect(row.getByTestId('row-wp')).toBeDisabled()
    await expect(row.getByTestId('row-code')).toBeDisabled()
    await expect(row.getByTestId('row-extra')).toBeDisabled()
    await expect(row.getByTestId('row-note')).toBeDisabled()
    await expect(page.getByTestId('tree-check-all')).toBeDisabled()
    await expect(page.getByTestId('currency-select')).toBeDisabled()
    await expect(page.getByTestId('markup-pct').first()).toBeDisabled()
    await expect(page.getByTestId('markup-add')).toBeDisabled()

    // The menu still lists the write verbs, disabled; Copy is a read and stays on.
    await elementRow(page, WALL_2).locator('.ds-tree__label').click({ button: 'right' })
    for (const action of ['set-code', 'paste-code', 'set-wp', 'include', 'exclude', 'clear']) {
      await expect(menuItem(page, action)).toHaveAttribute('aria-disabled', 'true')
    }
    await expect(menuItem(page, 'copy-code')).not.toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('context-menu')).toHaveCount(0)

    // The keyboard is read-only too.
    await page.keyboard.press('ControlOrMeta+c')
    await page.keyboard.press('ControlOrMeta+v')
    await expect(page.getByTestId('toast').filter({ hasText: 'Read only' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+x')
    expect((await estimate(page))?.hidden).toEqual([])

    // The sheet verbs are listed, disabled.
    await page.getByTestId('sheet-select').click()
    for (const verb of ['+new', '+dup', '+ren', '+del']) {
      await expect(page.locator(`[data-testid="select-option"][data-value="${verb}"]`)).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    }
    await page.keyboard.press('Escape')

    await page.getByTestId('tab-costcodes').click()
    await expect(page.getByTestId('costcode-add')).toBeDisabled()
    await expect(
      page.locator('[data-testid="costcode-row"][data-id="code-unit"]').getByTestId('code-price'),
    ).toBeDisabled()

    expect(mock.writes).toEqual([])
    expect(writeCalls(mock)).toEqual([])
  })

  test('a role the app does not know reads only', async ({ page }) => {
    const orgs = defaultOrgs()
    orgs[0].projects[0].role = 'Contributor'
    const mock = await openEstimate(page, { orgs, data: await seededData() })

    await expect(page.getByTestId('estimate-readonly')).toHaveText('Read only: your project role is Contributor.')
    await expect(page.getByTestId('markup-add')).toBeDisabled()
    await selectElement(page, WALL_2)
    await expect(elementRow(page, WALL_2).getByTestId('row-code')).toBeDisabled()
    await page.keyboard.press('ControlOrMeta+c')
    await page.keyboard.press('ControlOrMeta+v')
    await expect(page.getByTestId('toast').filter({ hasText: 'Read only' })).toBeVisible()
    expect(writeCalls(mock)).toEqual([])
  })

  test('a sheet whose assignments cannot be read takes no edit until Retry reads it', async ({ page }) => {
    let failSheet2 = true
    const mock = await openEstimate(page, {
      data: await seededData(),
      failRead: ({ namespace }) => (failSheet2 && namespace === SHEET_2 ? 500 : undefined),
    })
    const wall = await fixtureElement(WALL)

    // Copy a cost code on the first sheet, and select the element to paste it on.
    await selectElement(page, WALL_2)
    await page.keyboard.press('ControlOrMeta+c')
    await expect(page.getByTestId('toast').filter({ hasText: 'Cost code 10-100 copied.' })).toBeVisible()
    await selectElement(page, WALL)

    // The other sheet cannot be read: it says so, and nothing can be written.
    await pick(page, page.getByTestId('sheet-select'), 'sheet-2')
    await expect(page.getByTestId('sheet-error')).toBeVisible()
    expect(await estimate(page)).toMatchObject({ sheetId: 'sheet-2', sheetStatus: 'error', canEdit: false, assignments: {} })
    await expect(page.getByTestId('estimate-tree')).toContainText('Could not load this sheet.')
    await expect(page.getByTestId('markup-add')).toBeDisabled()
    await expect(page.getByTestId('currency-select')).toBeDisabled()
    await page.keyboard.press('ControlOrMeta+v')
    await expect(page.getByTestId('toast').filter({ hasText: 'The sheet is not ready yet.' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+x')
    expect(mock.writes).toEqual([])

    // Retry reads it; the paste then lands in that sheet, and only there.
    failSheet2 = false
    await page.getByTestId('sheet-retry').click()
    await waitForSheet(page)
    await expect(page.getByTestId('total-value')).toHaveText('€ 1,700')
    await page.keyboard.press('ControlOrMeta+v')
    await expect(page.getByTestId('toast').filter({ hasText: 'Cost code 10-100 pasted on 1 elements.' })).toBeVisible()
    await expect.poll(() => mock.entry(SHEET_2, wall.key)).toMatchObject({ code: 'code-unit', wp: 'wp-shell' })
    expect(mock.writes.map((write) => write.namespace)).toEqual([SHEET_2])
  })

  test('an edit made while the estimate is re-read after a failure keeps its other fields', async ({ page }) => {
    let failNext = false
    let holdNext = false
    let held = false
    let release = (): void => undefined
    const mock = await openEstimate(page, {
      data: await seededData(),
      failWrite: (write) => {
        if (!failNext || write.kind !== 'put-batch' || write.namespace !== SHEET_1) return undefined
        failNext = false
        return 500
      },
      // The re-read's list of the sheet is held, with the entries of when it was asked for.
      holdRead: ({ namespace, key }) => {
        if (!holdNext || namespace !== SHEET_1 || key !== undefined) return undefined
        holdNext = false
        held = true
        return new Promise<void>((resolve) => {
          release = resolve
        })
      },
    })
    const wall2 = await fixtureElement(WALL_2)
    const loadsBefore = (await estimate(page))?.loads ?? 0

    // A write the server refuses: taken back, then the estimate is re-read, and that read is held.
    await selectElement(page, WALL)
    failNext = true
    holdNext = true
    await rowMenu(page, WALL, 'exclude')
    await expect(page.getByTestId('toast').filter({ hasText: 'Could not save the change' })).toBeVisible()
    await expect.poll(() => held).toBe(true)

    // Meanwhile another element gets a note, which is stored.
    await selectElement(page, WALL_2)
    const note = elementRow(page, WALL_2).getByTestId('row-note')
    await note.fill('checked')
    await note.press('Enter')
    await expect.poll(() => mock.entry(SHEET_1, wall2.key)).toMatchObject({ code: 'code-unit', extra: 50, note: 'checked' })

    // The held read arrives older than the screen: what the page takes in still has the note.
    release()
    await expect.poll(async () => (await estimate(page))?.loads).toBe(loadsBefore + 1)
    expect((await estimate(page))?.assignments[wall2.key]).toMatchObject({ note: 'checked' })

    // So the next edit of that element keeps the note on the server.
    const extra = elementRow(page, WALL_2).getByTestId('row-extra')
    await extra.fill('75')
    await extra.press('Enter')
    await expect.poll(() => mock.entry(SHEET_1, wall2.key)).toMatchObject({ extra: 75 })
    expect(mock.entry(SHEET_1, wall2.key)).toMatchObject({ code: 'code-unit', note: 'checked', extra: 75 })
  })

  test('a refused write shows a toast and the change is taken back', async ({ page }) => {
    const mock = await openEstimate(page, {
      data: await seededData(),
      failWrite: (write) => (write.kind === 'put-batch' && write.namespace === SHEET_1 ? 500 : undefined),
    })
    const wall = await fixtureElement(WALL)
    const reads = () => mock.calls.filter((call) => call === `GET /project/p-tiny/data/${SHEET_1}`).length
    const readsBefore = reads()

    await selectElement(page, WALL)
    await rowMenu(page, WALL, 'set-code')
    await page.locator('[data-testid="code-option"][data-id="code-wall"]').click()
    await page.getByTestId('dialog-confirm').click()

    const toast = page.getByTestId('toast').filter({ hasText: 'Could not save the change' })
    await expect(toast).toBeVisible()
    await expect(toast).toHaveAttribute('data-tone', 'bad')

    // Rolled back, then re-read from the server.
    await expect.poll(async () => (await estimate(page))?.assignments[wall.key]).toBeUndefined()
    await expect(page.getByTestId('total-value')).toHaveText('$ 3,180')
    await expect.poll(reads).toBeGreaterThan(readsBefore)
    expect(mock.entry(SHEET_1, wall.key)).toBeUndefined()
    expect(writesTo(mock, SHEET_1)).toEqual([])
  })

  test('Cost Details steps through the selection without changing it', async ({ page }) => {
    const mock = await openEstimate(page, { data: await seededData() })
    const wall = await fixtureElement(WALL)

    await search(page, 'Walls')
    await clickElement(page, WALL)
    await clickElement(page, WALL_2, ['ControlOrMeta'])
    await expect.poll(() => selection(page)).toEqual([WALL, WALL_2])

    await page.getByTestId('cost-details-open').click()
    const details = page.getByTestId('cost-details')
    await expect(details).toBeVisible()
    const pager = page.getByTestId('details-pager')
    await expect(pager).toHaveAttribute('data-value', 'summary')
    await expect(details).toContainText('2 elements selected')

    // Summary → 366043 → 366048 → Summary: ElementId order.
    await page.getByTestId('details-next').click()
    await expect(pager).toHaveAttribute('data-value', String(WALL))
    await expect(details).toContainText('Element ID 366043')
    await page.getByTestId('details-next').click()
    await expect(pager).toHaveAttribute('data-value', String(WALL_2))
    await page.getByTestId('details-next').click()
    await expect(pager).toHaveAttribute('data-value', 'summary')
    await page.getByTestId('details-prev').click()
    await expect(pager).toHaveAttribute('data-value', String(WALL_2))
    expect(await selection(page)).toEqual([WALL, WALL_2])

    // The fields edit the element shown, not the selection.
    await page.getByTestId('details-prev').click()
    await expect(pager).toHaveAttribute('data-value', String(WALL))
    const extra = page.getByTestId('details-extra')
    await extra.fill('25')
    await extra.press('Enter')
    await expect.poll(() => mock.entry(SHEET_1, wall.key)).toMatchObject({ extra: 25 })
    expect(await selection(page)).toEqual([WALL, WALL_2])

    await page.getByTestId('cost-details-close').click()
    await expect(details).toHaveCount(0)
    await expect(page.getByTestId('cost-details-open')).toBeVisible()
  })

  test('the 日本語 switch translates the panel and is remembered', async ({ page }) => {
    const mock = await openEstimate(page)

    await page.getByTestId('lang-switch').locator('[data-value="ja"]').click()
    await expect(page.getByTestId('tab-elements')).toHaveText('要素')
    await expect(page.getByTestId('tab-costcodes')).toHaveText('単価コード')
    await expect(page.getByTestId('sheet-select')).toHaveText('積算 1')
    await expect(page.getByTestId('footer')).toContainText('合計金額')
    await expect(page.getByTestId('direct-cost')).toContainText('直接工事費')

    await page.reload()
    await waitForEstimate(page)
    await expect(page.getByTestId('tab-elements')).toHaveText('要素')

    await page.getByTestId('lang-switch').locator('[data-value="en"]').click()
    await expect(page.getByTestId('tab-elements')).toHaveText('Elements')
    await expect(page.getByTestId('sheet-select')).toHaveText('Estimate 1')

    // The language is a view setting: it never reaches the store.
    expect(mock.writes).toEqual([])
  })

  test('Ctrl+C and Ctrl+V copy one element\'s cost code onto the selection', async ({ page }) => {
    const mock = await openEstimate(page, { data: await seededData() })
    const wall = await fixtureElement(WALL)

    await search(page, 'Walls')
    await clickElement(page, WALL)
    await page.keyboard.press('ControlOrMeta+c')
    await expect(page.getByTestId('toast').filter({ hasText: 'This element has no cost code.' })).toBeVisible()

    await clickElement(page, WALL_2)
    await expect.poll(() => selection(page)).toEqual([WALL_2])
    await page.keyboard.press('ControlOrMeta+c')
    await expect(page.getByTestId('toast').filter({ hasText: 'Cost code 10-100 copied.' })).toBeVisible()

    await clickElement(page, WALL)
    await expect.poll(() => selection(page)).toEqual([WALL])
    await page.keyboard.press('ControlOrMeta+v')
    await expect(page.getByTestId('toast').filter({ hasText: 'Cost code 10-100 pasted on 1 elements.' })).toBeVisible()

    await expect.poll(() => mock.entry(SHEET_1, wall.key)).toMatchObject({ code: 'code-unit', elementId: '366043' })
    // 2650 + 1300 = 3950; × 1.2 = 4740.
    await expect(page.getByTestId('total-value')).toHaveText('$ 4,740')
  })

  test('a right-click in the 3D view opens the element menu and keeps the selection', async ({ page }) => {
    await openEstimate(page)

    const box = await page.getByTestId('viewer-pane').boundingBox()
    expect(box).not.toBeNull()
    if (!box) return
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2

    await page.mouse.click(x, y)
    await expect
      .poll(async () => (await selection(page))?.length, { timeout: 15_000 })
      .toBeGreaterThan(0)
    const picked = await selection(page)

    // A little off the first click: vim-web reads a second click within 300 ms
    // and a few pixels of the first as a double-click.
    await page.mouse.click(x + 20, y + 20, { button: 'right' })
    await expect(page.getByTestId('context-menu')).toBeVisible()
    await expect(menuItem(page, 'set-code')).toBeVisible()
    await expect(menuItem(page, 'exclude')).not.toHaveAttribute('aria-disabled', 'true')
    expect(await selection(page)).toEqual(picked)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('context-menu')).toHaveCount(0)
  })
})
