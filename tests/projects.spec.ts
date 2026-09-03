import { expect, test } from '@playwright/test'
import { installMockVimServer } from './support/mockVimServer'
import { useFakeSession } from './support/auth'

test.describe('projects', () => {
  test.beforeEach(async ({ page }) => {
    await installMockVimServer(page)
    await useFakeSession(page)
  })

  test('the picker groups projects by organisation', async ({ page }) => {
    await page.goto('/')

    const orgs = page.getByTestId('org-group')
    await expect(orgs).toHaveCount(2)
    await expect(page.locator('[data-testid="org-group"][data-org-id="org-north"]')).toContainText(
      'Northwind Design',
    )

    const projects = page.getByTestId('project-item')
    await expect(projects).toHaveCount(3)
    await expect(projects.filter({ hasText: 'Tiny House' })).toContainText('v3')
  })

  test('a project without a VIM is disabled', async ({ page }) => {
    await page.goto('/')

    const empty = page.locator('[data-testid="project-item"][data-project-id="p-empty"]')
    await expect(empty).toHaveAttribute('aria-disabled', 'true')
    await expect(empty).toContainText('No VIM yet')
    await expect(empty).toBeDisabled()
  })

  test('opening a project shows its title, snapshot and role', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-testid="project-item"][data-project-id="p-tiny"]').click()

    await expect(page.getByTestId('project-page')).toBeVisible()
    await expect(page.getByTestId('project-title')).toHaveText('Tiny House')
    await expect(page.getByTestId('snapshot-tag')).toHaveText('v3')
    await expect(page.getByTestId('role-badge')).toHaveText('Manager')
    await expect(page.getByTestId('user-name')).toHaveText('Ada Lovelace')
    expect(await page.evaluate(() => window.__vimSatellite?.getState())).toBe('project')
  })

  test('the chosen project survives a reload through ?project=', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-testid="project-item"][data-project-id="p-tiny"]').click()
    await expect(page.getByTestId('project-page')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('project')).toBe('p-tiny')

    await page.reload()

    await expect(page.getByTestId('project-page')).toBeVisible()
    await expect(page.getByTestId('project-title')).toHaveText('Tiny House')
  })

  test('back to projects returns to the picker and clears the query', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-testid="project-item"][data-project-id="p-tiny"]').click()
    await expect(page.getByTestId('project-page')).toBeVisible()

    await page.getByTestId('back-to-projects').click()

    await expect(page.getByTestId('project-picker')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('project')).toBeNull()
  })

  test('both panes are present and the viewer starts loading', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-testid="project-item"][data-project-id="p-tiny"]').click()

    await expect(page.getByTestId('element-tree')).toBeVisible()
    await expect(page.getByTestId('label-panel')).toBeVisible()
    await expect(page.getByTestId('viewer-pane')).toBeVisible()

    // Waiting for the whole snapshot to arrive is viewer-labels.spec.ts's job;
    // here the load only has to start.
    await expect(page.getByTestId('viewer-status')).toHaveAttribute(
      'data-state',
      /loading|loaded/,
    )
  })

  test('opening ?project= for a project the user cannot see shows an error', async ({ page }) => {
    // A project the caller cannot see answers 404, never 403.
    await page.goto('/?project=p-somebody-elses')

    await expect(page.getByTestId('project-page')).toBeVisible()
    await expect(page.getByTestId('viewer-status')).toHaveAttribute('data-state', 'error')
    await expect(page.getByTestId('viewer-status')).toContainText('No such project')
  })

  test("the project page says loading, not 'no VIM', while lookups are pending", async ({
    page,
  }) => {
    // Hold the snapshot list open, so the page is still resolving on screen.
    await page.route('**/api/v1/project/p-tiny/vim', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500))
      await route.fallback()
    })
    await page.goto('/?project=p-tiny')

    await expect(page.getByTestId('viewer-status')).toHaveAttribute('data-state', 'loading')
    await expect(page.getByTestId('viewer-status')).toContainText('Opening the project')
    // "no VIM" would be a lie: the app does not know yet.
    await expect(page.getByTestId('snapshot-tag')).toHaveText('…')
    await expect(page.getByTestId('element-tree')).toContainText('Opening the project')

    await expect(page.getByTestId('snapshot-tag')).toHaveText('v3')
  })

  test('a project whose snapshot download fails reports an error', async ({ page }) => {
    // Break only the download route; the rest of the project page still loads.
    await page.route('**/api/v1/project/p-tiny/vim/download**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Storage unavailable', status: 500, detail: 'try later' }),
      })
    })
    await page.goto('/')
    await page.locator('[data-testid="project-item"][data-project-id="p-tiny"]').click()

    await expect(page.getByTestId('viewer-status')).toHaveAttribute('data-state', 'error')
  })
})
