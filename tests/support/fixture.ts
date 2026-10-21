/**
 * The Tiny House fixture read in Node with vim-format (the BIM package vim-web
 * is built on), so a test knows the elements' keys and quantities without
 * asking the app it is testing.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { readFacts } from '../../src/estimate/quantities'
import type { ElementFacts } from '../../src/estimate/types'

// vim-format ships CommonJS with no "main", so neither an ESM import nor a bare
// require finds it; require its entry file directly.
const { BFast, VimDocument } = createRequire(import.meta.url)(
  'vim-format/dist/index.js',
) as typeof import('vim-format')

const FIXTURE = new URL('../fixtures/Tiny_House_Imperial.r2026.vim', import.meta.url)

let cached: Promise<Map<number, ElementFacts>> | null = null

/**
 * The estimate facts of every fixture element with geometry, by element
 * index. Scope here is "elements with a node", which is what vim-web's
 * `hasGeometry` means. Read once per worker.
 */
export function fixtureFacts(): Promise<Map<number, ElementFacts>> {
  cached ??= (async () => {
    const file = readFileSync(FIXTURE)
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
    const bim = await VimDocument.createFromBfast(new BFast({ buffer }))
    if (!bim) throw new Error('The fixture has no BIM document.')
    const [nodeElement, ids, uniqueIds] = await Promise.all([
      bim.node?.getAllElementIndex(),
      bim.element?.getAllId(),
      bim.element?.getAllUniqueId(),
    ])
    const withGeometry = [...new Set((nodeElement ?? []).filter((index) => index >= 0))].sort(
      (a, b) => a - b,
    )
    const scope = withGeometry.map((index) => ({
      index,
      elementId: String(ids?.[index] ?? -1),
      uniqueId: uniqueIds?.[index] || undefined,
    }))
    return readFacts(bim, scope)
  })()
  return cached
}

/** The facts of one fixture element; throws when it is not in scope. */
export async function fixtureElement(index: number): Promise<ElementFacts> {
  const facts = (await fixtureFacts()).get(index)
  if (!facts) throw new Error(`Element ${index} is not in the fixture's scope.`)
  return facts
}
