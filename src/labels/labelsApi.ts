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
 * Writes the palette with optimistic concurrency. On 412 (someone else saved
 * first) it reloads to pick up their write-version and retries once; the sample
 * keeps the local palette as the winner rather than merging label lists.
 * Returns the new write-version, which a PUT does not send back.
 */
export async function savePalette(
  projectId: string,
  palette: Palette,
  etag?: string,
): Promise<{ etag?: string }> {
  try {
    await putEntry(projectId, namespaces.palette, PALETTE_KEY, palette, etag)
  } catch (cause: unknown) {
    if (!(cause instanceof ApiError) || cause.status !== 412) throw cause
    const current = await loadPalette(projectId)
    await putEntry(projectId, namespaces.palette, PALETTE_KEY, palette, current.etag)
  }
  return { etag: (await loadPalette(projectId)).etag }
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
