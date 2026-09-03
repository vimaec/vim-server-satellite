import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { listAccessibleProjects, type OrgProjects } from '../api/vimServer'
import type { BlobSummary } from '../api/types'
import { formatDate } from '../format'

/** "3.2 MB", for the snapshot line under a project name. */
function formatSize(bytes: number): string {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function snapshotLine(vim: BlobSummary): string {
  return `${vim.versionTag} · ${formatDate(vim.created)} · ${formatSize(vim.sizeInBytes)}`
}

/**
 * Lists every project the user can reach. There is no "all projects" endpoint,
 * so this is the organisations list fanned out over their project lists.
 */
export function ProjectPickerPage({ onOpen }: { onOpen: (projectId: string) => void }): JSX.Element {
  const auth = useAuth()
  const [groups, setGroups] = useState<OrgProjects[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    listAccessibleProjects()
      .then((result) => {
        if (!cancelled) setGroups(result)
      })
      .catch((cause: unknown) => {
        // A 401 is already handled by the auth layer, which returns to sign-in.
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load projects.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="page" data-testid="project-picker">
      <header className="topbar">
        <h1>Projects</h1>
        <div className="topbar-right">
          <span className="user" data-testid="user-name">
            {auth.session?.name ?? ''}
          </span>
          <button type="button" data-testid="sign-out" onClick={auth.signOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="scroll">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {!groups && !error ? <p className="muted">Loading projects…</p> : null}
        {groups?.length === 0 ? <p className="muted">You are not a member of any organisation.</p> : null}

        {groups?.map((group) => (
          <section className="org" key={group.org.id} data-testid="org-group" data-org-id={group.org.id}>
            <h2>
              {group.org.name} <span className="muted small">{group.org.role}</span>
            </h2>
            {group.projects.length === 0 ? (
              <p className="muted small">No projects.</p>
            ) : (
              <ul className="projects">
                {group.projects.map((project) => {
                  const vim = project.latestVim
                  return (
                    <li key={project.id}>
                      <button
                        type="button"
                        className="project"
                        data-testid="project-item"
                        data-project-id={project.id}
                        aria-disabled={vim ? undefined : true}
                        disabled={!vim}
                        onClick={() => onOpen(project.id)}
                      >
                        <span className="project-name">{project.name}</span>
                        <span className="muted small">
                          {vim ? snapshotLine(vim) : 'No VIM yet'}
                        </span>
                        <span className="badge">{project.role}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  )
}
