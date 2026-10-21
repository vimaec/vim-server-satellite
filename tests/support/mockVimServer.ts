/**
 * An in-browser stand-in for VIM Server.
 *
 * Playwright intercepts every request to the API origin and to a fake blob
 * origin, so the whole suite runs with no network, no tenant and no tokens.
 * The mock keeps the parts of the contract the app depends on: the bearer
 * check, the project/snapshot shapes, ETag concurrency on the data store, and
 * HTTP Range replies for the .vim download.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page, Route } from '@playwright/test'

/** Must match src/config.ts (both default to the dev server). */
export const SERVER = process.env.VITE_VIM_SERVER_URL ?? 'https://server-dev.vimaec.com'
export const API = `${SERVER}/api/v1`

/** The token the mock accepts by default; useFakeSession() hands it out. */
export const GOOD_TOKEN = 'e2e-token'

/** A second accepted token, for tests that prove a silent refresh happened. */
export const REFRESHED_TOKEN = 'e2e-token-refreshed'

/** Fake blob storage: where the snapshot SAS URL points. */
export const BLOB_ORIGIN = 'https://mock-blob.local'
export const BLOB_URL = `${BLOB_ORIGIN}/tiny-house.vim`

const FIXTURE = fileURLToPath(new URL('../fixtures/Tiny_House_Imperial.r2026.vim', import.meta.url))

export type MockBlob = {
  id: string
  name: string
  versionTag: string
  sizeInBytes: number
  created: string
}

export type MockProject = {
  id: string
  name: string
  /** 'Viewer', 'Manager' or 'Admin' on the real server; a test may hand out a role the app does not know. */
  role: string
  latestVim: MockBlob | null
}

export type MockOrg = {
  id: string
  name: string
  role: string
  projects: MockProject[]
}

/** namespace -> key -> { value, version }. `version` is the ETag integer. */
export type MockStore = Map<string, Map<string, { value: unknown; version: number }>>

export type RecordedWrite =
  | {
      kind: 'put'
      namespace: string
      key: string
      value: unknown
      ifMatch: string | null
      ifNoneMatch: string | null
    }
  | { kind: 'put-batch'; namespace: string; entries: { key: string; value: unknown }[] }
  | { kind: 'delete'; namespace: string; keys: string[] }

/**
 * How `failRead` / `failWrite` fail a request: an HTTP status (e.g. 503), or
 * 'network' to abort it with no answer at all. The page's fetch() then rejects
 * with a TypeError, which is what the real server's sign-in redirect under
 * load looks like in a browser (a CORS error).
 */
export type MockFailure = number | 'network'

/** A data-store read as `failRead` and `holdRead` see it: a list (no key) or one entry. */
export type PendingRead = { namespace: string; key?: string }

/** A data-store write as `failWrite` sees it, before the mock acts on it. */
export type PendingWrite = {
  /** `put` / `delete` one entry, `put-batch` / `delete-batch` many, `delete-namespace` all of them. */
  kind: 'put' | 'delete' | 'put-batch' | 'delete-batch' | 'delete-namespace'
  namespace: string
  /** The entry key, for `put` and `delete`. */
  key?: string
}

export type MockOptions = {
  orgs?: MockOrg[]
  /** Seed the project data store: namespace -> key -> value. */
  data?: Record<string, Record<string, unknown>>
  /** Answer every authenticated API call with 401 (session-expiry test). */
  unauthorized?: boolean
  /** Bearer tokens the mock accepts. Defaults to [GOOD_TOKEN]. */
  tokens?: string[]
  /**
   * Called just before a single-entry PUT is evaluated, so a test can act as
   * another writer between the app's read and its write.
   */
  beforeEntryWrite?: (write: { namespace: string; key: string }, store: MockStore) => void
  /**
   * Called before every data-store write, retries included. A failure returned
   * (e.g. 500, or 'network') answers the write with it instead: nothing is
   * stored and nothing is recorded in `writes`. Undefined lets the write through.
   */
  failWrite?: (write: PendingWrite) => MockFailure | undefined
  /**
   * Called before every data-store read, retries included. A failure returned
   * (e.g. 500, or 'network') answers the read with it instead. Undefined lets
   * the read through.
   */
  failRead?: (read: PendingRead) => MockFailure | undefined
  /**
   * Called before a data-store write that `failWrite` let through is carried
   * out. A promise returned holds the write until it settles: a server that
   * takes its time, so that requests the page sends together overlap.
   */
  holdWrite?: (write: PendingWrite) => Promise<void> | undefined
  /**
   * Called once a data-store read is answered from the store, before the reply
   * is sent. A promise returned holds the reply until it settles, and the reply
   * still carries the data of when the request came in: a read that arrives
   * late with data that is out of date by then.
   */
  holdRead?: (read: PendingRead) => Promise<void> | undefined
}

export type MockHandle = {
  orgs: MockOrg[]
  store: MockStore
  writes: RecordedWrite[]
  /** "GET /org", "PUT /project/p-tiny/data/estimate.sheets/sheet-1", … in order. */
  calls: string[]
  /** Flip the 401 switch after the page has signed in. */
  setUnauthorized: (value: boolean) => void
  entry: (namespace: string, key: string) => unknown
  /**
   * Data-store requests being answered right now (`now`), and the most at
   * once (`peak`) since `resetPeaks()`: per namespace, and over all
   * namespaces under ALL_DATA. A request counts from its arrival at the mock
   * to its reply, refused ones included.
   */
  inFlight: Map<string, { now: number; peak: number }>
  /** Starts a new peak count, from what is in flight now. */
  resetPeaks: () => void
}

/** The `inFlight` key that counts every data-store request. */
export const ALL_DATA = '*'

const BLOB_TINY: MockBlob = {
  id: '9f1d4a52-0000-4000-8000-000000000001',
  name: 'Tiny_House_Imperial.r2026.vim',
  versionTag: 'v3',
  sizeInBytes: 252_160,
  created: '2026-08-20T09:15:00Z',
}

const BLOB_WOLFORD: MockBlob = {
  id: '9f1d4a52-0000-4000-8000-000000000002',
  name: 'Wolford_Residence.r2026.vim',
  versionTag: 'v1',
  sizeInBytes: 8_505_216,
  created: '2026-07-02T14:40:00Z',
}

/** Two orgs, three projects, one of them without a VIM. */
export function defaultOrgs(): MockOrg[] {
  return [
    {
      id: 'org-north',
      name: 'Northwind Design',
      role: 'Admin',
      projects: [
        { id: 'p-tiny', name: 'Tiny House', role: 'Manager', latestVim: BLOB_TINY },
        { id: 'p-empty', name: 'Empty Site', role: 'Viewer', latestVim: null },
      ],
    },
    {
      id: 'org-contoso',
      name: 'Contoso Build',
      role: 'Member',
      projects: [
        { id: 'p-wolford', name: 'Wolford Residence', role: 'Viewer', latestVim: BLOB_WOLFORD },
      ],
    },
  ]
}

const problem = (status: number, title: string, detail = ''): Parameters<Route['fulfill']>[0] => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ type: 'about:blank', title, status, detail }),
})

const json = (value: unknown, status = 200, headers?: Record<string, string>) => ({
  status,
  contentType: 'application/json',
  headers,
  body: JSON.stringify(value),
})

export async function installMockVimServer(
  page: Page,
  options: MockOptions = {},
): Promise<MockHandle> {
  const orgs = options.orgs ?? defaultOrgs()
  const tokens = options.tokens ?? [GOOD_TOKEN]
  const store: MockStore = new Map()
  for (const [namespace, entries] of Object.entries(options.data ?? {})) {
    const bucket = new Map<string, { value: unknown; version: number }>()
    for (const [key, value] of Object.entries(entries)) bucket.set(key, { value, version: 1 })
    store.set(namespace, bucket)
  }

  const handle: MockHandle = {
    orgs,
    store,
    writes: [],
    calls: [],
    setUnauthorized: (value) => {
      unauthorized = value
    },
    entry: (namespace, key) => store.get(namespace)?.get(key)?.value,
    inFlight: new Map(),
    resetPeaks: () => {
      for (const count of handle.inFlight.values()) count.peak = count.now
    },
  }
  let unauthorized = options.unauthorized ?? false

  const bucket = (namespace: string): Map<string, { value: unknown; version: number }> => {
    let found = store.get(namespace)
    if (!found) {
      found = new Map()
      store.set(namespace, found)
    }
    return found
  }

  /** Fails a request as `failRead` / `failWrite` asked. */
  const failWith = async (route: Route, failure: MockFailure, title: string, detail: string): Promise<void> => {
    if (failure === 'network') await route.abort('failed')
    else await route.fulfill(problem(failure, title, detail))
  }

  /** Answers a read `failRead` wants to fail; true when it did. */
  const readRefused = async (route: Route, read: PendingRead): Promise<boolean> => {
    const failure = options.failRead?.(read)
    if (failure === undefined) return false
    await failWith(route, failure, 'Read refused', `The mock refused a read of ${read.namespace}.`)
    return true
  }

  /** Sends a read's reply, after `holdRead` lets it go. */
  const answerRead = async (route: Route, read: PendingRead, reply: Parameters<Route['fulfill']>[0]): Promise<void> => {
    await options.holdRead?.(read)
    await route.fulfill(reply)
  }

  /** Answers a write `failWrite` wants to fail; true when it did. Else holds it as `holdWrite` asks. */
  const refused = async (route: Route, write: PendingWrite): Promise<boolean> => {
    const failure = options.failWrite?.(write)
    if (failure === undefined) {
      await options.holdWrite?.(write)
      return false
    }
    await failWith(route, failure, 'Write refused', `The mock refused ${write.kind} on ${write.namespace}.`)
    return true
  }

  /** Counts a data-store request in `inFlight` while `answer` runs. */
  const counted = async (namespace: string, answer: () => Promise<void>): Promise<void> => {
    const counts = [ALL_DATA, namespace].map((key) => {
      let count = handle.inFlight.get(key)
      if (!count) {
        count = { now: 0, peak: 0 }
        handle.inFlight.set(key, count)
      }
      return count
    })
    for (const count of counts) count.peak = Math.max(count.peak, ++count.now)
    try {
      await answer()
    } finally {
      for (const count of counts) count.now--
    }
  }

  const findProject = (id: string): { org: MockOrg; project: MockProject } | undefined => {
    for (const org of orgs) {
      const project = org.projects.find((p) => p.id === id)
      if (project) return { org, project }
    }
    return undefined
  }

  await page.route(`${API}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^.*\/api\/v1/, '')
    const method = request.method()
    handle.calls.push(`${method} ${path}`)

    // GET /config is the only anonymous route; the app calls it before sign-in.
    if (path === '/config' && method === 'GET') {
      await route.fulfill(
        json({ tenantId: 'mock-tenant-id', clientId: 'mock-client-id' }),
      )
      return
    }

    const authorization = await request.headerValue('authorization')
    const token = authorization?.replace(/^Bearer /, '') ?? ''
    if (unauthorized || !tokens.includes(token)) {
      await route.fulfill(problem(401, 'Unauthorized', 'The access token is missing or invalid.'))
      return
    }

    if (path === '/profile' && method === 'GET') {
      await route.fulfill(
        json({
          userId: 'user-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          organizations: orgs.map((o) => ({ id: o.id, name: o.name, role: o.role })),
        }),
      )
      return
    }

    if (path === '/org' && method === 'GET') {
      await route.fulfill(json(orgs.map(({ id, name, role }) => ({ id, name, role }))))
      return
    }

    const orgProjects = /^\/org\/([^/]+)\/project$/.exec(path)
    if (orgProjects && method === 'GET') {
      const org = orgs.find((o) => o.id === orgProjects[1])
      if (!org) {
        await route.fulfill(problem(404, 'Not Found'))
        return
      }
      await route.fulfill(
        json(
          org.projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: 'Ready',
            role: p.role,
            sourceCount: 1,
            created: '2026-01-05T10:00:00Z',
            lastModified: p.latestVim?.created ?? '2026-01-05T10:00:00Z',
            latestVim: p.latestVim,
          })),
        ),
      )
      return
    }

    const projectRoute = /^\/project\/([^/]+)(\/.*)?$/.exec(path)
    if (projectRoute) {
      const found = findProject(projectRoute[1])
      if (!found) {
        // A project the caller cannot see is a 404, never a 403.
        await route.fulfill(problem(404, 'Not Found', 'No such project.'))
        return
      }
      const rest = projectRoute[2] ?? ''
      const data = /^\/data\/([^/]+)/.exec(rest)
      if (data) {
        await counted(decodeURIComponent(data[1]), () => handleProjectRoute(route, method, rest, found, url))
      } else {
        await handleProjectRoute(route, method, rest, found, url)
      }
      return
    }

    await route.fulfill(problem(404, 'Not Found', `The mock has no route for ${method} ${path}.`))
  })

  async function handleProjectRoute(
    route: Route,
    method: string,
    rest: string,
    found: { org: MockOrg; project: MockProject },
    url: URL,
  ): Promise<void> {
    const { org, project } = found

    if (rest === '' && method === 'GET') {
      await route.fulfill(
        json({
          id: project.id,
          name: project.name,
          status: 'Ready',
          organizationId: org.id,
          created: '2026-01-05T10:00:00Z',
          lastModified: project.latestVim?.created ?? '2026-01-05T10:00:00Z',
          sources: [],
          members: [],
          latestRun: null,
          latestVim: project.latestVim,
        }),
      )
      return
    }

    if (rest === '/role' && method === 'GET') {
      await route.fulfill(json({ projectId: project.id, role: project.role }))
      return
    }

    if (rest === '/vim' && method === 'GET') {
      await route.fulfill(
        json({
          latest: project.latestVim,
          history: project.latestVim ? [project.latestVim] : [],
        }),
      )
      return
    }

    if (rest === '/vim/download' && method === 'GET') {
      if (!project.latestVim) {
        await route.fulfill(problem(404, 'Not Found', 'This project has no VIM.'))
        return
      }
      if (url.searchParams.get('redirect') === 'false') {
        await route.fulfill(
          json({ url: BLOB_URL, expiresAtUtc: '2099-01-01T00:00:00Z' }),
        )
        return
      }
      await route.fulfill({ status: 302, headers: { location: BLOB_URL }, body: '' })
      return
    }

    // --- custom data store ---
    const batch = /^\/data\/([^/]+)$/.exec(rest)
    if (batch) {
      const namespace = decodeURIComponent(batch[1])
      if (method === 'GET') {
        if (await readRefused(route, { namespace })) return
        // A list carries no ETags: the real server sends them only for a
        // single-entry read, which is the only read that can be written back.
        const entries = [...bucket(namespace)].map(([key, item]) => ({
          key,
          value: item.value,
        }))
        await answerRead(route, { namespace }, json(entries, 200, { 'X-Total-Count': String(entries.length) }))
        return
      }
      if (method === 'PUT') {
        if (await refused(route, { kind: 'put-batch', namespace })) return
        const body = route.request().postDataJSON() as unknown
        const entries = Array.isArray(body) ? (body as { key: string; value: unknown }[]) : []
        let created = 0
        let updated = 0
        for (const item of entries) {
          const existing = bucket(namespace).get(item.key)
          bucket(namespace).set(item.key, {
            value: item.value,
            version: (existing?.version ?? 0) + 1,
          })
          if (existing) updated++
          else created++
        }
        handle.writes.push({ kind: 'put-batch', namespace, entries })
        await route.fulfill(json({ created, updated }))
        return
      }
      if (method === 'DELETE') {
        if (await refused(route, { kind: 'delete-namespace', namespace })) return
        store.delete(namespace)
        handle.writes.push({ kind: 'delete', namespace, keys: ['*'] })
        await route.fulfill({ status: 204, body: '' })
        return
      }
    }

    const batchDelete = /^\/data\/([^/]+)\/delete$/.exec(rest)
    if (batchDelete && method === 'POST') {
      const namespace = decodeURIComponent(batchDelete[1])
      if (await refused(route, { kind: 'delete-batch', namespace })) return
      const body = route.request().postDataJSON() as unknown
      const keys = Array.isArray(body) ? (body as string[]) : []
      let deleted = 0
      for (const key of keys) if (bucket(namespace).delete(key)) deleted++
      handle.writes.push({ kind: 'delete', namespace, keys })
      await route.fulfill(json({ deleted }))
      return
    }

    const single = /^\/data\/([^/]+)\/([^/]+)$/.exec(rest)
    if (single) {
      const namespace = decodeURIComponent(single[1])
      const key = decodeURIComponent(single[2])

      if (method === 'GET') {
        if (await readRefused(route, { namespace, key })) return
        const existing = bucket(namespace).get(key)
        if (!existing) {
          await answerRead(route, { namespace, key }, problem(404, 'Not Found', 'No such key.'))
          return
        }
        await answerRead(
          route,
          { namespace, key },
          json({ key, value: existing.value }, 200, {
            ETag: `"${existing.version}"`,
            'Access-Control-Expose-Headers': 'ETag, X-Total-Count',
          }),
        )
        return
      }
      if (method === 'PUT') {
        if (await refused(route, { kind: 'put', namespace, key })) return
        options.beforeEntryWrite?.({ namespace, key }, store)
        const existing = bucket(namespace).get(key)
        const ifMatch = await route.request().headerValue('if-match')
        const ifNoneMatch = await route.request().headerValue('if-none-match')
        const value = route.request().postDataJSON() as unknown
        const record = (): void => {
          handle.writes.push({ kind: 'put', namespace, key, value, ifMatch, ifNoneMatch })
        }
        // If-None-Match: * is a create-only write.
        if (ifNoneMatch === '*' && existing) {
          record()
          await route.fulfill(problem(412, 'Precondition Failed', 'This entry already exists.'))
          return
        }
        // ETag is a quoted write-version; a stale one loses the race.
        if (ifMatch && ifMatch.replace(/"/g, '') !== String(existing?.version ?? 0)) {
          record()
          await route.fulfill(
            problem(412, 'Precondition Failed', 'Someone else wrote this entry first.'),
          )
          return
        }
        bucket(namespace).set(key, { value, version: (existing?.version ?? 0) + 1 })
        record()
        await route.fulfill({ status: existing ? 200 : 201, body: '' })
        return
      }
      if (method === 'DELETE') {
        if (await refused(route, { kind: 'delete', namespace, key })) return
        bucket(namespace).delete(key)
        handle.writes.push({ kind: 'delete', namespace, keys: [key] })
        await route.fulfill({ status: 204, body: '' })
        return
      }
    }

    await route.fulfill(
      problem(404, 'Not Found', `The mock has no project route for ${method} ${rest}.`),
    )
  }

  await installBlobRoute(page)
  return handle
}

/**
 * Serves the .vim fixture the way Azure Blob Storage does. The vim-web loader
 * issues concurrent Range GETs, so 206 + Content-Range + Content-Length must be
 * exact or the loader retries forever.
 */
async function installBlobRoute(page: Page): Promise<void> {
  const file = readFileSync(FIXTURE)

  await page.route(`${BLOB_ORIGIN}/**`, async (route) => {
    const request = route.request()
    const common = {
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      // Blob storage exposes these; without them a cross-origin reader cannot
      // see how big the file is or which slice it got.
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, ETag',
      'Content-Type': 'application/octet-stream',
    }

    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
        body: '',
      })
      return
    }

    if (request.method() === 'HEAD') {
      await route.fulfill({
        status: 200,
        headers: { ...common, 'Content-Length': String(file.length) },
        body: '',
      })
      return
    }

    const range = await request.headerValue('range')
    const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (!match) {
      await route.fulfill({
        status: 200,
        headers: { ...common, 'Content-Length': String(file.length) },
        body: file,
      })
      return
    }

    // A suffix range ("bytes=-500") asks for the last N bytes.
    const hasStart = match[1] !== ''
    const start = hasStart ? Number(match[1]) : Math.max(0, file.length - Number(match[2]))
    const end = hasStart && match[2] !== '' ? Math.min(Number(match[2]), file.length - 1) : file.length - 1

    if (start >= file.length || start > end) {
      await route.fulfill({
        status: 416,
        headers: { ...common, 'Content-Range': `bytes */${file.length}` },
        body: '',
      })
      return
    }

    const slice = file.subarray(start, end + 1)
    await route.fulfill({
      status: 206,
      headers: {
        ...common,
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Content-Length': String(slice.length),
      },
      body: slice,
    })
  })
}
