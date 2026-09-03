/**
 * Runtime configuration.
 *
 * Everything has a working default so the sample runs with no .env file.
 * The Entra ids are public identifiers, not secrets. At startup the app still
 * asks the server which app registration it trusts (GET /api/v1/config) and
 * prefers that answer; the env values are the offline fallback.
 */

/** Where the app is mounted, e.g. `/` in dev, `/vim-server-satellite/` on Pages. */
export const basePath = import.meta.env.BASE_URL

/** VIM Server base URL, no trailing slash. */
export const serverUrl = (
  import.meta.env.VITE_VIM_SERVER_URL ?? 'https://server-dev.vimaec.com'
).replace(/\/+$/, '')

/** All REST routes live under this prefix. */
export const apiUrl = `${serverUrl}/api/v1`

/** The redirect URI must be registered on the Entra app as a single-page application. */
export const redirectUri = `${location.origin}${basePath}signin-oidc`

/** Storage keys. localStorage survives a reload; the PKCE pair is per tab. */
export const storageKeys = {
  auth: 'vimSatellite.auth',
  hint: 'vimSatellite.hint',
  pkce: 'vimSatellite.pkce',
} as const

/** Project custom-data namespaces this app owns. */
export const namespaces = {
  palette: 'satellite.palette',
  labels: 'satellite.labels',
} as const

export type EntraConfig = {
  tenantId: string
  clientId: string
  apiScope: string
  /** `https://login.microsoftonline.com/{tenant}/oauth2/v2.0` */
  authority: string
  /** Space-separated scope string sent to /authorize and /token. */
  scopes: string
  redirectUri: string
}

const envTenantId = import.meta.env.VITE_ENTRA_TENANT_ID ?? '4e856586-7c87-4498-956e-ab21660251e1'
const envClientId = import.meta.env.VITE_ENTRA_CLIENT_ID ?? 'f518716e-50bb-4c82-bbee-3c85da317f82'

/** Builds the derived Entra values from a tenant/client pair. */
export function makeEntraConfig(tenantId: string, clientId: string): EntraConfig {
  const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE ?? `api://${clientId}/Sync.ReadWrite`
  return {
    tenantId,
    clientId,
    apiScope,
    authority: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`,
    // offline_access is what makes Entra issue a refresh token.
    scopes: `openid profile offline_access ${apiScope}`,
    redirectUri,
  }
}

/** Fallback used when GET /api/v1/config is unreachable. */
export const fallbackEntraConfig = makeEntraConfig(envTenantId, envClientId)
