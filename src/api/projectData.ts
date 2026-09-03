/**
 * The project custom data store: namespace + key -> arbitrary JSON.
 *
 * This is where the satellite keeps its own state (the label palette and the
 * per-element assignments) without any server-side code of its own.
 */
import { apiFetch, apiRequest, jsonBody, path } from './http'
import type { DataEntry } from './types'

/** `/project/{p}/data/{ns}` — the whole namespace. */
function namespacePath(projectId: string, namespace: string): string {
  return `/${path('project', projectId, 'data', namespace)}`
}

/** `/project/{p}/data/{ns}/{key}`. Keys must not contain `/`: the server answers 400. */
function keyPath(projectId: string, namespace: string, key: string): string {
  return `/${path('project', projectId, 'data', namespace, key)}`
}

/** Some values come back as a JSON string rather than as JSON. Unwrap those. */
function asValue<T>(raw: unknown): T {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T
    } catch {
      return raw as T
    }
  }
  return raw as T
}

/** Every entry in a namespace. `take` is omitted so the server returns them all. */
export async function listEntries<T>(
  projectId: string,
  namespace: string,
): Promise<DataEntry<T>[]> {
  const raw = await apiFetch<{ key: string; value: unknown }[]>(
    namespacePath(projectId, namespace),
  )
  return raw.map((entry) => ({ key: entry.key, value: asValue<T>(entry.value) }))
}

/** One entry with its write-version ETag, or null when it does not exist. */
export async function getEntry<T>(
  projectId: string,
  namespace: string,
  key: string,
): Promise<{ value: T; etag?: string } | null> {
  const response = await apiRequest(keyPath(projectId, namespace, key), { allowStatus: [404] })
  if (response.status === 404) return null
  const body = (await response.json()) as { value?: unknown }
  return {
    value: asValue<T>(body.value !== undefined ? body.value : body),
    etag: response.headers.get('ETag') ?? undefined,
  }
}

/** The two preconditions the data store understands. */
export type Precondition = {
  /** The ETag from a previous read: the write fails with 412 if it moved on. */
  ifMatch?: string
  /** `*` makes the write create-only: 412 if the entry already exists. */
  ifNoneMatch?: string
}

/**
 * Writes one entry. Without a precondition this is last-write-wins; with one the
 * server answers 412 (an ApiError with status 412) when it does not hold.
 */
export async function putEntry(
  projectId: string,
  namespace: string,
  key: string,
  value: unknown,
  precondition: Precondition = {},
): Promise<void> {
  const init = jsonBody(value)
  const headers = new Headers(init.headers)
  if (precondition.ifMatch) headers.set('If-Match', precondition.ifMatch)
  if (precondition.ifNoneMatch) headers.set('If-None-Match', precondition.ifNoneMatch)
  await apiRequest(keyPath(projectId, namespace, key), {
    ...init,
    method: 'PUT',
    headers,
  })
}

/** Batch upsert. Used when one user action labels many elements at once. */
export async function putEntries<T>(
  projectId: string,
  namespace: string,
  entries: { key: string; value: T }[],
): Promise<{ created: number; updated: number }> {
  return apiFetch<{ created: number; updated: number }>(namespacePath(projectId, namespace), {
    ...jsonBody(entries),
    method: 'PUT',
  })
}

/** Batch delete, via the POST sub-route (DELETE cannot carry a body reliably). */
export async function deleteEntries(
  projectId: string,
  namespace: string,
  keys: string[],
): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(
    `/${path('project', projectId, 'data', namespace, 'delete')}`,
    { ...jsonBody(keys), method: 'POST' },
  )
}
