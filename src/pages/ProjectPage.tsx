import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getProject, getProjectRole, getVimDownloadUrl, getVimHistory } from '../api/vimServer'
import type { BlobSummary } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { setDebugAssignments, setDebugColors, setDebugSelection } from '../debug'
import { labelColors } from '../labels/colors'
import { LabelPanel } from '../labels/LabelPanel'
import { useLabels } from '../labels/useLabels'
import { buildModel } from '../tree/buildModel'
import type { ModelElement } from '../tree/buildModel'
import { ElementTree } from '../tree/ElementTree'
import type { SelectMode } from '../tree/ElementTree'
import { ViewerPane } from '../viewer/ViewerPane'
import type { ViewerStatus } from '../viewer/ViewerPane'

/** What the viewer needs: the snapshot's time-limited SAS URL. */
type Source = { url: string }

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/**
 * The project workspace: element tree and labels on the left, the 3D viewer on
 * the right. This page owns the two pieces of state both sides share — the
 * selection and the loaded model — so neither pane has to know about the other.
 */
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
  const [sourceError, setSourceError] = useState('')

  const [selection, setSelection] = useState<number[]>([])
  const [model, setModel] = useState<ModelElement[]>([])
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus>('idle')

  const labels = useLabels(projectId, role)
  const frameRef = useRef<(() => void) | null>(null)
  /** Guards against an older buildModel() finishing after a newer one. */
  const modelTokenRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    setSource(undefined)
    setSourceError('')
    setSelection([])
    setModel([])

    void (async () => {
      try {
        const [detail, projectRole, vim] = await Promise.all([
          getProject(projectId),
          // The role only gates the label editor, so a failure here falls back
          // to the least privilege rather than failing the page.
          getProjectRole(projectId).catch(() => ({ projectId, role: 'Viewer' })),
          getVimHistory(projectId),
        ])
        if (cancelled) return
        setName(detail.name)
        setRole(projectRole.role)
        setSnapshot(vim.latest)
        if (!vim.latest) return

        // redirect=false returns the SAS URL as JSON; the viewer loads it
        // directly, and no Authorization header may be sent to blob storage.
        const download = await getVimDownloadUrl(projectId)
        if (cancelled) return
        setSource({ url: download.url })
      } catch (cause: unknown) {
        if (cancelled) return
        setSourceError(cause instanceof Error ? cause.message : 'Could not open this project.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectId])

  const onVimLoaded = useCallback((vim: Parameters<typeof buildModel>[0] | undefined) => {
    const token = ++modelTokenRef.current
    setSelection([])
    if (!vim) {
      setModel([])
      return
    }
    void buildModel(vim).then((elements) => {
      if (token === modelTokenRef.current) setModel(elements)
    })
  }, [])

  const selectElements = useCallback((indices: number[], mode: SelectMode) => {
    setSelection((previous) => {
      if (mode === 'replace') return indices
      const next = new Set(previous)
      for (const index of indices) {
        if (mode === 'add' || !next.has(index)) next.add(index)
        else next.delete(index)
      }
      return [...next]
    })
  }, [])

  const elementByIndex = useMemo(
    () => new Map(model.map((element) => [element.index, element])),
    [model],
  )
  const selectedElements = useMemo(
    () =>
      selection
        .map((index) => elementByIndex.get(index))
        .filter((element): element is ModelElement => element !== undefined),
    [elementByIndex, selection],
  )
  const colors = useMemo(
    () => labelColors(labels.assignments, labels.palette, model),
    [labels.assignments, labels.palette, model],
  )

  // Feed the read-only debug hook the tests read.
  useEffect(() => setDebugSelection(selection), [selection])
  useEffect(() => setDebugColors(colors), [colors])
  useEffect(() => setDebugAssignments(labels.assignments), [labels.assignments])

  const frame = useCallback(() => frameRef.current?.(), [])

  // Clicking a row in the labelled list selects and frames that element. The
  // camera has to move after the viewer has the new selection, so it is done in
  // an effect: a child's effects run before its parent's, which means
  // ViewerPane has already pushed the selection by the time this runs.
  const [frameRequest, setFrameRequest] = useState(0)
  const pickElement = useCallback((index: number) => {
    setSelection([index])
    setFrameRequest((request) => request + 1)
  }, [])
  useEffect(() => {
    if (frameRequest > 0) frameRef.current?.()
  }, [frameRequest])

  const treePlaceholder =
    viewerStatus === 'loading'
      ? 'Loading the model…'
      : viewerStatus === 'idle'
        ? 'No VIM in this project yet.'
        : undefined

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
          <ElementTree
            elements={model}
            selection={selection}
            colors={colors}
            onSelect={selectElements}
            onFrame={frame}
            placeholder={treePlaceholder}
          />
          <LabelPanel
            labels={labels.palette.labels}
            assignments={labels.assignments}
            elements={model}
            status={labels.status}
            error={labels.error}
            canWrite={labels.canWrite}
            selectionCount={selectedElements.length}
            onApply={(labelId) => labels.applyLabel(labelId, selectedElements)}
            onRemove={() => labels.removeLabel(selectedElements)}
            onAdd={labels.addLabel}
            onDelete={labels.deleteLabel}
            onPick={pickElement}
          />
        </aside>

        <ViewerPane
          source={source}
          sourceError={sourceError}
          selection={selection}
          colors={colors}
          onVimLoaded={onVimLoaded}
          onSelectionChanged={setSelection}
          onStatus={setViewerStatus}
          frameRef={frameRef}
        />
      </div>
    </main>
  )
}
