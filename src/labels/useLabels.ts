/**
 * All label state for one project: the palette, the assignments, and the four
 * actions that change them.
 *
 * Every action is optimistic — the UI updates first and rolls back if the server
 * refuses — because a label write is a batch PUT that can cover hundreds of
 * elements and waiting for it would make the viewer feel unresponsive.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { ModelElement } from '../tree/buildModel'
import {
  loadAssignments,
  loadPalette,
  removeAssignments,
  saveAssignments,
  savePalette,
} from './labelsApi'
import { defaultPalette, elementKey } from './types'
import type { Assignment, Palette } from './types'

export type LabelsStatus = 'idle' | 'saving' | 'saved' | 'error' | 'readonly'

export type Labels = {
  palette: Palette
  assignments: Map<string, Assignment>
  status: LabelsStatus
  error: string
  /** False for the Viewer role: the data store refuses those writes with 403. */
  canWrite: boolean
  applyLabel: (labelId: string, elements: ModelElement[]) => void
  removeLabel: (elements: ModelElement[]) => void
  addLabel: (name: string, color: string) => void
  deleteLabel: (labelId: string) => void
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The write failed.'
}

export function useLabels(projectId: string, role: string): Labels {
  const auth = useAuth()
  const [palette, setPalette] = useState<Palette>(defaultPalette)
  const [assignments, setAssignments] = useState<Map<string, Assignment>>(() => new Map())
  const [status, setStatus] = useState<LabelsStatus>('idle')
  const [error, setError] = useState('')

  // The palette's write-version, and whether the server has one at all. The
  // default palette is only pushed on the first write, so opening a project
  // never modifies it.
  const paletteEtag = useRef<string | undefined>(undefined)
  const paletteOnServer = useRef(false)

  const canWrite = role === 'Manager' || role === 'Admin'
  const by = auth.session?.upn || auth.session?.name || undefined

  useEffect(() => {
    let cancelled = false
    paletteEtag.current = undefined
    paletteOnServer.current = false
    setPalette(defaultPalette())
    setAssignments(new Map())
    setStatus('idle')
    setError('')

    void (async () => {
      try {
        const [read, stored] = await Promise.all([
          loadPalette(projectId),
          loadAssignments(projectId),
        ])
        if (cancelled) return
        paletteEtag.current = read.etag
        paletteOnServer.current = read.palette !== null
        setPalette(read.palette ?? defaultPalette())
        setAssignments(stored)
      } catch (cause: unknown) {
        if (cancelled) return
        setStatus('error')
        setError(messageOf(cause))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectId])

  /** Pushes the palette and remembers its new write-version. */
  const writePalette = useCallback(
    async (next: Palette) => {
      const result = await savePalette(projectId, next, paletteEtag.current)
      paletteEtag.current = result.etag
      paletteOnServer.current = true
    },
    [projectId],
  )

  const applyLabel = useCallback(
    (labelId: string, elements: ModelElement[]) => {
      if (!canWrite || elements.length === 0) return
      const at = new Date().toISOString()
      const entries = elements.map((element) => ({
        key: elementKey(element),
        value: { labelId, elementId: element.elementId, elementName: element.name, by, at },
      }))

      const rollback = assignments
      const next = new Map(assignments)
      for (const entry of entries) next.set(entry.key, entry.value)
      setAssignments(next)
      setStatus('saving')

      void (async () => {
        try {
          // An assignment points at a label id, so the palette has to exist on
          // the server before the first assignment does.
          if (!paletteOnServer.current) await writePalette(palette)
          await saveAssignments(projectId, entries)
          setStatus('saved')
        } catch (cause: unknown) {
          setAssignments(rollback)
          setStatus('error')
          setError(messageOf(cause))
        }
      })()
    },
    [assignments, by, canWrite, palette, projectId, writePalette],
  )

  const removeLabel = useCallback(
    (elements: ModelElement[]) => {
      if (!canWrite) return
      const keys = elements.map(elementKey).filter((key) => assignments.has(key))
      if (keys.length === 0) return

      const rollback = assignments
      const next = new Map(assignments)
      for (const key of keys) next.delete(key)
      setAssignments(next)
      setStatus('saving')

      void (async () => {
        try {
          await removeAssignments(projectId, keys)
          setStatus('saved')
        } catch (cause: unknown) {
          setAssignments(rollback)
          setStatus('error')
          setError(messageOf(cause))
        }
      })()
    },
    [assignments, canWrite, projectId],
  )

  const addLabel = useCallback(
    (name: string, color: string) => {
      if (!canWrite) return
      const trimmed = name.trim()
      if (!trimmed) return

      const rollback = palette
      const next: Palette = {
        labels: [...palette.labels, { id: crypto.randomUUID(), name: trimmed, color }],
      }
      setPalette(next)
      setStatus('saving')

      void (async () => {
        try {
          await writePalette(next)
          setStatus('saved')
        } catch (cause: unknown) {
          setPalette(rollback)
          setStatus('error')
          setError(messageOf(cause))
        }
      })()
    },
    [canWrite, palette, writePalette],
  )

  const deleteLabel = useCallback(
    (labelId: string) => {
      if (!canWrite) return
      const keys = [...assignments]
        .filter(([, assignment]) => assignment.labelId === labelId)
        .map(([key]) => key)

      const rollbackPalette = palette
      const rollbackAssignments = assignments
      const next: Palette = { labels: palette.labels.filter((label) => label.id !== labelId) }
      const remaining = new Map(assignments)
      for (const key of keys) remaining.delete(key)
      setPalette(next)
      setAssignments(remaining)
      setStatus('saving')

      void (async () => {
        try {
          await writePalette(next)
          // A deleted label must not leave assignments behind: they would color
          // nothing and would come back if the id were ever reused.
          if (keys.length > 0) await removeAssignments(projectId, keys)
          setStatus('saved')
        } catch (cause: unknown) {
          setPalette(rollbackPalette)
          setAssignments(rollbackAssignments)
          setStatus('error')
          setError(messageOf(cause))
        }
      })()
    },
    [assignments, canWrite, palette, projectId, writePalette],
  )

  return useMemo(
    () => ({
      palette,
      assignments,
      // A Viewer cannot write, but a failed read is still worth reporting.
      status: !canWrite && status !== 'error' ? 'readonly' : status,
      error,
      canWrite,
      applyLabel,
      removeLabel,
      addLabel,
      deleteLabel,
    }),
    [
      addLabel,
      applyLabel,
      assignments,
      canWrite,
      deleteLabel,
      error,
      palette,
      removeLabel,
      status,
    ],
  )
}
