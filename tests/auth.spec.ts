import { expect, test } from '@playwright/test'
import { installMockVimServer, GOOD_TOKEN } from './support/mockVimServer'
import { mockEntraToken, seedPkce, SESSION_KEY, useFakeSession } from './support/auth'

test.describe('sign-in', () => {
  test('a signed-out visitor sees the sign-in page and no project content', async ({ page }) => {
    await installMockVimServer(page)
    await page.goto('/')

    await expect(page.getByTestId('signin-page')).toBeVisible()
    await expect(page.getByTestId('signin-microsoft')).toBeVisible()
    await expect(page.getByTestId('project-picker')).toHaveCount(0)
    await expect(page.getByTestId('project-page')).toHaveCount(0)
    expect(await page.evaluate(() => window.__vimSatellite?.getState())).toBe('sign-in')
  })

  test('a valid access token signs in and lands on the project picker', async ({ page }) => {
    await installMockVimServer(page)
    await page.goto('/')

    await page.getByTestId('signin-pat-toggle').click()
    await page.getByTestId('signin-pat-input').fill(GOOD_TOKEN)
    await page.getByTestId('signin-pat-submit').click()

    await expect(page.getByTestId('project-picker')).toBeVisible()
    // The mock validated the token through GET /profile before it was stored.
    await expect(page.getByTestId('user-name')).toHaveText('Ada Lovelace')
  })

  test('a rejected access token shows an error and stays signed out', async ({ page }) => {
    await installMockVimServer(page)
    await page.goto('/')

    await page.getByTestId('signin-pat-toggle').click()
    await page.getByTestId('signin-pat-input').fill('not-the-token')
    await page.getByTestId('signin-pat-submit').click()

    await expect(page.getByTestId('signin-error')).toContainText('rejected that token')
    await expect(page.getByTestId('project-picker')).toHaveCount(0)
  })

  test('a PKCE reply is exchanged for tokens and signs the user in', async ({ page }) => {
    await installMockVimServer(page)
    await mockEntraToken(page)
    await seedPkce(page, 'test-verifier', 'state-123')

    await page.goto('/signin-oidc#code=abc&state=state-123')

    await expect(page.getByTestId('project-picker')).toBeVisible()
    await expect(page.getByTestId('user-name')).toHaveText('Ada Lovelace')
    // The reply fragment and the /signin-oidc path are both gone from the URL.
    expect(new URL(page.url()).hash).toBe('')
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('a PKCE reply whose state does not match is refused', async ({ page }) => {
    await installMockVimServer(page)
    await mockEntraToken(page)
    await seedPkce(page, 'test-verifier', 'state-123')

    await page.goto('/signin-oidc#code=abc&state=someone-elses-state')

    await expect(page.getByTestId('signin-error')).toContainText('did not match a request')
    await expect(page.getByTestId('project-picker')).toHaveCount(0)
  })

  test('an Entra error fragment is shown on the sign-in page', async ({ page }) => {
    await installMockVimServer(page)
    await page.goto('/signin-oidc#error=access_denied&error_description=The%20user%20cancelled')

    await expect(page.getByTestId('signin-error')).toContainText('access_denied')
    await expect(page.getByTestId('signin-error')).toContainText('The user cancelled')
  })

  test('sign out returns to the sign-in page and forgets the session', async ({ page }) => {
    await installMockVimServer(page)
    await useFakeSession(page)
    await page.goto('/')

    await expect(page.getByTestId('project-picker')).toBeVisible()
    await page.getByTestId('sign-out').click()

    await expect(page.getByTestId('signin-page')).toBeVisible()
    expect(await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY)).toBeNull()
  })

  test('a 401 while signed in drops the session and explains why', async ({ page }) => {
    const mock = await installMockVimServer(page)
    await useFakeSession(page)
    await page.goto('/')

    await expect(page.getByTestId('project-picker')).toBeVisible()

    // The token stops being accepted between the picker and the project page.
    mock.setUnauthorized(true)
    await page.getByTestId('project-item').first().click()

    await expect(page.getByTestId('signin-page')).toBeVisible()
    await expect(page.getByTestId('signin-error')).toContainText('expired')
  })
})
