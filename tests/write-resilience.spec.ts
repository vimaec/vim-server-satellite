/**
 * The estimate's writes under a busy server, end to end against the mock.
 *
 * VIM Server answers a burst of concurrent batch requests with some 5xx and
 * some 302s to the sign-in page, which a browser reports as a CORS error (a
 * fetch TypeError, no status). So the page sends at most WRITE_CONCURRENCY
 * batch requests at a time, retries the idempotent ones, and does not retry a
 * conditional sheet write blindly. The mock fails requests with a status or
 * with 'network' (an aborted request: the same TypeError), and counts how many
 * data-store requests it is answering at once.
 *
 * The tests wait on what the app reports through `window.__vimSatellite` and
 * on the mock's store and call log, never on a timer.
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { ALL_DATA, installMockVimServer } from './support/mockVimServer'
import type { MockHandle, MockOptions, PendingWrite } from './support/mockVimServer'
import { useFakeSession } from './support/auth'
import { fixtureElement } from './support/fixture'

/** Must match src/estimate/store.ts (the test cannot import it: it reads Vite's env). */
const WRITE_CONCURRENCY = 2

/** Must match SHEET_ATTEMPTS in src/estimate/store.ts. */
const SHEET_ATTEMPTS = 3

/** Must match RETRY_DELAYS_MS in src/api/http.ts: one try and this many retries. */
const RETRIES = 3

/** Parsing and building the whole snapshot under software GL is not quick. */
const LOAD_TIMEOUT = 60_000

/** The fixture elements with geometry (see estimate.spec.ts). */
const ELEMENT_COUNT = 24

/** A Basic Wall of the fixture. */
const WALL = 51

const CODES = 'estimate.costCodes'
const PACKAGES = 'estimate.workPackages'
const SHEETS = 'estimate.sheets'
const SHEET_1 = 'estimate.sheet.sheet-1'
const SHEET_2 = 'estimate.sheet.sheet-2'

/** How long the mock takes over a held request: long enough for requests sent together to overlap. */
const SERVER_TIME_MS = 25

/** The message of a request that got no answer, after its retries. */
const NO_ANSWER = 'VIM Server did not answer: Network error or server overload. Try again.'

// ---- the app -----------------------------------------------------------------------------------

/** Opens the Tiny House project and waits until the estimate covers its elements. */
async function openEstimate(page: Page, options: MockOptions = {}): Promise<MockHandle> {
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
  return mock
}

function estimate(page: Page) {
  return page.evaluate(() => window.__vimSatellite?.getEstimate() ?? null)
}

function isHidden(page: Page, index: number): Promise<boolean | undefined> {
  return page.evaluate((i) => window.__vimSatellite?.isElementHidden(i), index)
}

function elementRow(page: Page, index: number): Locator {
  return page.locator(`[data-testid="tree-row"][data-key="el-${index}"]`)
}

function menuItem(page: Page, action: string): Locator {
  return page.getByTestId('context-menu').locator(`[data-testid="menu-item"][data-action="${action}"]`)
}

/** Lists one element (a search on its ElementId), selects it alone and excludes it. */
async function excludeElement(page: Page, index: number): Promise<void> {
  const box = page.getByTestId('element-search')
  await box.fill((await fixtureElement(index)).elementId)
  await box.press('Enter')
  const label = elementRow(page, index).locator('.ds-tree__label')
  await label.click()
  await expect.poll(() => page.evaluate(() => window.__vimSatellite?.getSelection())).toEqual([index])
  await label.click({ button: 'right' })
  await menuItem(page, 'exclude').click()
}

function failureToast(page: Page): Locator {
  return page.getByTestId('toast').filter({ hasText: 'Could not save the change' })
}

// ---- the store ---------------------------------------------------------------------------------

/** A server that takes SERVER_TIME_MS over a request. A timer in the mock, not a wait in the test. */
function serverTime(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SERVER_TIME_MS))
}

/** The calls to one data-store entry, as "GET" / "PUT", in order. */
function entryCalls(mock: MockHandle, namespace: string, key: string): string[] {
  const suffix = ` /project/p-tiny/data/${namespace}/${key}`
  return mock.calls.filter((call) => call.endsWith(suffix)).map((call) => call.split(' ')[0])
}

function batchPutsTo(mock: MockHandle, namespace: string): number {
  return mock.writes.filter((write) => write.kind === 'put-batch' && write.namespace === namespace).length
}

function batchDeletesTo(mock: MockHandle, namespace: string): number {
  return mock.writes.filter((write) => write.kind === 'delete' && write.namespace === namespace).length
}

const isBatchPut = (write: PendingWrite, namespace: string): boolean =>
  write.kind === 'put-batch' && write.namespace === namespace

/** A small estimate: one code, one work package, sheet "Base" with 15 % + 5 % markups, no assignments. */
function smallData(): NonNullable<MockOptions['data']> {
  return {
    [CODES]: { 'code-unit': { code: '10-100', name: 'Unit item', unit: 'ea', basis: 'count', price: 1000 } },
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
    },
  }
}

/**
 * A big estimate, as on the real "MEP Estimate Sheet": code-bulk is on 6,000
 * entries of sheet 1 (4,500 that also have a work package, 1,500 with only the
 * code) and 2,500 of sheet 2 (only the code). The keys are not elements of the
 * fixture, which the store does not mind.
 */
function bulkData(): NonNullable<MockOptions['data']> {
  const at = '2026-10-01T09:00:00.000Z'
  const sheet1: Record<string, unknown> = {}
  const sheet2: Record<string, unknown> = {}
  for (let i = 0; i < 4500; i++) {
    sheet1[`bulk-wp-${i}`] = { code: 'code-bulk', wp: 'wp-shell', elementId: String(900_000 + i), at }
  }
  for (let i = 0; i < 1500; i++) {
    sheet1[`bulk-code-${i}`] = { code: 'code-bulk', elementId: String(910_000 + i), at }
  }
  for (let i = 0; i < 2500; i++) {
    sheet2[`bulk-code-${i}`] = { code: 'code-bulk', elementId: String(920_000 + i), at }
  }
  const small = smallData()
  return {
    ...small,
    [CODES]: { 'code-bulk': { code: '90-900', name: 'Bulk item', unit: 'ea', basis: 'count', price: 10 } },
    [SHEETS]: { ...small[SHEETS], 'sheet-2': { name: 'Option B', sort: 2, currency: 'USD', markups: [] } },
    [SHEET_1]: sheet1,
    [SHEET_2]: sheet2,
  }
}

// ---- the tests ---------------------------------------------------------------------------------

test.describe('writes under a busy server', () => {
  test('a Duplicate of 6,000 assignments sends at most WRITE_CONCURRENCY batches at once', async ({ page }) => {
    let slow = false
    const mock = await openEstimate(page, {
      data: bulkData(),
      holdWrite: () => (slow ? serverTime() : undefined),
    })
    const sheetSelect = page.getByTestId('sheet-select')

    slow = true
    mock.resetPeaks()
    await sheetSelect.click()
    await page.locator('[data-testid="select-option"][data-value="+dup"]').click()
    await page.getByTestId('dialog-confirm').click()
    await expect(sheetSelect).toHaveText('Base (2)')
    const copy = `estimate.sheet.${(await estimate(page))?.sheetId ?? ''}`

    // 6,000 entries are six batches of 1,000, and the copy holds all of them.
    await expect.poll(() => batchPutsTo(mock, copy)).toBe(6)
    expect(mock.store.get(copy)?.size).toBe(6000)

    // Two at a time: never more, and the pool is used (the mock saw them overlap).
    expect(mock.inFlight.get(copy)?.peak).toBe(WRITE_CONCURRENCY)
    expect(mock.inFlight.get(ALL_DATA)?.peak).toBe(WRITE_CONCURRENCY)
    await expect(failureToast(page)).toHaveCount(0)
  })

  test('deleting a code used on 8,500 entries of two sheets keeps WRITE_CONCURRENCY requests in flight at most', async ({
    page,
  }) => {
    let slow = false
    const mock = await openEstimate(page, {
      data: bulkData(),
      holdRead: () => (slow ? serverTime() : undefined),
      holdWrite: () => (slow ? serverTime() : undefined),
    })

    await page.getByTestId('tab-costcodes').click()
    const row = page.locator('[data-testid="costcode-row"][data-id="code-bulk"]')
    await row.locator('.ds-tree__label').click({ button: 'right' })
    await menuItem(page, 'delete-code').click()
    slow = true
    mock.resetPeaks()
    await page.getByTestId('dialog-confirm').click()

    await expect.poll(() => mock.entry(CODES, 'code-bulk'), { timeout: 30_000 }).toBeUndefined()

    // Sheet 1: 4,500 entries keep their work package (5 upserts), 1,500 go (2 deletes); sheet 2: 3 deletes.
    expect(batchPutsTo(mock, SHEET_1)).toBe(5)
    expect(batchDeletesTo(mock, SHEET_1)).toBe(2)
    expect(batchDeletesTo(mock, SHEET_2)).toBe(3)
    expect(mock.store.get(SHEET_1)?.size).toBe(4500)
    expect(mock.entry(SHEET_1, 'bulk-wp-0')).toEqual(expect.objectContaining({ wp: 'wp-shell' }))
    expect(mock.entry(SHEET_1, 'bulk-wp-0')).not.toHaveProperty('code')
    expect(mock.store.get(SHEET_2)?.size ?? 0).toBe(0)

    // Both sheets' reads and writes share the bound: never more than two requests at once, in all.
    expect(mock.inFlight.get(ALL_DATA)?.peak).toBe(WRITE_CONCURRENCY)
    await expect(failureToast(page)).toHaveCount(0)
  })

  test('a batch write that fails twice (503, then no answer) is retried and lands with no error', async ({ page }) => {
    let attempts = 0
    const mock = await openEstimate(page, {
      data: smallData(),
      failWrite: (write) => {
        if (!isBatchPut(write, SHEET_1)) return undefined
        attempts++
        if (attempts === 1) return 503
        if (attempts === 2) return 'network'
        return undefined
      },
    })
    const wall = await fixtureElement(WALL)

    await excludeElement(page, WALL)

    await expect.poll(() => mock.entry(SHEET_1, wall.key)).toMatchObject({ hidden: true, elementId: wall.elementId })
    expect(attempts).toBe(3)
    expect(batchPutsTo(mock, SHEET_1)).toBe(1)
    // The page kept the change, and says nothing went wrong.
    expect(await isHidden(page, WALL)).toBe(true)
    expect((await estimate(page))?.assignments[wall.key]).toMatchObject({ hidden: true })
    await expect(failureToast(page)).toHaveCount(0)
  })

  test('a batch write that gets no answer after every retry shows the toast and is taken back', async ({ page }) => {
    let attempts = 0
    const mock = await openEstimate(page, {
      data: smallData(),
      failWrite: (write) => {
        if (!isBatchPut(write, SHEET_1)) return undefined
        attempts++
        return 'network'
      },
    })
    const wall = await fixtureElement(WALL)

    await excludeElement(page, WALL)

    const toast = failureToast(page)
    await expect(toast).toBeVisible()
    await expect(toast).toHaveAttribute('data-tone', 'bad')
    await expect(toast).toContainText(NO_ANSWER)
    expect(attempts).toBe(1 + RETRIES)

    // Rolled back, and nothing stored.
    await expect.poll(() => isHidden(page, WALL)).toBe(false)
    expect((await estimate(page))?.assignments[wall.key]).toBeUndefined()
    expect(mock.entry(SHEET_1, wall.key)).toBeUndefined()
    expect(batchPutsTo(mock, SHEET_1)).toBe(0)
  })

  test('a conditional sheet write that gets no answer is read back before it is sent again', async ({ page }) => {
    let failed = false
    const mock = await openEstimate(page, {
      data: smallData(),
      failWrite: (write) => {
        if (failed || write.kind !== 'put' || write.namespace !== SHEETS) return undefined
        failed = true
        return 'network'
      },
    })

    const pct = page.getByTestId('markup-pct').first()
    await pct.fill('5')
    await pct.press('Enter')

    await expect.poll(() => mock.entry(SHEETS, 'sheet-1')).toMatchObject({ markups: [{ id: 'misc', pct: 5 }, { id: 'risk', pct: 5 }] })
    // Read, write (no answer), read back: the ETag has not moved, so it did not land; then the
    // whole cycle again, under the same ETag. Never a PUT straight after a PUT.
    expect(entryCalls(mock, SHEETS, 'sheet-1')).toEqual(['GET', 'PUT', 'GET', 'GET', 'PUT'])
    const [write] = mock.writes.filter((entry) => entry.kind === 'put' && entry.namespace === SHEETS)
    expect(write).toMatchObject({ ifMatch: '"1"' })
    await expect(failureToast(page)).toHaveCount(0)
  })

  test('a conditional sheet write that keeps failing is not retried blindly and shows the toast', async ({ page }) => {
    const mock = await openEstimate(page, {
      data: smallData(),
      failWrite: (write) => (write.kind === 'put' && write.namespace === SHEETS ? 503 : undefined),
    })

    const pct = page.getByTestId('markup-pct').first()
    await pct.fill('5')
    await pct.press('Enter')

    await expect(failureToast(page)).toBeVisible()
    await expect(failureToast(page)).toContainText('Write refused')
    // One PUT per read-modify-write cycle, each after a fresh read: http.ts did not resend it.
    const calls = entryCalls(mock, SHEETS, 'sheet-1')
    expect(calls.filter((call) => call === 'PUT')).toHaveLength(SHEET_ATTEMPTS)
    expect(calls).toEqual(Array.from({ length: SHEET_ATTEMPTS }, () => ['GET', 'PUT', 'GET']).flat())
    expect(mock.entry(SHEETS, 'sheet-1')).toMatchObject({ markups: [{ id: 'misc', pct: 15 }, { id: 'risk', pct: 5 }] })
  })

  test('a 401 on a batch write is not retried and returns to sign-in', async ({ page }) => {
    const mock = await openEstimate(page, { data: smallData() })
    const puts = () => mock.calls.filter((call) => call === `PUT /project/p-tiny/data/${SHEET_1}`).length

    mock.setUnauthorized(true)
    await excludeElement(page, WALL)

    await expect(page.getByTestId('signin-page')).toBeVisible()
    await expect(page.getByTestId('signin-error')).toContainText('expired')
    expect(puts()).toBe(1)
  })
})
