import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { serverUrl } from '../config'

/**
 * Two ways in: a Microsoft sign-in (the normal one) and a VIM Server personal
 * access token, which keeps the sample usable where the redirect URI is not
 * registered yet.
 */
export function SignInPage(): JSX.Element {
  const auth = useAuth()
  const [showPat, setShowPat] = useState(false)
  const [pat, setPat] = useState('')
  const [busy, setBusy] = useState(false)

  const submitPat = async (): Promise<void> => {
    setBusy(true)
    try {
      await auth.signInWithToken(pat)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="centered" data-testid="signin-page">
      <section className="card">
        <h1>VIM Server Satellite</h1>
        <p className="muted">
          A sample app that opens a VIM Server project, shows its model and stores labels back on
          the project.
        </p>

        <button type="button" className="primary" data-testid="signin-microsoft" onClick={auth.signIn}>
          Sign in with Microsoft
        </button>

        {auth.error ? (
          <p className="error" role="alert" data-testid="signin-error">
            {auth.error}
          </p>
        ) : null}

        <button
          type="button"
          className="link"
          data-testid="signin-pat-toggle"
          aria-expanded={showPat}
          onClick={() => setShowPat((open) => !open)}
        >
          {showPat ? 'Hide access token sign-in' : 'Use an access token instead'}
        </button>

        {showPat ? (
          <form
            className="pat-form"
            onSubmit={(event) => {
              event.preventDefault()
              void submitPat()
            }}
          >
            <label htmlFor="pat">Personal access token</label>
            <input
              id="pat"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a VIM Server token"
              data-testid="signin-pat-input"
              value={pat}
              onChange={(event) => setPat(event.target.value)}
            />
            <button type="submit" data-testid="signin-pat-submit" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in with token'}
            </button>
          </form>
        ) : null}

        <p className="muted small">Server: {serverUrl}</p>
      </section>
    </main>
  )
}
