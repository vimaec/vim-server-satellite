/**
 * Owns the one and only vim-web viewer.
 *
 * The viewer is expensive (a WebGL context, its own React UI) so it is created
 * once, lives for as long as the project page, and is handed new work through
 * props: a `source` to load, a controlled `selection`, a map of color
 * overrides and the set of hidden elements. Everything the user does in the 3D
 * view leaves through `onSelectionChanged` and `onContextMenu`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as VIM from 'vim-web'

type ViewerApi = VIM.React.Webgl.ViewerApi
type IWebglVim = VIM.Core.Webgl.IWebglVim
type IWebglLoadRequest = VIM.Core.Webgl.IWebglLoadRequest

/** What `viewer-status` reports. */
export type ViewerStatus = 'idle' | 'loading' | 'loaded' | 'error'

export type ViewerPaneProps = {
  /** The snapshot to show. Undefined means "nothing to load". */
  source: { url: string } | undefined
  /**
   * True while the page is still working out which snapshot to show. Undefined
   * `source` then means "not known yet" rather than "this project has no VIM".
   */
  resolving?: boolean
  /** A failure that happened before the viewer got involved (no download URL). */
  sourceError?: string
  /** Element indices that should be selected. Applied to the viewer. */
  selection: number[]
  /** Element index -> `#rrggbb`. Elements not listed get their model color back. */
  colors: Map<number, string>
  /** Element indices to hide in 3D (the estimate's excluded elements). The others are shown. */
  hidden: Set<number>
  onVimLoaded: (vim: IWebglVim | undefined) => void
  onSelectionChanged: (indices: number[]) => void
  onStatus: (status: ViewerStatus) => void
  /** The status texts, in the page's language (English by default). */
  texts?: ViewerTexts
  /**
   * Filled in with a "fit the camera to these elements" function, for the Cost
   * Details camera toggle: it frames the element it shows, which is not
   * necessarily the whole selection.
   */
  frameElementsRef?: { current: ((indices: number[]) => void) | null }
  /**
   * A right-click (not a right-drag, which turns the camera) in the 3D view, at
   * this viewport position. The page opens its own menu there; vim-web's menu
   * is switched off, and the selection does not change.
   */
  onContextMenu?: (x: number, y: number) => void
}

/** What the status line says in each state, and while the page still resolves the snapshot. */
export type ViewerTexts = Record<ViewerStatus, string> & { resolving: string }

const DEFAULT_TEXTS: ViewerTexts = {
  idle: 'No VIM in this project yet.',
  loading: 'Loading the snapshot…',
  loaded: 'Loaded',
  error: 'Could not load the snapshot.',
  resolving: 'Opening the project…',
}

/** The element indices currently selected in the viewer. */
function selectedIndices(viewer: ViewerApi): number[] {
  return viewer.core.selection
    .getAll()
    .filter(VIM.Core.Webgl.isElement3D)
    .map((item) => item.element)
    .filter((index): index is number => index !== undefined)
}

function sameIndices(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((index) => set.has(index))
}

/**
 * Sends a right-click in the 3D view to `open` (viewport coordinates) instead
 * of vim-web's own menu, which has no setting to turn it off. Returns the undo.
 *
 * vim-web tells a click from a drag on pointer-up; the browser's `contextmenu`
 * event comes before that on macOS / Linux and after it on Windows. A menu
 * opened before that event would catch it on its backdrop and close at once,
 * so the menu opens on whichever of the two comes second. The browser's own
 * menu is always suppressed over the 3D view.
 */
function routeContextMenu(
  viewer: ViewerApi,
  host: HTMLElement,
  open: (x: number, y: number) => void,
): () => void {
  /** When the browser last fired `contextmenu` over the viewer. */
  let nativeAt = -Infinity
  let pending: { x: number; y: number } | null = null
  let timer = 0
  const flush = (): void => {
    window.clearTimeout(timer)
    const at = pending
    pending = null
    if (at) open(at.x, at.y)
  }
  const onNative = (event: MouseEvent): void => {
    event.preventDefault()
    nativeAt = performance.now()
    if (pending) flush()
  }
  host.addEventListener('contextmenu', onNative)
  const restore = viewer.core.inputs.mouse.override({
    // vim-web's own handler (`original`) shows its menu: it is never called.
    onContextMenu: (_original, pos) => {
      const rect = viewer.core.viewport.canvas.getBoundingClientRect()
      pending = { x: rect.left + pos.x * rect.width, y: rect.top + pos.y * rect.height }
      if (performance.now() - nativeAt < 1000) flush()
      // No contextmenu event on its way (it can be swallowed): open anyway.
      else timer = window.setTimeout(flush, 300)
    },
  })
  return () => {
    window.clearTimeout(timer)
    host.removeEventListener('contextmenu', onNative)
    restore()
  }
}

export function ViewerPane({
  source,
  resolving,
  sourceError,
  selection,
  colors,
  hidden,
  onVimLoaded,
  onSelectionChanged,
  onStatus,
  texts = DEFAULT_TEXTS,
  frameElementsRef,
  onContextMenu,
}: ViewerPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<ViewerApi | undefined>(undefined)
  const vimRef = useRef<IWebglVim | undefined>(undefined)
  const unsubRef = useRef<(() => void) | undefined>(undefined)
  /** The load in flight, so a superseded one can be told to stop downloading. */
  const requestRef = useRef<IWebglLoadRequest | undefined>(undefined)
  /** Monotonic: an older load that finishes late must not overwrite a newer one. */
  const loadIdRef = useRef(0)
  /**
   * True while this component is pushing a selection into the viewer. The viewer
   * answers every select() with onSelectionChanged; without this guard that echo
   * would travel back up to the parent as if the user had clicked in 3D.
   */
  const applyingSelfRef = useRef(false)
  /**
   * The color this pane last gave each element index. Assigning `element.color`
   * walks that element's meshes, so a changed color must not repaint the other
   * thousands of elements that did not move.
   */
  const coloredRef = useRef<Map<number, string>>(new Map())
  /** What this pane last hid, for the same reason: only the elements that changed are touched. */
  const hiddenRef = useRef<Set<number>>(new Set())

  const [status, setStatus] = useState<ViewerStatus>('idle')
  const [loadError, setLoadError] = useState('')
  /** Bumped on every load so the color, visibility and selection effects rerun for the new vim. */
  const [vimEpoch, setVimEpoch] = useState(0)

  // The viewer outlives every prop, so its subscriptions read the newest
  // handlers from a ref instead of the ones captured when it was created.
  const handlers = useRef({ onVimLoaded, onSelectionChanged, onContextMenu })
  useEffect(() => {
    handlers.current = { onVimLoaded, onSelectionChanged, onContextMenu }
  }, [onVimLoaded, onSelectionChanged, onContextMenu])

  const shownStatus: ViewerStatus = sourceError ? 'error' : resolving ? 'loading' : status
  useEffect(() => onStatus(shownStatus), [onStatus, shownStatus])

  const ensureViewer = useCallback(async (): Promise<ViewerApi | undefined> => {
    if (viewerRef.current) return viewerRef.current
    const host = hostRef.current
    if (!host) return undefined

    const viewer = await VIM.React.Webgl.createViewer(host, {
      // The app draws its own tree and estimate panel, so the built-in panels
      // are off. Local storage is off too: a persisted setting from the built-in
      // settings panel would otherwise override what is passed here.
      ui: { panelBimTree: false, panelBimInfo: false, miscProjectInspector: false },
      isolation: { autoIsolate: false },
      capacity: { canReadLocalStorage: false },
    })
    if (!hostRef.current) {
      // Unmounted while createViewer was awaiting.
      viewer.dispose()
      return undefined
    }
    viewerRef.current = viewer

    const unsubSelection = viewer.core.selection.onSelectionChanged.sub(() => {
      if (applyingSelfRef.current) return
      handlers.current.onSelectionChanged(selectedIndices(viewer))
    })
    const unsubMenu = routeContextMenu(viewer, hostRef.current, (x, y) =>
      handlers.current.onContextMenu?.(x, y),
    )
    unsubRef.current = () => {
      unsubSelection()
      unsubMenu()
    }

    return viewer
  }, [])

  /** Drops the loaded snapshot. Never dispose a vim directly; unload it. */
  const unloadAll = useCallback((): void => {
    const viewer = viewerRef.current
    if (viewer) for (const vim of [...viewer.core.vims]) viewer.unload(vim)
    vimRef.current = undefined
    coloredRef.current = new Map()
    hiddenRef.current = new Set()
    handlers.current.onVimLoaded(undefined)
  }, [])

  // Load whenever the source changes. Bumping the load id in the cleanup makes
  // an in-flight load a no-op once it is superseded or the pane goes away.
  useEffect(() => {
    const loadId = ++loadIdRef.current

    void (async () => {
      if (!source) {
        // Nothing to show any more: the previous model has to go, or it would
        // sit in the view under a status that says there is no VIM.
        unloadAll()
        setLoadError('')
        setStatus('idle')
        return
      }
      setStatus('loading')
      setLoadError('')
      try {
        const viewer = await ensureViewer()
        if (!viewer || loadId !== loadIdRef.current) return

        // Only one snapshot at a time.
        unloadAll()

        // prewarmBim caches the BIM parameter columns in the background, which
        // is what the estimate's quantities read right after this.
        const request = viewer.load({ url: source.url }, { prewarmBim: true })
        requestRef.current = request
        const result = await request.getResult()
        // Only if it is still the current one: a newer load may have replaced it.
        if (requestRef.current === request) requestRef.current = undefined
        if (loadId !== loadIdRef.current) {
          if (result.isSuccess) viewer.unload(result.vim)
          return
        }
        if (!result.isSuccess) {
          setLoadError(result.details ? `${result.error}: ${result.details}` : result.error)
          setStatus('error')
          return
        }
        vimRef.current = result.vim
        coloredRef.current = new Map()
        hiddenRef.current = new Set()
        setVimEpoch((epoch) => epoch + 1)
        handlers.current.onVimLoaded(result.vim)
        setStatus('loaded')
      } catch (cause: unknown) {
        if (loadId !== loadIdRef.current) return
        setLoadError(cause instanceof Error ? cause.message : String(cause))
        setStatus('error')
      }
    })()

    return () => {
      loadIdRef.current++
      // The loader keeps issuing Range requests until it is told to stop, and
      // retries failures forever, so a superseded load must be aborted.
      const request = requestRef.current
      requestRef.current = undefined
      if (request && !request.isCompleted) request.abort()
    }
  }, [ensureViewer, source, unloadAll])

  // Push the controlled selection into the viewer. Selections that came out of
  // the viewer in the first place compare equal here, so they cost nothing.
  useEffect(() => {
    const viewer = viewerRef.current
    const vim = vimRef.current
    if (!viewer || !vim) return
    if (sameIndices(selectedIndices(viewer), selection)) return

    const objects = selection
      .map((index) => vim.getElementFromIndex(index))
      .filter((element): element is NonNullable<typeof element> => element !== undefined)

    applyingSelfRef.current = true
    try {
      if (objects.length === 0) viewer.core.selection.clear()
      else viewer.core.selection.select(objects)
    } finally {
      applyingSelfRef.current = false
    }
  }, [selection, vimEpoch])

  // Apply the colors, one element at a time and only where they changed: what
  // entered the map, what left it, and what kept its index but changed color.
  // An element that left the map is reset to undefined, which puts its model
  // color back. No re-render call is needed.
  useEffect(() => {
    const vim = vimRef.current
    if (!vim) return
    const previous = coloredRef.current

    for (const [index, color] of colors) {
      if (previous.get(index) === color) continue
      const element = vim.getElementFromIndex(index)
      if (element) element.color = new VIM.THREE.Color(color)
    }
    for (const index of previous.keys()) {
      if (colors.has(index)) continue
      const element = vim.getElementFromIndex(index)
      if (element) element.color = undefined
    }
    coloredRef.current = new Map(colors)
  }, [colors, vimEpoch])

  // Hide the excluded elements, touching only those whose state changed (as the
  // colors above): including one element must not walk the whole model.
  useEffect(() => {
    const vim = vimRef.current
    if (!vim) return
    const previous = hiddenRef.current
    for (const index of hidden) {
      if (previous.has(index)) continue
      const element = vim.getElementFromIndex(index)
      if (element) element.visible = false
    }
    for (const index of previous) {
      if (hidden.has(index)) continue
      const element = vim.getElementFromIndex(index)
      if (element) element.visible = true
    }
    hiddenRef.current = new Set(hidden)
  }, [hidden, vimEpoch])

  // Hand Cost Details a way to frame any elements, selected or not.
  useEffect(() => {
    if (!frameElementsRef) return
    frameElementsRef.current = (indices) => {
      const viewer = viewerRef.current
      const vim = vimRef.current
      if (!viewer || !vim) return
      const elements = indices
        .map((index) => vim.getElementFromIndex(index))
        .filter((element): element is NonNullable<typeof element> => element !== undefined)
      if (elements.length === 0) return
      if (elements.length === 1) {
        void viewer.core.camera.lerp(1).frame(elements[0])
        return
      }
      void (async () => {
        const box = new VIM.THREE.Box3()
        for (const element of elements) {
          const part = await element.getBoundingBox()
          if (part) box.union(part)
        }
        if (!box.isEmpty()) await viewer.core.camera.lerp(1).frame(box)
      })()
    }
    return () => {
      frameElementsRef.current = null
    }
  }, [frameElementsRef])

  // Dispose on unmount only: the viewer is deliberately long-lived.
  useEffect(
    () => () => {
      loadIdRef.current++
      unsubRef.current?.()
      unsubRef.current = undefined
      viewerRef.current?.dispose()
      viewerRef.current = undefined
      vimRef.current = undefined
    },
    [],
  )

  const message =
    sourceError || loadError || (resolving ? texts.resolving : texts[shownStatus])

  return (
    // position: relative is required — createViewer pins the div it is given to
    // inset: 0, so without a positioned wrapper the canvas covers the whole app.
    <div className="viewer-pane" data-testid="viewer-pane">
      <div ref={hostRef} />
      <div className="viewer-status" data-testid="viewer-status" data-state={shownStatus}>
        {message}
      </div>
    </div>
  )
}
