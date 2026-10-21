/**
 * Element identity, end to end: an element is keyed in the data store by its
 * Revit UniqueId only (src/estimate/keys.ts). One with no UniqueId is still
 * listed and priced, as unassigned and included, but nothing can be stored for
 * it: its write controls are disabled, and bulk writes skip it.
 *
 * Every Tiny House element has a UniqueId, so the tests drop one in the app
 * through the dev-only test seam in quantities.ts
 * (`window.__vimSatelliteTestNoUniqueId`), set before the page loads. The
 * fixture file itself is not changed.
 *
 * The setup is a minimal copy of estimate.spec.ts's (which exports nothing).
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { installMockVimServer } from './support/mockVimServer'
import type { MockHandle, MockOptions } from './support/mockVimServer'
import { useFakeSession } from './support/auth'
import { fixtureElement, fixtureFacts } from './support/fixture'
import { NO_KEY_ONE } from '../src/estimate/i18n'

/** Parsing and building the whole snapshot under software GL is not quick. */
const LOAD_TIMEOUT = 60_000

/** The 25 fixture elements with geometry, minus the saved 3D view (see estimate-quantities.spec.ts). */
const ELEMENT_COUNT = 24

/** The element whose UniqueId the app drops: Basic Wall, ElementId 366043. */
const BARE = 51
const BARE_ID = '366043'
/** Another wall, which keeps its UniqueId: Basic Wall, ElementId 366048. */
const WALL_2 = 64

const CODES = 'estimate.costCodes'
const SHEETS = 'estimate.sheets'
const SHEET_1 = 'estimate.sheet.sheet-1'

// ---- the app (as estimate.spec.ts) -------------------------------------------------------------

/** Opens the Tiny House project with BARE's UniqueId dropped, once the estimate covers every element. */
async function openEstimate(page: Page, options: MockOptions = {}): Promise<MockHandle> {
  await page.addInitScript((ids) => {
    window.__vimSatelliteTestNoUniqueId = ids
  }, [BARE_ID])
  const mock = await installMockVimServer(page, options)
  await useFakeSession(page)
  await page.goto('/?project=p-tiny')
  await expect(page.getByTestId('viewer-status')).toHaveAttribute('data-state', 'loaded', {
    timeout: LOAD_TIMEOUT,
  })
  await expect
    .poll(() => page.evaluate(() => window.__vimSatellite?.getEstimate()?.totals.nall), {
      timeout: LOAD_TIMEOUT,
    })
    .toBe(ELEMENT_COUNT)
  await expect.poll(async () => (await estimate(page))?.canEdit).toBe(true)
  return mock
}

function estimate(page: Page) {
  return page.evaluate(() => window.__vimSatellite?.getEstimate() ?? null)
}

function selection(page: Page): Promise<number[] | undefined> {
  return page.evaluate(() => window.__vimSatellite?.getSelection())
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

async function clickElement(page: Page, index: number, modifiers?: 'ControlOrMeta'[]): Promise<void> {
  await elementRow(page, index).locator('.ds-tree__label').click({ modifiers })
}

function menuItem(page: Page, action: string): Locator {
  return page.getByTestId('context-menu').locator(`[data-testid="menu-item"][data-action="${action}"]`)
}

function toast(page: Page, text: string): Locator {
  return page.getByTestId('toast').filter({ hasText: text })
}

/**
 * One count code (price 1000) on WALL_2 in sheet-1, no markups: direct 1000.
 * The sheet also holds what the old key fallbacks would have stored for BARE
 * (`id-<ElementId>`, `index-<row>`): the app must read neither.
 */
async function seededData(): Promise<NonNullable<MockOptions['data']>> {
  const wall2 = await fixtureElement(WALL_2)
  const at = '2026-10-01T09:00:00.000Z'
  const unit = {
    code: '10-100',
    name: 'Unit item',
    descr: '',
    discipline: '',
    grp: '',
    unit: 'ea',
    basis: 'count',
    price: 1000,
    laborDays: 0,
    laborRate: 0,
    matAdd: 0,
    labAdd: 0,
  }
  const legacy = { code: 'code-unit', hidden: true, note: 'legacy key', elementId: BARE_ID, at }
  return {
    [CODES]: { 'code-unit': unit },
    [SHEETS]: { 'sheet-1': { name: 'Base', sort: 1, currency: 'USD', markups: [] } },
    [SHEET_1]: {
      [wall2.key]: { code: 'code-unit', elementId: wall2.elementId, at },
      [`id-${BARE_ID}`]: legacy,
      [`index-${BARE}`]: legacy,
    },
  }
}

// ---- the tests ---------------------------------------------------------------------------------

test.describe('element keys', () => {
  test('an element with no UniqueId is listed and priced, and every write control on it is disabled', async ({
    page,
  }) => {
    const mock = await openEstimate(page, { data: await seededData() })
    const writesBefore = mock.writes.length

    // Listed and priced as unassigned and included: the old `id-` / `index-` entries are not read.
    await search(page, BARE_ID)
    await clickElement(page, BARE)
    await expect.poll(() => selection(page)).toEqual([BARE])
    const row = elementRow(page, BARE)
    await expect(row).toBeVisible()
    await expect(row.getByTestId('row-check')).toHaveAttribute('aria-checked', 'true')
    await expect(row.getByTestId('row-code')).toHaveAttribute('data-value', '')
    await expect(page.getByTestId('total-value')).toHaveText('$ 1,000')
    const state = await estimate(page)
    expect(state?.hidden).toEqual([])
    expect(state?.totals.ncode).toBe(1)

    // Every write control is disabled and says why.
    await expect(row.getByTestId('row-check')).toBeDisabled()
    await expect(row.getByTestId('row-check')).toHaveAttribute('data-ds-tip', NO_KEY_ONE)
    for (const control of ['row-wp', 'row-code', 'row-extra', 'row-note']) {
      await expect(row.getByTestId(control)).toBeDisabled()
      await expect(row.locator(`[data-ds-tip="${NO_KEY_ONE}"]`).filter({ has: page.getByTestId(control) })).toHaveCount(1)
    }

    // Its group (Walls › …) still takes writes: its other walls have keys.
    await search(page, 'Walls')
    await expect(elementRow(page, WALL_2).getByTestId('row-code')).toBeEnabled()

    // The menu's write verbs are disabled, with the reason as their tip.
    await clickElement(page, BARE)
    await row.locator('.ds-tree__label').click({ button: 'right' })
    for (const action of ['set-code', 'paste-code', 'set-wp', 'include', 'exclude', 'clear']) {
      await expect(menuItem(page, action)).toHaveAttribute('aria-disabled', 'true')
      await expect(menuItem(page, action)).toHaveAttribute('data-ds-tip', NO_KEY_ONE)
    }
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('context-menu')).toHaveCount(0)

    // Cost Details: the fields are disabled too.
    await page.getByTestId('cost-details-open').click()
    for (const field of ['details-wp', 'details-code', 'details-extra', 'details-note']) {
      await expect(page.getByTestId(field)).toBeDisabled()
    }

    // The keyboard: Ctrl+X says why nothing happens.
    await page.keyboard.press('ControlOrMeta+x')
    await expect(toast(page, NO_KEY_ONE)).toBeVisible()
    expect((await estimate(page))?.hidden).toEqual([])

    // Nothing was written, under any key.
    expect(mock.writes.slice(writesBefore)).toEqual([])
  })

  test('a bulk exclude and a paste skip the element with no UniqueId and count only the written ones', async ({
    page,
  }) => {
    const mock = await openEstimate(page, { data: await seededData() })
    const facts = await fixtureFacts()
    const others = [...facts.values()].filter((entry) => entry.index !== BARE)
    expect(others).toHaveLength(ELEMENT_COUNT - 1)

    // Exclude everything with the header box: every element but BARE.
    await page.getByTestId('tree-check-all').click()
    await expect
      .poll(async () => (await estimate(page))?.hidden)
      .toEqual(others.map((entry) => entry.index).sort((a, b) => a - b))
    expect(await page.evaluate((i) => window.__vimSatellite?.isElementHidden(i), BARE)).toBe(false)
    // One included member left: the header box is partial, not off.
    await expect(page.getByTestId('tree-check-all')).toHaveAttribute('aria-checked', 'mixed')

    // The store holds the 23 keyed elements, by UniqueId, and nothing for BARE.
    const stored = (): string[] => [...(mock.store.get(SHEET_1)?.keys() ?? [])].sort()
    const expected = [...others.map((entry) => entry.key as string), `id-${BARE_ID}`, `index-${BARE}`].sort()
    await expect.poll(stored).toEqual(expected)
    const written = mock.writes.flatMap((write) =>
      write.kind === 'put-batch' ? write.entries : write.kind === 'put' ? [{ key: write.key, value: write.value }] : [],
    )
    expect(written.length).toBeGreaterThan(0)
    expect(written.some((entry) => (entry.value as { elementId?: string }).elementId === BARE_ID)).toBe(false)

    // Include them again, then paste a code on BARE and WALL_2: the toast counts WALL_2 alone.
    await page.getByTestId('tree-check-all').click()
    await expect.poll(async () => (await estimate(page))?.hidden).toEqual([])
    await search(page, 'Walls')
    await clickElement(page, WALL_2)
    await expect.poll(() => selection(page)).toEqual([WALL_2])
    await page.keyboard.press('ControlOrMeta+c')
    await expect(toast(page, 'Cost code 10-100 copied.')).toBeVisible()
    await clickElement(page, BARE, ['ControlOrMeta'])
    await expect.poll(() => selection(page)).toEqual([WALL_2, BARE])
    await page.keyboard.press('ControlOrMeta+v')
    await expect(toast(page, 'Cost code 10-100 pasted on 1 elements.')).toBeVisible()
    await expect(elementRow(page, BARE).getByTestId('row-code')).toHaveAttribute('data-value', '')

    // A menu on a selection with keys acts on those; on BARE alone, the verbs are off.
    await elementRow(page, BARE).locator('.ds-tree__label').click({ button: 'right' })
    await expect(menuItem(page, 'exclude')).not.toHaveAttribute('aria-disabled', 'true')
    await menuItem(page, 'exclude').click()
    await expect.poll(async () => (await estimate(page))?.hidden).toEqual([WALL_2])
    await clickElement(page, BARE)
    await expect.poll(() => selection(page)).toEqual([BARE])
    await page.keyboard.press('ControlOrMeta+v')
    await expect(toast(page, NO_KEY_ONE)).toBeVisible()
    expect((await estimate(page))?.assignments[`id-${BARE_ID}`]).toMatchObject({ note: 'legacy key' })
  })
})
