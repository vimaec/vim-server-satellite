import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { listAccessibleProjects, type OrgProjects } from '../api/vimServer'
import type { BlobSummary } from '../api/types'
import { Banner, Button, Card, Chip, Empty, Label, cx } from '../ds'
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
        <Label as="h1" variant="title">
          Projects
        </Label>
        <div className="topbar-right">
          <Label className="user" variant="dim" truncate data-testid="user-name">
            {auth.session?.name ?? ''}
          </Label>
          <Button variant="ghost" data-testid="sign-out" onClick={auth.signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="scroll">
        <div className="picker">
          {error ? (
            <Banner tone="bad" role="alert">
              {error}
            </Banner>
          ) : null}
          {!groups && !error ? <Label variant="dim">Loading projects…</Label> : null}
          {groups?.length === 0 ? <Empty title="You are not a member of any organisation." /> : null}

          {groups?.map((group) => (
            <Card
              key={group.org.id}
              title={group.org.name}
              titleAs="h2"
              sub={group.org.role}
              data-testid="org-group"
              data-org-id={group.org.id}
            >
              {group.projects.length === 0 ? (
                <Label variant="dim">No projects.</Label>
              ) : (
                <ul className="ds-list ds-list--selectable projects">
                  {group.projects.map((project) => {
                    const vim = project.latestVim
                    return (
                      <li key={project.id}>
                        <button
                          type="button"
                          className={cx('ds-list__item project', !vim && 'ds-list__item--dim')}
                          data-testid="project-item"
                          data-project-id={project.id}
                          aria-disabled={vim ? undefined : true}
                          disabled={!vim}
                          onClick={() => onOpen(project.id)}
                        >
                          <span className="ds-list__label">{project.name}</span>
                          <span className="ds-list__meta">{vim ? snapshotLine(vim) : 'No VIM yet'}</span>
                          <Chip>{project.role}</Chip>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}
