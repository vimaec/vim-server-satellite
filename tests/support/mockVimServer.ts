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

/** The only token the mock accepts; useFakeSession() and mockEntraToken() hand it out. */
export const GOOD_TOKEN = 'e2e-token'

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
  role: 'Viewer' | 'Manager' | 'Admin'
  latestVim: MockBlob | null
}

export type MockOrg = {
  id: string
  name: string
  role: string
  projects: MockProject[]
}

export type RecordedWrite =
  | { kind: 'put'; namespace: string; key: string; value: unknown; ifMatch: string | null }
  | { kind: 'put-batch'; namespace: string; entries: { key: string; value: unknown }[] }
  | { kind: 'delete'; namespace: string; keys: string[] }

export type MockOptions = {
  orgs?: MockOrg[]
  /** Seed the project data store: namespace -> key -> value. */
  data?: Record<string, Record<string, unknown>>
  /** Answer every authenticated API call with 401 (session-expiry test). */
  unauthorized?: boolean
}

export type MockHandle = {
  orgs: MockOrg[]
  /** namespace -> key -> { value, version }. `version` is the ETag integer. */
  store: Map<string, Map<string, { value: unknown; version: number }>>
  writes: RecordedWrite[]
  /** "GET /org", "PUT /project/p-tiny/data/satellite.labels/x", … in order. */
  calls: string[]
  /** Flip the 401 switch after the page has signed in. */
  setUnauthorized: (value: boolean) => void
  entry: (namespace: string, key: string) => unknown
}

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
  const store = new Map<string, Map<string, { value: unknown; version: number }>>()
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
    if (unauthorized || authorization !== `Bearer ${GOOD_TOKEN}`) {
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
      await handleProjectRoute(route, method, projectRoute[2] ?? '', found, url)
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
        const entries = [...bucket(namespace)].map(([key, item]) => ({
          key,
          value: item.value,
          etag: `"${item.version}"`,
        }))
        await route.fulfill(
          json(entries, 200, { 'X-Total-Count': String(entries.length) }),
        )
        return
      }
      if (method === 'PUT') {
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
        store.delete(namespace)
        handle.writes.push({ kind: 'delete', namespace, keys: ['*'] })
        await route.fulfill({ status: 204, body: '' })
        return
      }
    }

    const batchDelete = /^\/data\/([^/]+)\/delete$/.exec(rest)
    if (batchDelete && method === 'POST') {
      const namespace = decodeURIComponent(batchDelete[1])
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
      const existing = bucket(namespace).get(key)

      if (method === 'GET') {
        if (!existing) {
          await route.fulfill(problem(404, 'Not Found', 'No such key.'))
          return
        }
        await route.fulfill(
          json({ key, value: existing.value }, 200, {
            ETag: `"${existing.version}"`,
            'Access-Control-Expose-Headers': 'ETag, X-Total-Count',
          }),
        )
        return
      }
      if (method === 'PUT') {
        const ifMatch = await route.request().headerValue('if-match')
        const value = route.request().postDataJSON() as unknown
        // ETag is a quoted write-version; a stale one loses the race.
        if (ifMatch && ifMatch.replace(/"/g, '') !== String(existing?.version ?? 0)) {
          handle.writes.push({ kind: 'put', namespace, key, value, ifMatch })
          await route.fulfill(
            problem(412, 'Precondition Failed', 'Someone else wrote this entry first.'),
          )
          return
        }
        bucket(namespace).set(key, { value, version: (existing?.version ?? 0) + 1 })
        handle.writes.push({ kind: 'put', namespace, key, value, ifMatch })
        await route.fulfill({ status: existing ? 200 : 201, body: '' })
        return
      }
      if (method === 'DELETE') {
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
