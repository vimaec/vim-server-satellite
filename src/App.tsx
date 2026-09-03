/**
 * The whole app is one small state machine: loading -> sign-in -> picker -> project.
 *
 * There is no router. The only navigable piece of state is the chosen project,
 * kept in the query string as `?project=<id>` so a reload comes back to it.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { basePath } from './config'
import { setDebugState } from './debug'
import { ProjectPage } from './pages/ProjectPage'
import { ProjectPickerPage } from './pages/ProjectPickerPage'
import { SignInPage } from './pages/SignInPage'

type AppState = 'loading' | 'sign-in' | 'picker' | 'project'

function readProjectFromUrl(): string {
  return new URLSearchParams(location.search).get('project') ?? ''
}

function writeProjectToUrl(projectId: string): void {
  const query = projectId ? `?project=${encodeURIComponent(projectId)}` : ''
  history.pushState(null, '', `${basePath}${query}`)
}

export function App(): JSX.Element {
  const auth = useAuth()
  const [projectId, setProjectId] = useState(readProjectFromUrl)

  // Browser Back/Forward moves between the picker and a project.
  useEffect(() => {
    const onPopState = (): void => setProjectId(readProjectFromUrl())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const openProject = useCallback((id: string) => {
    setProjectId(id)
    writeProjectToUrl(id)
  }, [])

  const closeProject = useCallback(() => {
    setProjectId('')
    writeProjectToUrl('')
  }, [])

  // A signed-out user has no project; drop a stale deep link from the URL.
  useEffect(() => {
    if (auth.status === 'signed-out' && readProjectFromUrl()) {
      setProjectId('')
      history.replaceState(null, '', basePath)
    }
  }, [auth.status])

  const state: AppState =
    auth.status === 'loading'
      ? 'loading'
      : auth.status === 'signed-out'
        ? 'sign-in'
        : projectId
          ? 'project'
          : 'picker'

  useEffect(() => setDebugState(state), [state])

  if (state === 'loading') {
    return (
      <main className="centered" data-testid="app-loading">
        <p className="muted">Starting…</p>
      </main>
    )
  }
  if (state === 'sign-in') return <SignInPage />
  if (state === 'project') return <ProjectPage projectId={projectId} onBack={closeProject} />
  return <ProjectPickerPage onOpen={openProject} />
}
