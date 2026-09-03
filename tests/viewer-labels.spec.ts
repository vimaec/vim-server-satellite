/**
 * The viewer, the element tree and the labels, end to end against the mock
 * server: a real vim-web viewer loads the Tiny House fixture over mocked HTTP
 * Range requests, and every label write lands in the mock's data store.
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { defaultOrgs, installMockVimServer } from './support/mockVimServer'
import type { MockHandle } from './support/mockVimServer'
import { useFakeSession } from './support/auth'

/** Parsing and building the whole snapshot under software GL is not quick. */
const LOAD_TIMEOUT = 60_000

/** Waits for the viewer to finish loading and the tree to be populated. */
async function waitForModel(page: Page): Promise<void> {
  await expect(page.getByTestId('viewer-status')).toHaveAttribute('data-state', 'loaded', {
    timeout: LOAD_TIMEOUT,
  })
  await expect(page.getByTestId('tree-category').first()).toBeVisible({ timeout: LOAD_TIMEOUT })
}

/**
 * Opens the first category and family so their element leaves are rendered:
 * groups are collapsed by default, and a collapsed group renders no children.
 */
async function expandFirstFamily(page: Page): Promise<Locator> {
  const category = page.getByTestId('tree-category').first()
  await category.locator('button').first().click()
  const family = category.getByTestId('tree-family').first()
  await family.locator('button').first().click()
  const leaves = family.getByTestId('tree-element')
  await expect(leaves.first()).toBeVisible()
  return leaves
}

/**
 * The other way to reach leaves: a search term opens every group it matches.
 * 'Walls' matches the category, so the fixture's four walls become leaves.
 */
async function searchLeaves(page: Page, term: string): Promise<Locator> {
  await page.getByTestId('tree-search').fill(term)
  const leaves = page.getByTestId('tree-element')
  await expect(leaves.first()).toBeVisible()
  return leaves
}

/** The Apply button of one palette entry. */
function labelItem(page: Page, name: string): Locator {
  return page.getByTestId('label-item').filter({ hasText: name })
}

function batchWrites(mock: MockHandle): { keys: string[]; values: unknown[] }[] {
  return mock.writes
    .filter((write) => write.kind === 'put-batch' && write.namespace === 'satellite.labels')
    .map((write) => {
      const batch = write as { entries: { key: string; value: unknown }[] }
      return {
        keys: batch.entries.map((entry) => entry.key),
        values: batch.entries.map((entry) => entry.value),
      }
    })
}

function deletedKeys(mock: MockHandle): string[] {
  return mock.writes
    .filter((write) => write.kind === 'delete' && write.namespace === 'satellite.labels')
    .flatMap((write) => (write as { keys: string[] }).keys)
}

test.describe('viewer, tree and labels', () => {
  test('opening a project loads the snapshot and fills the tree', async ({ page }) => {
    await installMockVimServer(page)
    await useFakeSession(page)
    await page.goto('/?project=p-tiny')

    await waitForModel(page)
    expect(await page.getByTestId('tree-category').count()).toBeGreaterThan(0)

    const leaves = await expandFirstFamily(page)
    expect(await leaves.count()).toBeGreaterThan(0)
  })

  test('clicking a tree element selects it and ctrl-click adds a second', async ({ page }) => {
    await installMockVimServer(page)
    await useFakeSession(page)
    await page.goto('/?project=p-tiny')
    await waitForModel(page)

    const leaves = await searchLeaves(page, 'Walls')
    expect(await leaves.count()).toBeGreaterThan(1)

    const first = leaves.nth(0)
    const second = leaves.nth(1)
    const firstIndex = Number(await first.getAttribute('data-element-index'))
    const secondIndex = Number(await second.getAttribute('data-element-index'))

    await first.click()
    await expect(first).toHaveAttribute('aria-selected', 'true')
    expect(await page.evaluate(() => window.__vimSatellite?.getSelection())).toEqual([firstIndex])

    await second.click({ modifiers: ['ControlOrMeta'] })
    await expect(second).toHaveAttribute('aria-selected', 'true')
    await expect(first).toHaveAttribute('aria-selected', 'true')
    const selection = await page.evaluate(() => window.__vimSatellite?.getSelection())
    expect(selection).toHaveLength(2)
    expect(selection).toEqual(expect.arrayContaining([firstIndex, secondIndex]))
  })

  test('applying a label saves it, colors the element and creates the palette', async ({
    page,
  }) => {
    const mock = await installMockVimServer(page)
    await useFakeSession(page)
    await page.goto('/?project=p-tiny')
    await waitForModel(page)

    const leaves = await searchLeaves(page, 'Walls')
    const first = leaves.nth(0)
    const second = leaves.nth(1)
    const indices = [
      Number(await first.getAttribute('data-element-index')),
      Number(await second.getAttribute('data-element-index')),
    ]
    const keys = [
      await first.getAttribute('data-element-key'),
      await second.getAttribute('data-element-key'),
    ]

    await first.click()
    await second.click({ modifiers: ['ControlOrMeta'] })
    await labelItem(page, 'Review').getByTestId('label-apply').click()

    await expect(page.getByTestId('label-status')).toHaveAttribute('data-state', 'saved')
    await expect(page.getByTestId('labelled-count')).toHaveText('2')

    // The batch PUT carries one entry per selected element, keyed by UniqueId.
    const batches = batchWrites(mock)
    expect(batches).toHaveLength(1)
    expect(batches[0].keys.sort()).toEqual([...keys].sort())
    for (const value of batches[0].values) {
      expect(value).toMatchObject({
        labelId: 'review',
        elementId: expect.any(String),
        at: expect.any(String),
      })
    }

    // The default palette is client-side until the first write needs it.
    const paletteWrites = mock.writes.filter(
      (write) => write.kind === 'put' && write.namespace === 'satellite.palette',
    )
    expect(paletteWrites).toHaveLength(1)
    expect(mock.entry('satellite.palette', 'palette')).toMatchObject({
      labels: expect.arrayContaining([{ id: 'review', name: 'Review', color: '#e5484d' }]),
    })

    // Both the tree dot and the viewer color come from the label's color.
    await expect(first.getByTestId('tree-element-label')).toHaveAttribute('data-color', '#e5484d')
    for (const index of indices) {
      expect(await page.evaluate((i) => window.__vimSatellite?.getElementColor(i), index)).toBe(
        '#e5484d',
      )
    }
    const assignments = await page.evaluate(() => window.__vimSatellite?.getAssignments())
    expect(Object.keys(assignments ?? {}).sort()).toEqual([...keys].sort())
  })

  test('labels stored on the server are reapplied after a reload', async ({ page }) => {
    await installMockVimServer(page)
    await useFakeSession(page)
    await page.goto('/?project=p-tiny')
    await waitForModel(page)

    const leaf = (await searchLeaves(page, 'Walls')).nth(0)
    const index = Number(await leaf.getAttribute('data-element-index'))
    const key = await leaf.getAttribute('data-element-key')
    await leaf.click()
    await labelItem(page, 'Approved').getByTestId('label-apply').click()
    await expect(page.getByTestId('label-status')).toHaveAttribute('data-state', 'saved')

    await page.reload()
    await waitForModel(page)

    // No user action: the assignment came back from the store and was applied.
    await expect(page.getByTestId('labelled-count')).toHaveText('1')
    await expect(page.locator(`[data-testid="labelled-element"][data-element-key="${key}"]`)).toBeVisible()
    await expect
      .poll(() => page.evaluate((i) => window.__vimSatellite?.getElementColor(i), index))
      .toBe('#30a46c')

    const reopened = (await searchLeaves(page, 'Walls')).nth(0)
    await expect(reopened.getByTestId('tree-element-label')).toHaveAttribute(
      'data-color',
      '#30a46c',
    )
  })

  test('removing a label deletes the assignment and the color', async ({ page }) => {
    const mock = await installMockVimServer(page)
    await useFakeSession(page)
    await page.goto('/?project=p-tiny')
    await waitForModel(page)

    const leaf = (await searchLeaves(page, 'Walls')).nth(0)
    const index = Number(await leaf.getAttribute('data-element-index'))
    const key = await leaf.getAttribute('data-element-key')

    await leaf.click()
    await labelItem(page, 'Review').getByTestId('label-apply').click()
    await expect(page.getByTestId('labelled-count')).toHaveText('1')

    await page.getByTestId('label-remove').click()

    await expect(page.getByTestId('label-status')).toHaveAttribute('data-state', 'saved')
    await expect(page.getByTestId('labelled-count')).toHaveText('0')
    expect(deletedKeys(mock)).toEqual([key])
    await expect(leaf.getByTestId('tree-element-label')).toHaveCount(0)
    expect(
      await page.evaluate((i) => window.__vimSatellite?.getElementColor(i), index),
    ).toBeUndefined()
  })

  test('a new label is added to the palette with If-Match', async ({ page }) => {
    // A palette already on the server means the app holds its write-version.
    const mock = await installMockVimServer(page, {
      data: {
        'satellite.palette': {
          palette: { labels: [{ id: 'review', name: 'Review', color: '#e5484d' }] },
        },
      },
    })
    await useFakeSession(page)
    await page.goto('/?project=p-tiny')
    await expect(page.getByTestId('label-item')).toHaveCount(1)

    await page.getByTestId('label-new-name').fill('Blocked')
    await page.getByTestId('label-new-color').fill('#7c3aed')
    await page.getByTestId('label-new-add').click()

    await expect(page.getByTestId('label-status')).toHaveAttribute('data-state', 'saved')
    await expect(page.getByTestId('label-item')).toHaveCount(2)
    await expect(labelItem(page, 'Blocked')).toBeVisible()

    const paletteWrites = mock.writes.filter(
      (write) => write.kind === 'put' && write.namespace === 'satellite.palette',
    )
    expect(paletteWrites).toHaveLength(1)
    expect((paletteWrites[0] as { ifMatch: string | null }).ifMatch).toBe('"1"')
    expect(mock.entry('satellite.palette', 'palette')).toMatchObject({
      labels: expect.arrayContaining([
        expect.objectContaining({ name: 'Blocked', color: '#7c3aed' }),
      ]),
    })
  })

  test('deleting a label also deletes its assignments', async ({ page }) => {
    const mock = await installMockVimServer(page)
    await useFakeSession(page)
    await page.goto('/?project=p-tiny')
    await waitForModel(page)

    const leaf = (await searchLeaves(page, 'Walls')).nth(0)
    const index = Number(await leaf.getAttribute('data-element-index'))
    const key = await leaf.getAttribute('data-element-key')

    await leaf.click()
    await labelItem(page, 'Question').getByTestId('label-apply').click()
    await expect(page.getByTestId('labelled-count')).toHaveText('1')

    await labelItem(page, 'Question').getByTestId('label-delete').click()

    await expect(page.getByTestId('label-status')).toHaveAttribute('data-state', 'saved')
    await expect(labelItem(page, 'Question')).toHaveCount(0)
    await expect(page.getByTestId('labelled-count')).toHaveText('0')
    expect(deletedKeys(mock)).toEqual([key])
    expect(
      await page.evaluate((i) => window.__vimSatellite?.getElementColor(i), index),
    ).toBeUndefined()
    expect(mock.entry('satellite.labels', key ?? '')).toBeUndefined()
  })

  test('the Viewer role makes the label panel read-only', async ({ page }) => {
    const orgs = defaultOrgs()
    orgs[0].projects[0].role = 'Viewer'
    await installMockVimServer(page, { orgs })
    await useFakeSession(page)
    await page.goto('/?project=p-tiny')

    await expect(page.getByTestId('role-badge')).toHaveText('Viewer')
    await expect(page.getByTestId('label-status')).toHaveAttribute('data-state', 'readonly')
    for (const apply of await page.getByTestId('label-apply').all()) {
      await expect(apply).toBeDisabled()
    }
    await expect(page.getByTestId('label-remove')).toBeDisabled()
    await expect(page.getByTestId('label-new-add')).toBeDisabled()
  })

  test('clicking the 3D view selects an element and the tree follows', async ({ page }) => {
    await installMockVimServer(page)
    await useFakeSession(page)
    await page.goto('/?project=p-tiny')
    await waitForModel(page)

    // Fit the whole model first, so the middle of the canvas is on the building.
    await page.getByTestId('frame-selection').click()
    const pane = page.getByTestId('viewer-pane')
    const box = await pane.boundingBox()
    expect(box).not.toBeNull()
    if (!box) return

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    await expect
      .poll(async () => (await page.evaluate(() => window.__vimSatellite?.getSelection()))?.length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0)

    const selection = await page.evaluate(() => window.__vimSatellite?.getSelection())
    const index = selection?.[0]
    expect(index).toBeDefined()
    // The tree opened the groups holding the element the user clicked in 3D.
    await expect(
      page.locator(`[data-testid="tree-element"][data-element-index="${index}"]`),
    ).toHaveAttribute('aria-selected', 'true')
  })
})
