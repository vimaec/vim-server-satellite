/**
 * The one thing the main suite cannot see: the app served from a sub-path.
 *
 * `npm run dev` always serves from `/`, so a wrong `base`, a missing
 * `public/` file or a redirect page that forwards to the wrong place all look
 * fine there and break only on GitHub Pages. This runs against a real
 * `BASE_PATH` build served by `vite preview`.
 */
import { expect, test } from '@playwright/test'

const BASE = process.env.BASE_PATH ?? '/vim-server-satellite/'

test.describe('served from a sub-path', () => {
  test('the app boots and shows the sign-in page', async ({ page }) => {
    // Answer GET /config from here: the smoke test must not reach a real server.
    await page.route('**/api/v1/config', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ tenantId: 'mock-tenant-id', clientId: 'mock-client-id' }),
      })
    })

    await page.goto(BASE)

    await expect(page.getByTestId('signin-page')).toBeVisible()
    await expect(page.getByTestId('signin-microsoft')).toBeVisible()
  })

  test('the favicon is served from the sub-path', async ({ page }) => {
    const response = await page.request.get(`${BASE}favicon.ico`)
    expect(response.status()).toBe(200)
  })

  test('signin-oidc.html forwards the Entra reply fragment to the app root', async ({ page }) => {
    // Stub the app page itself: this checks where the redirect page sends the
    // fragment, and the real app would immediately strip it from the URL.
    await page.route(`**${BASE}`, async (route) => {
      await route.fulfill({ contentType: 'text/html', body: '<p>app root</p>' })
    })

    await page.goto(`${BASE}signin-oidc.html#code=x&state=y`)

    await page.waitForURL((url) => url.pathname === BASE && url.hash === '#code=x&state=y')

    const final = new URL(page.url())
    expect(final.pathname).toBe(BASE)
    expect(final.hash).toBe('#code=x&state=y')
  })
})
