/**
 * The one place that talks to VIM Server.
 *
 * Adds the bearer token and Accept header, turns error bodies into ApiError,
 * reports a 401 once to the auth layer so the app drops the session and
 * returns to the sign-in page with a message, and retries the transient
 * failures of the requests that are safe to send again.
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
  /**
   * The request is idempotent: sent twice, it leaves the server as sent once.
   * Then a transient failure (see RETRY_DELAYS_MS) is retried. Opt-in per
   * call, never guessed from the method: a PUT under `If-Match` is not safe to
   * send again blindly (the first one may have landed, and the second then
   * fails its own precondition), and its caller knows what to do instead.
   */
  retry?: boolean
}

/**
 * The waits before the retries of a `retry` request; their count is the
 * number of retries. Each wait gets up to 50 % random jitter, so the requests
 * of one burst do not all come back at the same moment.
 *
 * Why retry: under load VIM Server sometimes answers an API call, on any
 * replica, with a 5xx or with a 302 to login.microsoftonline.com (its OIDC
 * challenge, meant for a browser that navigates, not for a bearer-token API
 * call). That redirect carries no CORS headers, so the browser reports a CORS
 * error and fetch() rejects with a TypeError: the page never sees a status.
 * The CORS error is only the browser's symptom; the same request sent again a
 * moment later goes through.
 */
const RETRY_DELAYS_MS = [500, 1000, 2000]

/** Statuses that say "not now" rather than "no": overload, a bad gateway, rate limiting. */
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504])

/**
 * Whether a failure says "not now" rather than "no": no answer at all, or a
 * transient status. For a caller that does not retry blindly but needs to know
 * whether its write may have landed.
 */
export function isTransient(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.status === 0 || TRANSIENT_STATUS.has(cause.status))
}

function backoff(attempt: number): Promise<void> {
  const base = RETRY_DELAYS_MS[attempt]
  return new Promise((resolve) => setTimeout(resolve, base + Math.random() * base * 0.5))
}

/**
 * fetch() rejected: no HTTP answer the page may read. Offline, DNS, a reset,
 * or the server's sign-in redirect under load (see RETRY_DELAYS_MS).
 */
function noAnswer(): ApiError {
  return new ApiError(0, 'VIM Server did not answer', 'Network error or server overload. Try again.')
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
  const { anonymous, allowStatus, retry, headers, ...rest } = init

  for (let attempt = 0; ; attempt++) {
    const again = retry === true && attempt < RETRY_DELAYS_MS.length

    // The token is read for each attempt: a retry seconds later may need the
    // refreshed one, and a session dropped meanwhile ends the retries here.
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
    } catch (cause: unknown) {
      // The caller cancelled: that is no failure, so neither retry nor report it as one.
      if (rest.signal?.aborted) throw cause
      if (again) {
        await backoff(attempt)
        continue
      }
      throw noAnswer()
    }

    // A transient status is retried unless the caller asked for it back. A
    // 401 is never transient: it keeps meaning "the session is over" (below).
    if (again && TRANSIENT_STATUS.has(response.status) && !allowStatus?.includes(response.status)) {
      // Nobody reads this body: let the connection go.
      void response.body?.cancel().catch(() => undefined)
      await backoff(attempt)
      continue
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
