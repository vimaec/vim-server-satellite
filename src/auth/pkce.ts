/**
 * The few crypto helpers the PKCE flow needs.
 *
 * PKCE is written by hand instead of using MSAL: the flow is ~60 lines, and a
 * sample app that shows the actual HTTP exchange is easier to port to another
 * stack than one that hides it behind a library.
 */

/** RFC 4648 §5 base64url: standard base64 with `+/` swapped and padding removed. */
export function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A URL-safe random string built from `n` random bytes. */
export function randomUrlSafe(n: number): string {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

/** base64url(SHA-256(text)) — the S256 code challenge. */
export async function sha256url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return base64url(new Uint8Array(digest))
}

/** Reads the claims out of a JWT payload without verifying it (display only). */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  } catch {
    return {}
  }
}
