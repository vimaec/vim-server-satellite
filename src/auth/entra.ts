/**
 * Microsoft Entra ID: authorization code flow with PKCE, by hand.
 *
 * PKCE is written out instead of using MSAL because the whole flow is ~60 lines
 * of fetch calls. A sample that shows the actual HTTP exchange is easier to port
 * to another stack than one that hides it behind a library.
 *
 * Everything here is React-free — it touches only `location`, web storage and
 * `fetch` — so AuthProvider stays small and the flow reads on its own.
 */
import { basePath, storageKeys, type EntraConfig } from '../config'
import { jwtClaims, randomUrlSafe, sha256url } from './pkce'

/** The signed-in user, as stored in localStorage. */
export type Session = {
  access: string
  /** Empty for a PAT session: personal access tokens do not refresh. */
  refresh: string
  /** Absolute expiry, ms since epoch. */
  exp: number
  name: string
  upn: string
  kind: 'entra' | 'pat'
}

type PkcePair = { verifier: string; state: string }

/** Result of handling a `#code=` / `#error=` fragment. */
export type CompleteResult =
  | { kind: 'none' }
  | { kind: 'session'; session: Session }
  | { kind: 'error'; message: string }

// --- storage -------------------------------------------------------------

function readJson<T>(store: Storage, key: string): T | null {
  try {
    const raw = store.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function readSession(): Session | null {
  const session = readJson<Session>(localStorage, storageKeys.auth)
  return session && typeof session.access === 'string' && session.access ? session : null
}

export function writeSession(session: Session): void {
  try {
    localStorage.setItem(storageKeys.auth, JSON.stringify(session))
    if (session.upn) localStorage.setItem(storageKeys.hint, session.upn)
  } catch {
    // Storage can be unavailable (private mode); a failure must not break sign-in.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(storageKeys.auth)
  } catch {
    // ignore
  }
}

// --- helpers -------------------------------------------------------------

/** Entra error bodies carry a correlation id and a trace; keep the first line. */
function firstLine(text: string | null | undefined): string {
  return String(text ?? '')
    .split(/\r?\n|Trace ID/)[0]
    .trim()
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

async function postToken(
  cfg: EntraConfig,
  params: Record<string, string>,
): Promise<{ ok: boolean; body: TokenResponse }> {
  const response = await fetch(`${cfg.authority}/token`, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: cfg.clientId }).toString(),
  })
  const body = (await response.json().catch(() => ({}))) as TokenResponse
  return { ok: response.ok, body }
}

/** Builds a session from a token response, keeping the previous name/refresh if absent. */
function toSession(body: TokenResponse, previous: Session | null): Session {
  const claims = jwtClaims(body.id_token ?? '')
  const claim = (key: string): string =>
    typeof claims[key] === 'string' ? (claims[key] as string) : ''
  const upn = claim('preferred_username') || claim('upn') || claim('email') || previous?.upn || ''
  return {
    access: body.access_token ?? '',
    // A refresh response may omit the rotated token; keep what we already had.
    refresh: body.refresh_token ?? previous?.refresh ?? '',
    exp: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    name: claim('name') || previous?.name || upn,
    upn,
    kind: 'entra',
  }
}

// --- sign in -------------------------------------------------------------

/** Starts the redirect to Entra. Does not return: the tab navigates away. */
export async function beginSignIn(cfg: EntraConfig): Promise<void> {
  const verifier = randomUrlSafe(32)
  const state = randomUrlSafe(16)
  const pkce: PkcePair = { verifier, state }
  sessionStorage.setItem(storageKeys.pkce, JSON.stringify(pkce))

  const query = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    response_mode: 'fragment',
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes,
    state,
    code_challenge: await sha256url(verifier),
    code_challenge_method: 'S256',
  })
  const hint = localStorage.getItem(storageKeys.hint)
  if (hint) query.set('login_hint', hint)

  location.assign(`${cfg.authority}/authorize?${query.toString()}`)
}

/** True when the current URL fragment carries an Entra reply. */
export function hasAuthReply(): boolean {
  return /(^|&)(code|error)=/.test(location.hash.replace(/^#/, ''))
}

/**
 * Handles a `#code=` / `#error=` fragment and exchanges the code for tokens.
 * Runs on any path, because the Vite dev server answers /signin-oidc with
 * index.html rather than with public/signin-oidc.html.
 */
export async function completeSignInFromHash(cfg: EntraConfig): Promise<CompleteResult> {
  const hash = location.hash.replace(/^#/, '')
  if (!/(^|&)(code|error)=/.test(hash)) return { kind: 'none' }

  const reply = new URLSearchParams(hash)
  // Drop the fragment and the /signin-oidc path so a reload does not replay the reply.
  history.replaceState(null, '', basePath)

  const pkce = readJson<PkcePair>(sessionStorage, storageKeys.pkce)
  sessionStorage.removeItem(storageKeys.pkce)

  const errorCode = reply.get('error')
  if (errorCode) {
    // Keep the code as well as the description: "access_denied" and
    // "invalid_client" tell an operator far more than the prose does.
    const detail = firstLine(reply.get('error_description'))
    return {
      kind: 'error',
      message: `Microsoft sign-in failed (${errorCode})${detail ? `: ${detail}` : ''}`,
    }
  }
  const code = reply.get('code')
  if (!code) return { kind: 'error', message: 'Microsoft sign-in failed: the reply had no code.' }
  if (!pkce?.verifier || pkce.state !== reply.get('state')) {
    return {
      kind: 'error',
      message: 'The sign-in reply did not match a request from this browser tab. Sign in again.',
    }
  }

  let result: { ok: boolean; body: TokenResponse }
  try {
    result = await postToken(cfg, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: pkce.verifier,
      scope: cfg.scopes,
    })
  } catch {
    return {
      kind: 'error',
      message: 'Could not reach login.microsoftonline.com to finish the sign-in. Try again.',
    }
  }
  if (!result.ok || !result.body.access_token) {
    const detail = firstLine(result.body.error_description ?? result.body.error) || 'no details'
    return { kind: 'error', message: `Microsoft did not issue a token: ${detail}` }
  }

  const session = toSession(result.body, readSession())
  writeSession(session)
  return { kind: 'session', session }
}

// --- refresh -------------------------------------------------------------

/** One shared in-flight refresh, so parallel API calls do not each start one. */
let refreshing: Promise<Session | null> | null = null

/**
 * Returns a session with a usable access token, refreshing when the current one
 * is close to expiry. Returns null when the user has to sign in again.
 */
export async function refreshIfNeeded(cfg: EntraConfig, session: Session): Promise<Session | null> {
  if (session.exp - Date.now() > 60_000) return session
  // A PAT is long-lived and has no refresh grant; use it until the server says no.
  if (session.kind === 'pat') return session
  if (!session.refresh) return null
  if (refreshing) return refreshing

  refreshing = (async (): Promise<Session | null> => {
    try {
      const result = await postToken(cfg, {
        grant_type: 'refresh_token',
        refresh_token: session.refresh,
        scope: cfg.scopes,
      })
      if (!result.ok || !result.body.access_token) return null
      const next = toSession(result.body, session)
      writeSession(next)
      return next
    } catch {
      // Entra unreachable: keep the current token and let the API call fail itself.
      return session
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}
