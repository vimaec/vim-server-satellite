import { expect, test } from '@playwright/test'
import { installMockVimServer, REFRESHED_TOKEN } from './support/mockVimServer'
import {
  makeIdToken,
  mockEntraToken,
  seedPkce,
  SESSION_KEY,
  useFakeSession,
} from './support/auth'

/** The env defaults in src/config.ts, used when GET /config cannot be reached. */
const FALLBACK_TENANT_ID = '4e856586-7c87-4498-956e-ab21660251e1'
const FALLBACK_CLIENT_ID = 'f518716e-50bb-4c82-bbee-3c85da317f82'

/** An access token with less than the refresh margin (60 s) of life left. */
const EXPIRING_IN_MS = 30_000

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

  test('an expiring access token is refreshed silently before the first API call', async ({
    page,
  }) => {
    // The mock accepts only the refreshed token, so the picker can appear at all
    // only if the refresh happened before the first call went out.
    await installMockVimServer(page, { tokens: [REFRESHED_TOKEN] })
    const entra = await mockEntraToken(page, {
      body: {
        token_type: 'Bearer',
        expires_in: 3600,
        access_token: REFRESHED_TOKEN,
        refresh_token: 'e2e-refresh-rotated',
        id_token: makeIdToken({ name: 'Ada Lovelace', preferred_username: 'ada@example.com' }),
      },
    })
    await useFakeSession(page, { exp: Date.now() + EXPIRING_IN_MS })

    await page.goto('/')

    await expect(page.getByTestId('project-picker')).toBeVisible()
    await expect(page.getByTestId('project-item').first()).toBeVisible()

    expect(entra.posts.map((post) => post.grant_type)).toEqual(['refresh_token'])
    expect(entra.posts[0].refresh_token).toBe('e2e-refresh')

    // The rotated tokens replaced the stored ones, so a reload needs no refresh.
    const stored = await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY)
    expect(JSON.parse(stored ?? '{}')).toMatchObject({
      access: REFRESHED_TOKEN,
      refresh: 'e2e-refresh-rotated',
    })
  })

  test('a refused refresh returns to the sign-in page with a message', async ({ page }) => {
    await installMockVimServer(page)
    const entra = await mockEntraToken(page, {
      status: 400,
      body: { error: 'invalid_grant', error_description: 'The refresh token has expired.' },
    })
    await useFakeSession(page, { exp: Date.now() + EXPIRING_IN_MS })

    await page.goto('/')

    await expect(page.getByTestId('signin-page')).toBeVisible()
    await expect(page.getByTestId('signin-error')).toContainText('expired')
    expect(entra.posts.map((post) => post.grant_type)).toEqual(['refresh_token'])
    expect(await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY)).toBeNull()
  })

  test('when GET /api/v1/config fails the env fallback still starts the sign-in', async ({
    page,
  }) => {
    await installMockVimServer(page)
    // Registered after the mock, so it wins: the server cannot be asked which
    // app registration it trusts.
    await page.route('**/api/v1/config', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Server error', status: 500 }),
      })
    })
    // Answer /authorize instead of letting the tab leave for Microsoft.
    const authorizeUrls: string[] = []
    await page.route('https://login.microsoftonline.com/**/oauth2/v2.0/authorize**', async (route) => {
      authorizeUrls.push(route.request().url())
      await route.fulfill({ contentType: 'text/html', body: '<p>Microsoft sign-in</p>' })
    })

    await page.goto('/')
    await page.getByTestId('signin-microsoft').click()

    await expect.poll(() => authorizeUrls.length).toBe(1)
    const authorize = new URL(authorizeUrls[0])
    expect(authorize.pathname).toContain(FALLBACK_TENANT_ID)
    expect(authorize.searchParams.get('client_id')).toBe(FALLBACK_CLIENT_ID)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    // base64url of a SHA-256 digest: 43 characters, no padding.
    expect(authorize.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
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
