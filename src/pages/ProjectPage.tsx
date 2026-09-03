import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { getProject, getProjectRole, getVimDownloadUrl, getVimHistory } from '../api/vimServer'
import type { BlobSummary } from '../api/types'

/**
 * Phase 1: the header and the two-pane frame are real; both panes are
 * placeholders. The download URL is already resolved here, because that is
 * what Phase 2's ViewerPane will be handed as its `source`.
 */
type Source = { url: string }

/**
 * Phase 1 states. `ready` means "the snapshot URL is resolved"; Phase 2 replaces
 * it with the viewer's own `loading` / `loaded` states.
 */
type ViewerState = 'idle' | 'loading' | 'ready' | 'error'

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export function ProjectPage({
  projectId,
  onBack,
}: {
  projectId: string
  onBack: () => void
}): JSX.Element {
  const auth = useAuth()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [snapshot, setSnapshot] = useState<BlobSummary | null>(null)
  const [source, setSource] = useState<Source | undefined>(undefined)
  const [viewerState, setViewerState] = useState<ViewerState>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setViewerState('loading')
    setSource(undefined)
    setError('')

    void (async () => {
      try {
        const [detail, projectRole, vim] = await Promise.all([
          getProject(projectId),
          // The role only gates the (Phase 2) label editor, so a failure here
          // falls back to the least privilege rather than failing the page.
          getProjectRole(projectId).catch(() => ({ projectId, role: 'Viewer' })),
          getVimHistory(projectId),
        ])
        if (cancelled) return
        setName(detail.name)
        setRole(projectRole.role)
        setSnapshot(vim.latest)

        if (!vim.latest) {
          setViewerState('idle')
          return
        }
        // redirect=false returns the SAS URL as JSON; the viewer needs the URL
        // itself, and no Authorization header may be sent to blob storage.
        const download = await getVimDownloadUrl(projectId)
        if (cancelled) return
        setSource({ url: download.url })
        setViewerState('ready')
      } catch (cause: unknown) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : 'Could not open this project.')
        setViewerState('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectId])

  return (
    <main className="page" data-testid="project-page">
      <header className="topbar">
        <button type="button" data-testid="back-to-projects" onClick={onBack}>
          ← Projects
        </button>
        <h1 data-testid="project-title">{name || 'Project'}</h1>
        {snapshot ? (
          <span className="tag" data-testid="snapshot-tag" title={formatDate(snapshot.created)}>
            {snapshot.versionTag}
          </span>
        ) : (
          <span className="tag muted" data-testid="snapshot-tag">
            no VIM
          </span>
        )}
        <span className="badge" data-testid="role-badge">
          {role || '…'}
        </span>
        <div className="topbar-right">
          <span className="user" data-testid="user-name">
            {auth.session?.name ?? ''}
          </span>
          <button type="button" data-testid="sign-out" onClick={auth.signOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="panes">
        <aside className="side-pane" data-testid="side-pane">
          <p className="muted">Element tree and labels come here</p>
        </aside>

        {/* The viewer wrapper must be position:relative — vim-web pins its own
            canvas to inset:0 inside this box (Phase 2). */}
        <div className="viewer-pane" data-testid="viewer-pane">
          <div className="viewer-status" data-testid="viewer-status" data-state={viewerState}>
            {viewerState === 'idle' ? 'No VIM in this project yet.' : null}
            {viewerState === 'loading' ? 'Resolving the snapshot download URL…' : null}
            {viewerState === 'ready' ? (
              <>
                <strong>Snapshot ready.</strong>
                <span className="url">{source?.url}</span>
                <span className="muted small">The viewer arrives in Phase 2.</span>
              </>
            ) : null}
            {viewerState === 'error' ? <span className="error">{error}</span> : null}
          </div>
        </div>
      </div>
    </main>
  )
}
