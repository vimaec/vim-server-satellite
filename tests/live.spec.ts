/**
 * Smoke test against the real VIM Server. Skipped unless VIM_SATELLITE_PAT is
 * set, so the default suite stays offline and deterministic.
 *
 *   VIM_SATELLITE_PAT=<token> npx playwright test live
 */
import { expect, test } from '@playwright/test'

const pat = process.env.VIM_SATELLITE_PAT ?? ''

test.describe('live server', () => {
  test.skip(!pat, 'set VIM_SATELLITE_PAT to run the live smoke test')

  test('a real access token signs in and lists projects', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('signin-pat-toggle').click()
    await page.getByTestId('signin-pat-input').fill(pat)
    await page.getByTestId('signin-pat-submit').click()

    await expect(page.getByTestId('project-picker')).toBeVisible()
    await expect(page.getByTestId('org-group').first()).toBeVisible()
  })
})
