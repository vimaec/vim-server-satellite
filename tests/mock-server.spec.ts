/**
 * Tests for the test harness itself.
 *
 * The two tricky parts of the mock are checked on their own terms, so a broken
 * harness fails as a harness rather than as a mysterious viewer timeout: HTTP
 * Range replies for the .vim download, and the preconditions on the project
 * data store.
 */
import { expect, test } from '@playwright/test'
import { API, BLOB_URL, GOOD_TOKEN, installMockVimServer } from './support/mockVimServer'

const FIXTURE_SIZE = 252_160

test.describe('mock VIM Server', () => {
  test('the blob route answers byte ranges the way the loader expects', async ({ page }) => {
    await installMockVimServer(page)
    await page.goto('/')

    const probe = await page.evaluate(async (url) => {
      const read = async (init?: RequestInit) => {
        const response = await fetch(url, init)
        const bytes = new Uint8Array(await response.arrayBuffer())
        return {
          status: response.status,
          contentRange: response.headers.get('content-range'),
          contentLength: response.headers.get('content-length'),
          acceptRanges: response.headers.get('accept-ranges'),
          bytes: bytes.length,
        }
      }
      const head = await fetch(url, { method: 'HEAD' })
      return {
        head: {
          status: head.status,
          contentLength: head.headers.get('content-length'),
          acceptRanges: head.headers.get('accept-ranges'),
        },
        whole: await read(),
        first: await read({ headers: { Range: 'bytes=0-15' } }),
        middle: await read({ headers: { Range: 'bytes=1000-1099' } }),
        openEnded: await read({ headers: { Range: 'bytes=252150-' } }),
        suffix: await read({ headers: { Range: 'bytes=-32' } }),
        past: await read({ headers: { Range: 'bytes=999999-' } }),
      }
    }, BLOB_URL)

    expect(probe.head).toEqual({
      status: 200,
      contentLength: String(FIXTURE_SIZE),
      acceptRanges: 'bytes',
    })
    expect(probe.whole.status).toBe(200)
    expect(probe.whole.bytes).toBe(FIXTURE_SIZE)

    expect(probe.first.status).toBe(206)
    expect(probe.first.contentRange).toBe(`bytes 0-15/${FIXTURE_SIZE}`)
    expect(probe.first.contentLength).toBe('16')
    expect(probe.first.bytes).toBe(16)

    expect(probe.middle.contentRange).toBe(`bytes 1000-1099/${FIXTURE_SIZE}`)
    expect(probe.middle.bytes).toBe(100)

    expect(probe.openEnded.contentRange).toBe(`bytes 252150-252159/${FIXTURE_SIZE}`)
    expect(probe.openEnded.bytes).toBe(10)

    expect(probe.suffix.contentRange).toBe(`bytes 252128-252159/${FIXTURE_SIZE}`)
    expect(probe.suffix.bytes).toBe(32)

    expect(probe.past.status).toBe(416)
  })

  test('the data store enforces If-Match and If-None-Match and records writes', async ({
    page,
  }) => {
    const mock = await installMockVimServer(page, {
      data: { 'satellite.palette': { palette: { labels: [] } } },
    })
    await page.goto('/')

    const result = await page.evaluate(
      async ([api, token]) => {
        const base = `${api}/project/p-tiny/data/satellite.palette`
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

        const read = await fetch(`${base}/palette`, { headers })
        const etag = read.headers.get('etag')

        const stale = await fetch(`${base}/palette`, {
          method: 'PUT',
          headers: { ...headers, 'If-Match': '"99"' },
          body: JSON.stringify({ labels: [{ id: 'a', name: 'Review', color: '#e5484d' }] }),
        })
        const fresh = await fetch(`${base}/palette`, {
          method: 'PUT',
          headers: { ...headers, 'If-Match': etag ?? '' },
          body: JSON.stringify({ labels: [{ id: 'a', name: 'Review', color: '#e5484d' }] }),
        })
        const missing = await fetch(`${base}/nope`, { headers })

        // If-None-Match: * is create-only, so it loses against an entry that exists.
        const createOnly = await fetch(`${base}/palette`, {
          method: 'PUT',
          headers: { ...headers, 'If-None-Match': '*' },
          body: JSON.stringify({ labels: [] }),
        })
        const created = await fetch(`${base}/fresh-key`, {
          method: 'PUT',
          headers: { ...headers, 'If-None-Match': '*' },
          body: JSON.stringify({ labels: [] }),
        })

        const batch = await fetch(`${api}/project/p-tiny/data/satellite.labels`, {
          method: 'PUT',
          headers,
          body: JSON.stringify([
            { key: 'uid-1', value: { labelId: 'a' } },
            { key: 'uid-2', value: { labelId: 'a' } },
          ]),
        })
        const removed = await fetch(`${api}/project/p-tiny/data/satellite.labels/delete`, {
          method: 'POST',
          headers,
          body: JSON.stringify(['uid-1']),
        })
        const list = await fetch(`${api}/project/p-tiny/data/satellite.labels`, { headers })

        return {
          etag,
          stale: stale.status,
          fresh: fresh.status,
          missing: missing.status,
          createOnly: createOnly.status,
          created: created.status,
          batch: (await batch.json()) as unknown,
          removed: (await removed.json()) as unknown,
          list: (await list.json()) as { key: string }[],
        }
      },
      [API, GOOD_TOKEN] as const,
    )

    expect(result.etag).toBe('"1"')
    expect(result.stale).toBe(412)
    expect(result.fresh).toBe(200)
    expect(result.missing).toBe(404)
    expect(result.createOnly).toBe(412)
    expect(result.created).toBe(201)
    expect(result.batch).toEqual({ created: 2, updated: 0 })
    expect(result.removed).toEqual({ deleted: 1 })
    expect(result.list.map((entry) => entry.key)).toEqual(['uid-2'])

    // The 412 did not change the stored value, the successful write did.
    expect(mock.entry('satellite.palette', 'palette')).toEqual({
      labels: [{ id: 'a', name: 'Review', color: '#e5484d' }],
    })
    expect(mock.writes.filter((write) => write.kind === 'put-batch')).toHaveLength(1)
  })

  test('an unauthenticated call is refused but /config is not', async ({ page }) => {
    await installMockVimServer(page)
    await page.goto('/')

    const result = await page.evaluate(async (api) => {
      const config = await fetch(`${api}/config`)
      const profile = await fetch(`${api}/profile`)
      return {
        config: config.status,
        configBody: (await config.json()) as unknown,
        profile: profile.status,
      }
    }, API)

    expect(result.config).toBe(200)
    expect(result.configBody).toEqual({ tenantId: 'mock-tenant-id', clientId: 'mock-client-id' })
    expect(result.profile).toBe(401)
  })
})
