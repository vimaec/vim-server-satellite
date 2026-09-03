import { useAuth } from '../auth/AuthProvider'
import { serverUrl } from '../config'

/**
 * One way in: Microsoft Entra ID. The button starts the PKCE redirect, and any
 * message from a failed or expired sign-in comes back here.
 */
export function SignInPage(): JSX.Element {
  const auth = useAuth()

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

        <p className="muted small">Server: {serverUrl}</p>
      </section>
    </main>
  )
}
