/**
 * Holds the session and hands out access tokens.
 *
 * On mount it does three things in order: ask the server which Entra app
 * registration to use, finish a sign-in that is arriving in the URL fragment,
 * and otherwise restore the session from localStorage.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { fallbackEntraConfig, makeEntraConfig, type EntraConfig } from '../config'
import { setAuthBridge } from '../api/http'
import { getConfig, getProfileIfAuthorized } from '../api/vimServer'
import {
  beginSignIn,
  clearSession,
  completeSignInFromHash,
  readSession,
  refreshIfNeeded,
  writeSession,
  type Session,
} from './entra'

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

export type Auth = {
  status: AuthStatus
  session: Session | null
  /** Message shown on the sign-in page: a failed sign-in or an expired session. */
  error: string
  signIn: () => void
  signInWithToken: (pat: string) => Promise<void>
  signOut: () => void
  /** A usable access token, refreshed if needed. Empty string when signed out. */
  getToken: () => Promise<string>
}

const AuthContext = createContext<Auth | null>(null)

/** A personal access token has no expiry we can read, so assume a year. */
const PAT_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState('')

  // Refs so getToken stays a stable callback that still sees the latest values.
  const sessionRef = useRef<Session | null>(null)
  const configRef = useRef<EntraConfig>(fallbackEntraConfig)
  // A token being validated is not a session yet, but apiRequest must send it.
  const pendingToken = useRef('')

  const apply = useCallback((next: Session | null) => {
    sessionRef.current = next
    setSession(next)
    setStatus(next ? 'signed-in' : 'signed-out')
  }, [])

  const dropSession = useCallback(
    (message: string) => {
      clearSession()
      apply(null)
      setError(message)
    },
    [apply],
  )

  const getToken = useCallback(async (): Promise<string> => {
    if (pendingToken.current) return pendingToken.current
    const current = sessionRef.current
    if (!current) return ''
    const next = await refreshIfNeeded(configRef.current, current)
    if (!next) {
      dropSession('Your sign-in has expired. Sign in again to continue.')
      return ''
    }
    if (next !== current) apply(next)
    return next.access
  }, [apply, dropSession])

  // Declared before the bootstrap effect below, so http.ts can reach the auth
  // layer before the first API call goes out. All three callbacks are stable,
  // so this runs exactly once.
  useEffect(() => {
    setAuthBridge({ getToken, onUnauthorized: dropSession })
    return () => setAuthBridge(null)
  }, [getToken, dropSession])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // The server is the authority on the app registration; env vars are the fallback.
      const config = await getConfig()
        .then((c) => (c.tenantId && c.clientId ? makeEntraConfig(c.tenantId, c.clientId) : fallbackEntraConfig))
        .catch(() => fallbackEntraConfig)
      if (cancelled) return
      configRef.current = config

      const reply = await completeSignInFromHash(config)
      if (cancelled) return
      if (reply.kind === 'session') {
        apply(reply.session)
        return
      }
      if (reply.kind === 'error') {
        clearSession()
        apply(null)
        setError(reply.message)
        return
      }
      apply(readSession())
    })()
    return () => {
      cancelled = true
    }
  }, [apply])

  const signIn = useCallback(() => {
    setError('')
    void beginSignIn(configRef.current)
  }, [])

  const signInWithToken = useCallback(
    async (pat: string) => {
      const token = pat.trim()
      if (!token) {
        setError('Paste a personal access token first.')
        return
      }
      setError('')
      pendingToken.current = token
      try {
        const profile = await getProfileIfAuthorized()
        if (!profile) {
          setError('VIM Server rejected that token. Check it and try again.')
          return
        }
        const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ')
        const next: Session = {
          access: token,
          refresh: '',
          exp: Date.now() + PAT_LIFETIME_MS,
          name: name || profile.email || 'Access token',
          upn: profile.email ?? '',
          kind: 'pat',
        }
        writeSession(next)
        apply(next)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not reach VIM Server.')
      } finally {
        pendingToken.current = ''
      }
    },
    [apply],
  )

  const signOut = useCallback(() => {
    // No Entra end-session call: this only forgets the tokens in this browser.
    clearSession()
    apply(null)
    setError('')
  }, [apply])

  const value = useMemo<Auth>(
    () => ({ status, session, error, signIn, signInWithToken, signOut, getToken }),
    [status, session, error, signIn, signInWithToken, signOut, getToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
