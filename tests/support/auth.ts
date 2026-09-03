/** Test helpers that put the app into a signed-in state without a real Entra tenant. */
import type { Page } from '@playwright/test'
import { GOOD_TOKEN } from './mockVimServer'

/** Storage keys — must match src/config.ts. */
export const SESSION_KEY = 'vimSatellite.auth'
export const HINT_KEY = 'vimSatellite.hint'
export const PKCE_KEY = 'vimSatellite.pkce'

/** Mirrors the Session type in src/auth/entra.ts. */
export type FakeSession = {
  access: string
  refresh: string
  exp: number
  name: string
  upn: string
}

/** A fake Entra session, as the real flow would have written it. */
export function fakeSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    access: GOOD_TOKEN,
    refresh: 'e2e-refresh',
    exp: Date.now() + 60 * 60 * 1000,
    name: 'Ada Lovelace',
    upn: 'ada@example.com',
    ...overrides,
  }
}

/** Writes the fake Entra session before any app code runs, so the app boots signed in. */
export async function useFakeSession(
  page: Page,
  overrides: Partial<FakeSession> = {},
): Promise<FakeSession> {
  const session = fakeSession(overrides)
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value)
    },
    [SESSION_KEY, JSON.stringify(session)] as const,
  )
  return session
}

/** Seeds the in-flight PKCE pair, as if this tab had started the sign-in. */
export async function seedPkce(page: Page, verifier: string, state: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value)
    },
    [PKCE_KEY, JSON.stringify({ verifier, state })] as const,
  )
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

/**
 * A syntactically valid but unsigned JWT. The app only reads the claims for
 * display, so a real signature is not needed — and must not be implied.
 */
export function makeIdToken(claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({ iss: 'https://login.microsoftonline.com/mock-tenant-id/v2.0', ...claims }),
  )
  return `${header}.${payload}.`
}

/** Answers Entra's token endpoint with a token set the mock server accepts. */
export async function mockEntraToken(
  page: Page,
  options: { status?: number; body?: Record<string, unknown> } = {},
): Promise<void> {
  const body = options.body ?? {
    token_type: 'Bearer',
    scope: 'openid profile offline_access',
    expires_in: 3600,
    access_token: GOOD_TOKEN,
    refresh_token: 'e2e-refresh',
    id_token: makeIdToken({ name: 'Ada Lovelace', preferred_username: 'ada@example.com' }),
  }
  await page.route('https://login.microsoftonline.com/**/oauth2/v2.0/token', async (route) => {
    await route.fulfill({
      status: options.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}
