/**
 * All label state for one project: the palette, the assignments, and the four
 * actions that change them.
 *
 * Every action is optimistic — the UI updates first and rolls back if the server
 * refuses — because a label write is a batch PUT that can cover hundreds of
 * elements and waiting for it would make the viewer feel unresponsive.
 *
 * Nothing may be written before the first read has finished. Until then the app
 * does not know whether the project already has a palette, and a write would
 * have to guess; a wrong guess overwrites other people's labels.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { ModelElement } from '../tree/buildModel'
import {
  loadAssignments,
  loadPalette,
  removeAssignments,
  saveAssignments,
  updatePalette,
} from './labelsApi'
import { defaultPalette, elementKey } from './types'
import type { Assignment, Label, Palette } from './types'

/** What `label-status` reports. */
export type LabelsStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error' | 'readonly'

type LoadStatus = 'loading' | 'ready' | 'error'
type WriteStatus = 'idle' | 'saving' | 'saved' | 'error'

export type Labels = {
  palette: Palette
  assignments: Map<string, Assignment>
  status: LabelsStatus
  error: string
  /**
   * Whether the four actions do anything. False until the first read has
   * finished and the project role is known, and false for the Viewer role:
   * the data store refuses those writes with 403.
   */
  canEdit: boolean
  /** The first read failed; the panel offers Retry and every write stays shut. */
  loadFailed: boolean
  /** Read the palette and the assignments again after a failed load. */
  retry: () => void
  applyLabel: (labelId: string, elements: ModelElement[]) => void
  removeLabel: (elements: ModelElement[]) => void
  addLabel: (name: string, color: string) => void
  deleteLabel: (labelId: string) => void
}

/** The previous value of every key an action touched, so a rollback is precise. */
type Touched = { key: string; value: Assignment | undefined }[]

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The write failed.'
}

export function useLabels(projectId: string, role: string): Labels {
  const auth = useAuth()
  const [palette, setPalette] = useState<Palette>(defaultPalette)
  const [assignments, setAssignments] = useState<Map<string, Assignment>>(() => new Map())
  const [load, setLoad] = useState<LoadStatus>('loading')
  const [write, setWrite] = useState<WriteStatus>('idle')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  /**
   * Bumped whenever the project changes, the load is retried, or the hook goes
   * away. An action compares it after every await and drops out if it moved:
   * the result belongs to a project that is no longer on screen.
   */
  const epochRef = useRef(0)
  /** Whether the project has a palette at all. Only known after the load. */
  const paletteOnServer = useRef(false)

  // An empty role means GET /project/{id}/role has not answered yet, which is
  // not the same as the Viewer role.
  const roleAllowsWrites = role === 'Manager' || role === 'Admin'
  const canEdit = load === 'ready' && role !== '' && roleAllowsWrites
  const by = auth.session?.upn || auth.session?.name || undefined

  const retry = useCallback(() => setReload((count) => count + 1), [])

  useEffect(() => {
    const epoch = ++epochRef.current
    paletteOnServer.current = false
    // The default palette gives the panel something to lay out while the real
    // one is on its way. Every control is disabled until the load is done, so
    // it cannot be written by mistake.
    setPalette(defaultPalette())
    setAssignments(new Map())
    setLoad('loading')
    setWrite('idle')
    setError('')

    void (async () => {
      try {
        const [read, stored] = await Promise.all([
          loadPalette(projectId),
          loadAssignments(projectId),
        ])
        if (epoch !== epochRef.current) return
        paletteOnServer.current = read.palette !== null
        setPalette(read.palette ?? defaultPalette())
        setAssignments(stored)
        setLoad('ready')
      } catch (cause: unknown) {
        if (epoch !== epochRef.current) return
        setLoad('error')
        setError(messageOf(cause))
      }
    })()

    return () => {
      epochRef.current++
    }
  }, [projectId, reload])

  /** Puts back only the keys one action changed; the rest may have moved on. */
  const rollbackAssignments = useCallback((touched: Touched) => {
    setAssignments((current) => {
      const next = new Map(current)
      for (const { key, value } of touched) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      return next
    })
  }, [])

  const applyLabel = useCallback(
    (labelId: string, elements: ModelElement[]) => {
      if (!canEdit || elements.length === 0) return
      const epoch = epochRef.current
      const local = palette
      const at = new Date().toISOString()
      const entries = elements.map((element) => ({
        key: elementKey(element),
        value: { labelId, elementId: element.elementId, elementName: element.name, by, at },
      }))
      const touched: Touched = entries.map(({ key }) => ({ key, value: assignments.get(key) }))

      setAssignments((current) => {
        const next = new Map(current)
        for (const entry of entries) next.set(entry.key, entry.value)
        return next
      })
      setWrite('saving')

      void (async () => {
        try {
          // An assignment points at a label id, so the palette has to exist on
          // the server before the first assignment does. Returning null leaves
          // a palette someone else created in the meantime exactly as it is.
          if (!paletteOnServer.current) {
            const stored = await updatePalette(projectId, (current) => (current ? null : local))
            if (epoch !== epochRef.current) return
            paletteOnServer.current = true
            setPalette(stored)
          }
          await saveAssignments(projectId, entries)
          if (epoch !== epochRef.current) return
          setWrite('saved')
        } catch (cause: unknown) {
          if (epoch !== epochRef.current) return
          rollbackAssignments(touched)
          setWrite('error')
          setError(messageOf(cause))
        }
      })()
    },
    [assignments, by, canEdit, palette, projectId, rollbackAssignments],
  )

  const removeLabel = useCallback(
    (elements: ModelElement[]) => {
      if (!canEdit) return
      const keys = elements.map(elementKey).filter((key) => assignments.has(key))
      if (keys.length === 0) return
      const epoch = epochRef.current
      const touched: Touched = keys.map((key) => ({ key, value: assignments.get(key) }))

      setAssignments((current) => {
        const next = new Map(current)
        for (const key of keys) next.delete(key)
        return next
      })
      setWrite('saving')

      void (async () => {
        try {
          await removeAssignments(projectId, keys)
          if (epoch !== epochRef.current) return
          setWrite('saved')
        } catch (cause: unknown) {
          if (epoch !== epochRef.current) return
          rollbackAssignments(touched)
          setWrite('error')
          setError(messageOf(cause))
        }
      })()
    },
    [assignments, canEdit, projectId, rollbackAssignments],
  )

  const addLabel = useCallback(
    (name: string, color: string) => {
      if (!canEdit) return
      const trimmed = name.trim()
      if (!trimmed) return
      const epoch = epochRef.current
      const local = palette
      const label: Label = { id: crypto.randomUUID(), name: trimmed, color }

      setPalette((current) => ({ labels: [...current.labels, label] }))
      setWrite('saving')

      void (async () => {
        try {
          // The stored list wins over the local one: someone else may have added
          // a label since this page read the palette.
          const stored = await updatePalette(projectId, (current) => ({
            labels: [...(current ?? local).labels, label],
          }))
          if (epoch !== epochRef.current) return
          paletteOnServer.current = true
          setPalette(stored)
          setWrite('saved')
        } catch (cause: unknown) {
          if (epoch !== epochRef.current) return
          // Take back this one label; the rest of the list may have moved on.
          setPalette((current) => ({
            labels: current.labels.filter((entry) => entry.id !== label.id),
          }))
          setWrite('error')
          setError(messageOf(cause))
        }
      })()
    },
    [canEdit, palette, projectId],
  )

  const deleteLabel = useCallback(
    (labelId: string) => {
      if (!canEdit) return
      const index = palette.labels.findIndex((label) => label.id === labelId)
      if (index < 0) return
      const epoch = epochRef.current
      const local = palette
      const removed = palette.labels[index]
      const keys = [...assignments]
        .filter(([, assignment]) => assignment.labelId === labelId)
        .map(([key]) => key)
      const touched: Touched = keys.map((key) => ({ key, value: assignments.get(key) }))

      setPalette((current) => ({
        labels: current.labels.filter((label) => label.id !== labelId),
      }))
      setAssignments((current) => {
        const next = new Map(current)
        for (const key of keys) next.delete(key)
        return next
      })
      setWrite('saving')

      void (async () => {
        try {
          // Assignments first. A label with no assignments left is consistent;
          // an assignment pointing at a label that is gone colors nothing and
          // would come back if the id were ever reused.
          if (keys.length > 0) await removeAssignments(projectId, keys)
          const stored = await updatePalette(projectId, (current) => ({
            labels: (current ?? local).labels.filter((label) => label.id !== labelId),
          }))
          if (epoch !== epochRef.current) return
          paletteOnServer.current = true
          setPalette(stored)
          setWrite('saved')
        } catch (cause: unknown) {
          if (epoch !== epochRef.current) return
          rollbackAssignments(touched)
          setPalette((current) =>
            current.labels.some((label) => label.id === labelId)
              ? current
              : {
                  labels: [
                    ...current.labels.slice(0, index),
                    removed,
                    ...current.labels.slice(index),
                  ],
                },
          )
          setWrite('error')
          setError(messageOf(cause))
        }
      })()
    },
    [assignments, canEdit, palette, projectId, rollbackAssignments],
  )

  const status: LabelsStatus =
    load === 'error'
      ? 'error'
      : load === 'loading' || role === ''
        ? 'loading'
        : roleAllowsWrites
          ? write
          : 'readonly'

  return useMemo(
    () => ({
      palette,
      assignments,
      status,
      error,
      canEdit,
      loadFailed: load === 'error',
      retry,
      applyLabel,
      removeLabel,
      addLabel,
      deleteLabel,
    }),
    [
      addLabel,
      applyLabel,
      assignments,
      canEdit,
      deleteLabel,
      error,
      load,
      palette,
      removeLabel,
      retry,
      status,
    ],
  )
}
