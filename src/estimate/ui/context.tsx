/**
 * What every part of the estimate UI shares: the estimate itself, the view,
 * the 3D selection, and the verbs that open dialogs or tell the user something.
 *
 * The page owns the selection (the viewer and the panel both drive it), so
 * this is provided by the page. A context, not props: the same verbs are used
 * five levels down in a tree row, in Cost Details and in the 3D menu.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from '../../ds'
import { NO_KEY_MANY, NO_KEY_ONE } from '../i18n'
import type { Estimate, Feedback } from '../useEstimate'
import { EditCostCodeDialog } from './EditCostCodeDialog'
import { SetCostCodeDialog } from './SetCostCodeDialog'
import { SetWorkPackageDialog } from './SetWorkPackageDialog'
import type { ElementsView } from './useElementsView'

/** How a click changes the selection: replace it, toggle the clicked elements, or add them. */
export type SelectMode = 'replace' | 'toggle' | 'add'

export type EstimateUi = {
  est: Estimate
  view: ElementsView
  /** Selected element indices, in the order they were selected. */
  selection: number[]
  /** The same, for membership tests. */
  selected: ReadonlySet<number>
  select: (indices: readonly number[], mode?: SelectMode) => void
  /**
   * Set Cost Code… for those of these elements that have a Revit UniqueId (the
   * others are skipped); a warning toast when there are none.
   */
  openCostCode: (elements: readonly number[]) => void
  /** Set Work Package… for these elements, as openCostCode. */
  openWorkPackage: (elements: readonly number[]) => void
  /** Edit… one cost code in a form. */
  openEditCode: (id: string) => void
  /** Show an action's feedback as a toast. */
  notify: (feedback: Feedback) => void
  /** Move the camera onto these elements (Cost Details' camera toggle). */
  frameElements: (indices: number[]) => void
}

const Context = createContext<EstimateUi | null>(null)

export function useEstimateUi(): EstimateUi {
  const value = useContext(Context)
  if (!value) throw new Error('useEstimateUi() outside <EstimateUiProvider>')
  return value
}

type Dialog =
  | { kind: 'code'; elements: number[] }
  | { kind: 'wp'; elements: number[] }
  | { kind: 'edit'; id: string }
  | null

export type EstimateUiProviderProps = {
  est: Estimate
  view: ElementsView
  selection: number[]
  setSelection: (next: number[] | ((previous: number[]) => number[])) => void
  frameElements: (indices: number[]) => void
  children?: ReactNode
}

/**
 * Provides the shared UI state, renders the open dialog, toasts each failed
 * write once, and listens for Ctrl+C / Ctrl+V / Ctrl+X.
 */
export function EstimateUiProvider(props: EstimateUiProviderProps): JSX.Element {
  const { est, view, selection, setSelection, frameElements } = props
  const [dialog, setDialog] = useState<Dialog>(null)
  const { t } = est

  const selected = useMemo(() => new Set(selection), [selection])

  const select = useCallback(
    (indices: readonly number[], mode: SelectMode = 'replace') => {
      setSelection((previous) => {
        if (mode === 'replace') return [...indices]
        const next = new Set(previous)
        // A toggle of several elements (a group row) is one decision for all of
        // them: off when they are all on, else on.
        const allOn = mode === 'toggle' && indices.length > 0 && indices.every((index) => next.has(index))
        for (const index of indices) {
          if (allOn) next.delete(index)
          else next.add(index)
        }
        return [...next]
      })
    },
    [setSelection],
  )

  const notify = useCallback((feedback: Feedback) => {
    toast(feedback.text, feedback.tone)
  }, [])

  const tRef = useRef(t)
  tRef.current = t
  const storable = est.storable
  /**
   * The elements a "Set …" dialog writes: those with a Revit UniqueId, so its
   * title counts what it will change. As the original, a dialog with nothing
   * to set it on is a warning, not a dialog; null then.
   */
  const dialogElements = useCallback(
    (elements: readonly number[]): number[] | null => {
      if (!elements.length) {
        toast(tRef.current('Select elements in the 3D view or the Elements tab first.'), 'warn')
        return null
      }
      const keyed = storable(elements)
      if (keyed.length) return keyed
      toast(tRef.current(elements.length === 1 ? NO_KEY_ONE : NO_KEY_MANY), 'warn')
      return null
    },
    [storable],
  )

  const openCostCode = useCallback(
    (elements: readonly number[]) => {
      const keyed = dialogElements(elements)
      if (keyed) setDialog({ kind: 'code', elements: keyed })
    },
    [dialogElements],
  )
  const openWorkPackage = useCallback(
    (elements: readonly number[]) => {
      const keyed = dialogElements(elements)
      if (keyed) setDialog({ kind: 'wp', elements: keyed })
    },
    [dialogElements],
  )
  const openEditCode = useCallback((id: string) => setDialog({ kind: 'edit', id }), [])
  const close = useCallback(() => setDialog(null), [])

  // A refused write was rolled back already; say so once per failure.
  const failureSeq = est.failure?.seq ?? 0
  const failureMessage = est.failure?.message ?? ''
  useEffect(() => {
    if (failureSeq > 0) toast(tRef.current('Could not save the change: {error}', { error: failureMessage }), 'bad', 8000)
  }, [failureSeq, failureMessage])

  const value = useMemo<EstimateUi>(
    () => ({ est, view, selection, selected, select, openCostCode, openWorkPackage, openEditCode, notify, frameElements }),
    [est, frameElements, notify, openCostCode, openEditCode, openWorkPackage, select, selected, selection, view],
  )

  useShortcuts(value)

  return (
    <Context.Provider value={value}>
      {props.children}
      {dialog?.kind === 'code' ? <SetCostCodeDialog elements={dialog.elements} onClose={close} /> : null}
      {dialog?.kind === 'wp' ? <SetWorkPackageDialog elements={dialog.elements} onClose={close} /> : null}
      {dialog?.kind === 'edit' ? <EditCostCodeDialog id={dialog.id} onClose={close} /> : null}
    </Context.Provider>
  )
}

/**
 * Ctrl+C copies the cost code of the one selected element, Ctrl+V pastes it
 * on the selection, Ctrl+X moves the selection between included and excluded.
 * Inside a text field the keys keep their usual meaning (copy, paste, cut text).
 */
function useShortcuts(ui: EstimateUi): void {
  const uiRef = useRef(ui)
  uiRef.current = ui
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      const key = event.key.toLowerCase()
      if (key !== 'c' && key !== 'v' && key !== 'x') return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]')) return
      // A dialog owns the keyboard while it is open.
      if (document.querySelector('.ds-modal-backdrop')) return
      const { est, selection, notify } = uiRef.current
      if (est.status !== 'ready') return
      event.preventDefault()
      if (key === 'c') notify(est.copyCode(selection))
      else if (key === 'v') notify(est.pasteCode(selection))
      else if (!selection.length) return
      else if (est.storable(selection).length) est.toggleIncluded(selection)
      // Only elements with no UniqueId: say why nothing happens, as Paste does.
      else notify({ tone: 'warn', text: est.t(selection.length === 1 ? NO_KEY_ONE : NO_KEY_MANY) })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}
