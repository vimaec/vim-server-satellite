/**
 * The project custom data store: namespace + key -> arbitrary JSON.
 *
 * This is where the satellite keeps its own state (the label palette and the
 * per-element assignments) without any server-side code of its own.
 */
import { apiFetch, apiRequest, jsonBody } from './http'
import type { DataEntry } from './types'

/** Keys must not contain `/`; the server answers 400 if they do. */
function keyPath(projectId: string, namespace: string, key: string): string {
  return `/project/${projectId}/data/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`
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
  const raw = await apiFetch<{ key: string; value: unknown; etag?: string }[]>(
    `/project/${projectId}/data/${encodeURIComponent(namespace)}`,
  )
  return raw.map((entry) => ({
    key: entry.key,
    value: asValue<T>(entry.value),
    etag: entry.etag,
  }))
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

/**
 * Writes one entry. Pass the ETag from a previous read as `ifMatch` for
 * optimistic concurrency; the server then answers 412 (an ApiError with
 * status 412) when someone else wrote first.
 */
export async function putEntry(
  projectId: string,
  namespace: string,
  key: string,
  value: unknown,
  ifMatch?: string,
): Promise<void> {
  const init = jsonBody(value)
  const headers = new Headers(init.headers)
  if (ifMatch) headers.set('If-Match', ifMatch)
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
  return apiFetch<{ created: number; updated: number }>(
    `/project/${projectId}/data/${encodeURIComponent(namespace)}`,
    { ...jsonBody(entries), method: 'PUT' },
  )
}

/** Batch delete, via the POST sub-route (DELETE cannot carry a body reliably). */
export async function deleteEntries(
  projectId: string,
  namespace: string,
  keys: string[],
): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(
    `/project/${projectId}/data/${encodeURIComponent(namespace)}/delete`,
    { ...jsonBody(keys), method: 'POST' },
  )
}
