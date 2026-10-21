import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type * as VIM from 'vim-web'
import { getProject, getProjectRole, getVimDownloadUrl, getVimHistory } from '../api/vimServer'
import type { BlobSummary } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { setDebugColors, setDebugEstimate, setDebugSelection } from '../debug'
import { Button, Chip, Label, Menu } from '../ds'
import type { MenuEntry } from '../ds'
import { useEstimate } from '../estimate/useEstimate'
import { EstimateUiProvider, useEstimateUi } from '../estimate/ui/context'
import { CostDetails } from '../estimate/ui/CostDetails'
import { EstimatePanel } from '../estimate/ui/EstimatePanel'
import { elementMenu } from '../estimate/ui/menus'
import { useElementsView } from '../estimate/ui/useElementsView'
import { formatDateTime } from '../format'
import { ViewerPane } from '../viewer/ViewerPane'
import type { ViewerStatus, ViewerTexts } from '../viewer/ViewerPane'

type IWebglVim = VIM.Core.Webgl.IWebglVim

/** What the viewer needs: the snapshot's time-limited SAS URL. */
type Source = { url: string }

/** The panel's narrowest width, and the share of the window it starts with. */
const PANEL_MIN = 380
const PANEL_INITIAL = 0.46
/** The Cost Details pane's narrowest and starting widths. */
const DETAILS_MIN = 260
const DETAILS_INITIAL = 340
/** What the 3D view keeps however wide the two panes are dragged. */
const VIEWER_MIN = 240

/**
 * The project workspace: `[ estimate panel | 3D viewer | Cost Details ]` under
 * the top bar. This page owns what the panes share — the selection, the loaded
 * model, the estimate — so none of them has to know about the others.
 *
 * One instance per project (App keys it by the project id): nothing of one
 * project, its role above all, may survive into the next.
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
  /**
   * True while the project, the role and the snapshot list are still being
   * resolved. "No VIM in this project" is only true once they have answered.
   */
  const [resolving, setResolving] = useState(true)

  const [selection, setSelection] = useState<number[]>([])
  const [vim, setVim] = useState<IWebglVim | undefined>(undefined)
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus>('idle')

  const est = useEstimate(projectId, role, vim)
  const view = useElementsView(est)
  const frameElementsRef = useRef<((indices: number[]) => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    setSource(undefined)
    setSourceError('')
    setResolving(true)
    setSelection([])

    void (async () => {
      try {
        const [detail, projectRole, history] = await Promise.all([
          getProject(projectId),
          // The role only gates editing, so a failure here falls back to the
          // least privilege rather than failing the page.
          getProjectRole(projectId).catch(() => ({ projectId, role: 'Viewer' })),
          getVimHistory(projectId),
        ])
        if (cancelled) return
        setName(detail.name)
        setRole(projectRole.role)
        setSnapshot(history.latest)
        if (!history.latest) {
          setResolving(false)
          return
        }

        // redirect=false returns the SAS URL as JSON; the viewer loads it
        // directly, and no Authorization header may be sent to blob storage.
        const download = await getVimDownloadUrl(projectId)
        if (cancelled) return
        setSource({ url: download.url })
        setResolving(false)
      } catch (cause: unknown) {
        if (cancelled) return
        setSourceError(cause instanceof Error ? cause.message : 'Could not open this project.')
        setResolving(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectId])

  const onVimLoaded = useCallback((loaded: IWebglVim | undefined) => {
    setSelection([])
    setVim(loaded)
  }, [])

  const frameElements = useCallback((indices: number[]) => frameElementsRef.current?.(indices), [])

  // Feed the read-only debug hook the tests read.
  useEffect(() => setDebugSelection(selection), [selection])
  useEffect(() => setDebugColors(view.paint.colors), [view.paint.colors])
  useEffect(() => {
    setDebugEstimate(est.status === 'ready' ? est : null)
  }, [est])
  useEffect(() => () => setDebugEstimate(null), [])

  const { t } = est
  const viewerTexts = useMemo(
    (): ViewerTexts => ({
      idle: t('No VIM in this project yet.'),
      loading: t('Loading the snapshot…'),
      loaded: t('Loaded'),
      error: t('Could not load the snapshot.'),
      resolving: t('Opening the project…'),
    }),
    [t],
  )
  const modelPlaceholder = resolving
    ? t('Opening the project…')
    : sourceError || viewerStatus === 'error'
      ? undefined
      : viewerStatus === 'loading'
        ? t('Loading the model…')
        : viewerStatus === 'idle'
          ? t('No VIM in this project yet.')
          : undefined

  return (
    <main className="page" data-testid="project-page">
      <header className="topbar">
        <Button variant="ghost" icon="back" data-testid="back-to-projects" onClick={onBack}>
          {t('Projects')}
        </Button>
        <Label as="h1" variant="title" truncate data-testid="project-title">
          {name || t('Project')}
        </Label>
        {snapshot ? (
          <Chip data-testid="snapshot-tag" tip={formatDateTime(snapshot.created)}>
            {snapshot.versionTag}
          </Chip>
        ) : (
          <Chip data-testid="snapshot-tag">{resolving ? '…' : t('no VIM')}</Chip>
        )}
        <Chip data-testid="role-badge">{role || '…'}</Chip>
        <div className="topbar-right">
          <Label className="user" variant="dim" truncate data-testid="user-name">
            {auth.session?.name ?? ''}
          </Label>
          <Button variant="ghost" data-testid="sign-out" onClick={auth.signOut}>
            {t('Sign out')}
          </Button>
        </div>
      </header>

      <EstimateUiProvider
        est={est}
        view={view}
        selection={selection}
        setSelection={setSelection}
        frameElements={frameElements}
      >
        <Workspace
          modelPlaceholder={modelPlaceholder}
          viewer={(onContextMenu) => (
            <ViewerPane
              source={source}
              resolving={resolving}
              sourceError={sourceError}
              selection={selection}
              colors={view.paint.colors}
              hidden={est.hidden}
              onVimLoaded={onVimLoaded}
              onSelectionChanged={setSelection}
              onStatus={setViewerStatus}
              frameElementsRef={frameElementsRef}
              onContextMenu={onContextMenu}
              texts={viewerTexts}
            />
          )}
        />
      </EstimateUiProvider>
    </main>
  )
}

/**
 * The three panes and their two drag handles. Inside the estimate context, so
 * the 3D menu and the Cost Details pane can use its verbs.
 */
function Workspace(props: {
  modelPlaceholder?: string
  viewer: (onContextMenu: (x: number, y: number) => void) => JSX.Element
}): JSX.Element {
  const ui = useEstimateUi()
  const { t } = ui.est
  const panesRef = useRef<HTMLDivElement>(null)
  /** Null until dragged: the panel then keeps its share of the window. */
  const [panelWidth, setPanelWidth] = useState<number | null>(null)
  const [detailsWidth, setDetailsWidth] = useState(DETAILS_INITIAL)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const uiRef = useRef(ui)
  uiRef.current = ui

  const onViewerMenu = useCallback((x: number, y: number) => {
    const current = uiRef.current
    if (current.est.status !== 'ready') return
    const targets = current.selection
    setMenu({ x, y, items: elementMenu(current, targets, { copyFrom: targets.length === 1 ? targets[0] : null }) })
  }, [])

  /** A drag on a handle: `measure` turns the pointer's x into the pane's new width. */
  const drag = (measure: (x: number, box: DOMRect) => number, apply: (width: number) => void) =>
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const box = panesRef.current?.getBoundingClientRect()
      if (!box) return
      event.preventDefault()
      const handle = event.currentTarget
      handle.setPointerCapture(event.pointerId)
      handle.classList.add('ds-active')
      const onMove = (move: PointerEvent): void => apply(measure(move.clientX, box))
      const onUp = (): void => {
        handle.classList.remove('ds-active')
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    }

  const detailsRoom = detailsOpen ? detailsWidth : 0
  const panelDrag = drag(
    (x, box) => x - box.left,
    (width) => {
      const box = panesRef.current?.getBoundingClientRect()
      const max = (box?.width ?? Infinity) - detailsRoom - VIEWER_MIN
      setPanelWidth(Math.max(PANEL_MIN, Math.min(max, width)))
    },
  )
  const detailsDrag = drag(
    (x, box) => box.right - x,
    (width) => {
      const box = panesRef.current?.getBoundingClientRect()
      const panel = panelWidth ?? (box?.width ?? 0) * PANEL_INITIAL
      const max = (box?.width ?? Infinity) - Math.max(PANEL_MIN, panel) - VIEWER_MIN
      setDetailsWidth(Math.max(DETAILS_MIN, Math.min(Math.max(DETAILS_MIN, max), width)))
    },
  )

  return (
    <div className="panes" ref={panesRef}>
      <div
        className="en-side"
        style={{ width: panelWidth ?? `${PANEL_INITIAL * 100}%`, minWidth: PANEL_MIN }}
      >
        <EstimatePanel modelPlaceholder={props.modelPlaceholder} />
      </div>
      <div className="ds-split__handle" role="separator" aria-orientation="vertical" data-testid="panel-resizer" onPointerDown={panelDrag} />
      <div className="en-stage">
        {props.viewer(onViewerMenu)}
        {!detailsOpen && ui.selection.length > 0 ? (
          <div className="en-stage__float">
            <Button tip={t('Open the cost details panel')} data-testid="cost-details-open" onClick={() => setDetailsOpen(true)}>
              {t('Cost Details')}
            </Button>
          </div>
        ) : null}
      </div>
      {detailsOpen ? (
        <>
          <div className="ds-split__handle" role="separator" aria-orientation="vertical" data-testid="details-resizer" onPointerDown={detailsDrag} />
          <div className="en-details" style={{ width: detailsWidth }}>
            <CostDetails onClose={() => setDetailsOpen(false)} />
          </div>
        </>
      ) : null}
      <Menu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menu?.items ?? []}
        onClose={() => setMenu(null)}
        data-testid="context-menu"
      />
    </div>
  )
}
