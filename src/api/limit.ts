/**
 * Bounded concurrency for fan-outs over VIM Server.
 *
 * `Promise.all(items.map(send))` sends every request at once. VIM Server does
 * not take that well: a burst of a few dozen batch requests from one tab gets
 * some of them answered with a 5xx or with a redirect to the sign-in page (see
 * http.ts). A small pool is about as fast, because the server is the
 * bottleneck either way, and it stays within what the server handles.
 */

/**
 * Runs `fn` over `items` with at most `limit` calls in flight, and resolves to
 * the results in input order.
 *
 * On the first failure no new item starts, but the result settles only once
 * the calls already in flight have ended, and then rejects with that first
 * failure. So when the caller reacts to the failure (rolls back, re-reads),
 * none of its requests is still on the way to the server and lands later.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  let firstCause: unknown

  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await fn(items[index], index)
      } catch (cause: unknown) {
        if (!failed) firstCause = cause
        failed = true
      }
    }
  }

  const workers = Math.min(Math.max(1, Math.floor(limit)), items.length)
  await Promise.all(Array.from({ length: workers }, worker))
  if (failed) throw firstCause
  return results
}
