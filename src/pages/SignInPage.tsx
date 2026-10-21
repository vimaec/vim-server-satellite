import { useAuth } from '../auth/AuthProvider'
import { serverUrl } from '../config'
import { Banner, Button, Card, Label } from '../ds'

/**
 * One way in: Microsoft Entra ID. The button starts the PKCE redirect, and any
 * message from a failed or expired sign-in comes back here.
 */
export function SignInPage(): JSX.Element {
  const auth = useAuth()

  return (
    <main className="centered" data-testid="signin-page">
      <Card className="signin-card" title="VIM Server Satellite" titleAs="h1">
        <Label as="p" variant="body">
          A sample app that opens a VIM Server project, shows its model, and keeps a cost estimate of
          its elements in the project's data store.
        </Label>

        <Button variant="primary" data-testid="signin-microsoft" onClick={auth.signIn}>
          Sign in with Microsoft
        </Button>

        {auth.error ? (
          <Banner tone="bad" role="alert" data-testid="signin-error">
            {auth.error}
          </Banner>
        ) : null}

        <Label as="p" variant="dim">
          Server: {serverUrl}
        </Label>
      </Card>
    </main>
  )
}
