/**
 * The one place that talks to VIM Server.
 *
 * Adds the bearer token and Accept header, turns error bodies into ApiError,
 * and reports a 401 once to the auth layer so the app drops the session and
 * returns to the sign-in page with a message.
 */
import { apiUrl } from '../config'

export class ApiError extends Error {
  readonly status: number
  readonly title: string
  readonly detail: string

  constructor(status: number, title: string, detail: string) {
    super(detail ? `${title}: ${detail}` : title)
    this.name = 'ApiError'
    this.status = status
    this.title = title
    this.detail = detail
  }
}

/** How http.ts reaches the auth layer without importing React. */
export type AuthBridge = {
  /** A valid access token, refreshed if needed. Empty string when signed out. */
  getToken: () => Promise<string>
  /** Called on the first 401: drop the session and show `message`. */
  onUnauthorized: (message: string) => void
}

let bridge: AuthBridge | null = null

/** AuthProvider installs the bridge on mount. */
export function setAuthBridge(next: AuthBridge | null): void {
  bridge = next
}

/**
 * Joins path segments, escaping each one.
 *
 * Ids, namespaces and data-store keys all end up inside a URL path, and a key
 * is arbitrary text: without escaping, a `#` or a space would silently change
 * which resource is addressed.
 */
export function path(...segments: string[]): string {
  return segments.map(encodeURIComponent).join('/')
}

export type ApiInit = RequestInit & {
  /** Send no Authorization header (GET /config is anonymous). */
  anonymous?: boolean
  /** Statuses to hand back instead of throwing, e.g. [404]. */
  allowStatus?: number[]
}

/** RFC 7807 ProblemDetails, or the license gate's `{ error, message }`. */
type ErrorBody = {
  title?: string
  detail?: string
  error?: string
  message?: string
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorBody | null = null
  try {
    body = (await response.json()) as ErrorBody | null
  } catch {
    // Empty or non-JSON error body: fall back to the status text.
  }
  // `||` and not `??`: an empty title is as useless as a missing one, and
  // `statusText` is always '' over HTTP/2, so the status number is the floor.
  const title = body?.title || body?.error || response.statusText || `HTTP ${response.status}`
  const detail = body?.detail || body?.message || ''
  return new ApiError(response.status, title, detail)
}

/** Raw request against `{server}/api/v1{route}`. Throws ApiError on failure. */
export async function apiRequest(route: string, init: ApiInit = {}): Promise<Response> {
  const { anonymous, allowStatus, headers, ...rest } = init

  const merged = new Headers(headers)
  merged.set('Accept', 'application/json')
  if (!anonymous) {
    const token = (await bridge?.getToken()) ?? ''
    // No token means the session is already gone: the auth layer has said so
    // once, and a second unauthenticated round trip would only replace its
    // message with another one.
    if (!token) {
      throw new ApiError(401, 'Signed out', 'Sign in again to continue.')
    }
    merged.set('Authorization', `Bearer ${token}`)
  }

  let response: Response
  try {
    response = await fetch(`${apiUrl}${route}`, { ...rest, headers: merged, mode: 'cors' })
  } catch {
    throw new ApiError(0, 'VIM Server is unreachable', 'Check the network and try again.')
  }

  // An authenticated call that comes back 401 means the session is over.
  if (response.status === 401 && !anonymous) {
    bridge?.onUnauthorized('Your session has expired. Sign in again to continue.')
  }
  if (!response.ok && !allowStatus?.includes(response.status)) {
    throw await toApiError(response)
  }
  return response
}

/** Request that returns parsed JSON. */
export async function apiFetch<T>(route: string, init: ApiInit = {}): Promise<T> {
  const response = await apiRequest(route, init)
  return (await response.json()) as T
}

/** JSON body plus the headers a JSON write needs. */
export function jsonBody(value: unknown): ApiInit {
  return { body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } }
}
