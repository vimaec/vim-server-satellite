/**
 * The label feature's reads and writes, expressed in terms of the project data
 * store. Everything above this file works with plain objects and never sees a
 * namespace or an ETag.
 */
import { ApiError } from '../api/http'
import { deleteEntries, getEntry, listEntries, putEntries, putEntry } from '../api/projectData'
import { namespaces } from '../config'
import type { Assignment, Palette } from './types'

/** The palette namespace holds exactly one entry. */
const PALETTE_KEY = 'palette'

/** How many times a palette write re-reads and re-applies after a 412. */
const PALETTE_ATTEMPTS = 3

export type PaletteRead = {
  /** null when the project has no palette yet. */
  palette: Palette | null
  /** Write-version to send back as If-Match. */
  etag?: string
}

export async function loadPalette(projectId: string): Promise<PaletteRead> {
  const entry = await getEntry<Palette>(projectId, namespaces.palette, PALETTE_KEY)
  if (!entry) return { palette: null }
  // Tolerate a hand-edited entry: labels must at least be an array.
  const labels = Array.isArray(entry.value?.labels) ? entry.value.labels : []
  return { palette: { labels }, etag: entry.etag }
}

/**
 * Read–modify–write of the palette.
 *
 * The whole palette is one JSON document that everyone on the project shares,
 * so writing a locally edited copy would silently drop a label someone else
 * added a moment ago. Each attempt therefore re-reads the document, applies
 * `mutate` to what is actually stored, and writes it back under a precondition:
 * `If-Match` with the version just read, or `If-None-Match: *` when there is no
 * entry yet, which makes that first write create-only. A 412 means someone else
 * got in between, so the cycle runs again over their version.
 *
 * `mutate` may return null for "leave the stored palette alone".
 *
 * Returns the palette that is now on the server, which the caller should adopt:
 * it includes whatever the other writers did.
 */
export async function updatePalette(
  projectId: string,
  mutate: (current: Palette | null) => Palette | null,
): Promise<Palette> {
  for (let attempt = 0; attempt < PALETTE_ATTEMPTS; attempt++) {
    const read = await loadPalette(projectId)
    const next = mutate(read.palette)
    if (!next) return read.palette ?? { labels: [] }
    try {
      await putEntry(
        projectId,
        namespaces.palette,
        PALETTE_KEY,
        next,
        read.palette ? { ifMatch: read.etag } : { ifNoneMatch: '*' },
      )
      return next
    } catch (cause: unknown) {
      if (!(cause instanceof ApiError) || cause.status !== 412) throw cause
    }
  }
  throw new ApiError(
    412,
    'Could not save the palette',
    'Someone else keeps editing it. Try again.',
  )
}

/** Every assignment in the project, keyed by element key. */
export async function loadAssignments(projectId: string): Promise<Map<string, Assignment>> {
  const entries = await listEntries<Assignment>(projectId, namespaces.labels)
  return new Map(entries.map((entry) => [entry.key, entry.value]))
}

/** One user action can label many elements, so writes go out as one batch. */
export function saveAssignments(
  projectId: string,
  entries: { key: string; value: Assignment }[],
): Promise<{ created: number; updated: number }> {
  return putEntries(projectId, namespaces.labels, entries)
}

export function removeAssignments(
  projectId: string,
  keys: string[],
): Promise<{ deleted: number }> {
  return deleteEntries(projectId, namespaces.labels, keys)
}
