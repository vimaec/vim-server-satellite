/**
 * Category > Family > Element, built from the flat ModelElement list.
 *
 * The tree can hold thousands of leaves, so it stays cheap the plain way:
 * groups are collapsed by default and a collapsed group renders no children at
 * all. No virtualization library is needed for that.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { elementKey } from '../labels/types'
import type { ModelElement } from './buildModel'

/** How a click changes the selection. */
export type SelectMode = 'replace' | 'toggle' | 'add'

export type ElementTreeProps = {
  elements: ModelElement[]
  /** Selected element indices. */
  selection: number[]
  /** Element index -> `#rrggbb` for the label dot. */
  colors: Map<number, string>
  onSelect: (indices: number[], mode: SelectMode) => void
  onFrame: () => void
  /** Shown instead of the tree while there is nothing to show. */
  placeholder?: string
}

const NO_CATEGORY = 'Uncategorized'
const NO_FAMILY = '(No family)'

type Leaf = { element: ModelElement; label: string }
type Family = { key: string; name: string; leaves: Leaf[] }
type Category = { key: string; name: string; families: Family[]; count: number }

function leafLabel(element: ModelElement): string {
  return `${element.name && element.name.length > 0 ? element.name : 'Element'} [${element.elementId}]`
}

function matches(element: ModelElement, needle: string): boolean {
  return (
    (element.name ?? '').toLowerCase().includes(needle) ||
    element.elementId.toLowerCase().includes(needle) ||
    (element.category ?? '').toLowerCase().includes(needle) ||
    (element.family ?? '').toLowerCase().includes(needle)
  )
}

/** Groups the elements and sorts every level by name. */
function buildTree(elements: ModelElement[], search: string): Category[] {
  const needle = search.trim().toLowerCase()
  const byCategory = new Map<string, Map<string, Leaf[]>>()

  for (const element of elements) {
    if (needle && !matches(element, needle)) continue
    const categoryName = element.category || NO_CATEGORY
    const familyName = element.family || NO_FAMILY
    let families = byCategory.get(categoryName)
    if (!families) {
      families = new Map()
      byCategory.set(categoryName, families)
    }
    const leaves = families.get(familyName)
    const leaf: Leaf = { element, label: leafLabel(element) }
    if (leaves) leaves.push(leaf)
    else families.set(familyName, [leaf])
  }

  const byName = (a: { name: string }, b: { name: string }): number =>
    a.name.localeCompare(b.name)

  return [...byCategory]
    .map(([name, families]): Category => {
      const grouped = [...families]
        .map(([familyName, leaves]): Family => ({
          key: `${name}/${familyName}`,
          name: familyName,
          leaves: leaves.sort((a, b) => a.label.localeCompare(b.label)),
        }))
        .sort(byName)
      return {
        key: name,
        name,
        families: grouped,
        count: grouped.reduce((total, family) => total + family.leaves.length, 0),
      }
    })
    .sort(byName)
}

export function ElementTree({
  elements,
  selection,
  colors,
  onSelect,
  onFrame,
  placeholder,
}: ElementTreeProps): JSX.Element {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const listRef = useRef<HTMLDivElement>(null)

  const tree = useMemo(() => buildTree(elements, search), [elements, search])
  const selected = useMemo(() => new Set(selection), [selection])

  // Where each element sits, so a selection made in the 3D view can open the
  // groups that contain it.
  const pathByIndex = useMemo(() => {
    const paths = new Map<number, [string, string]>()
    for (const element of elements) {
      paths.set(element.index, [
        element.category || NO_CATEGORY,
        `${element.category || NO_CATEGORY}/${element.family || NO_FAMILY}`,
      ])
    }
    return paths
  }, [elements])

  // A filtered tree only contains matches, so everything in it is open.
  const filtering = search.trim().length > 0
  const isOpen = (key: string): boolean => filtering || expanded.has(key)

  const toggle = (key: string): void =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // Reveal the first selected element wherever the selection came from.
  const first = selection[0]
  useEffect(() => {
    if (first === undefined) return
    const path = pathByIndex.get(first)
    if (!path) return
    setExpanded((previous) => {
      if (path.every((key) => previous.has(key))) return previous
      const next = new Set(previous)
      for (const key of path) next.add(key)
      return next
    })
  }, [first, pathByIndex])

  useEffect(() => {
    if (first === undefined) return
    const row = listRef.current?.querySelector(`[data-element-index="${first}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [first, expanded, tree])

  return (
    <section className="tree" data-testid="element-tree">
      <div className="tree-toolbar">
        <input
          type="search"
          data-testid="tree-search"
          placeholder="Search elements…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" data-testid="frame-selection" onClick={onFrame}>
          Frame
        </button>
      </div>

      <div className="tree-rows" ref={listRef} role="tree" aria-label="Model elements">
        {tree.length === 0 ? (
          <p className="muted small">
            {placeholder ?? (elements.length === 0 ? 'No elements.' : 'Nothing matches.')}
          </p>
        ) : null}

        {tree.map((category) => (
          <div key={category.key} data-testid="tree-category" data-name={category.name}>
            <button
              type="button"
              className="tree-group"
              aria-expanded={isOpen(category.key)}
              onClick={() => toggle(category.key)}
            >
              <span className="chevron">{isOpen(category.key) ? '▾' : '▸'}</span>
              <span className="tree-name">{category.name}</span>
              <span className="muted small">({category.count})</span>
            </button>

            {isOpen(category.key)
              ? category.families.map((family) => (
                  <div
                    key={family.key}
                    data-testid="tree-family"
                    data-name={family.name}
                    className="tree-indent"
                  >
                    <button
                      type="button"
                      className="tree-group"
                      aria-expanded={isOpen(family.key)}
                      onClick={() => toggle(family.key)}
                    >
                      <span className="chevron">{isOpen(family.key) ? '▾' : '▸'}</span>
                      <span className="tree-name">{family.name}</span>
                      <span className="muted small">({family.leaves.length})</span>
                    </button>

                    {isOpen(family.key)
                      ? family.leaves.map(({ element, label }) => {
                          const color = colors.get(element.index)
                          return (
                            <div
                              key={element.index}
                              className="tree-indent"
                              role="treeitem"
                              data-testid="tree-element"
                              data-element-index={element.index}
                              data-element-key={elementKey(element)}
                              aria-selected={selected.has(element.index)}
                              onClick={(event) =>
                                onSelect(
                                  [element.index],
                                  event.ctrlKey || event.metaKey
                                    ? 'toggle'
                                    : event.shiftKey
                                      ? 'add'
                                      : 'replace',
                                )
                              }
                            >
                              <span className="tree-leaf">
                                {color ? (
                                  <span
                                    className="tree-element-label"
                                    data-testid="tree-element-label"
                                    data-color={color}
                                    style={{ background: color }}
                                    title="Labelled"
                                  />
                                ) : null}
                                {label}
                              </span>
                            </div>
                          )
                        })
                      : null}
                  </div>
                ))
              : null}
          </div>
        ))}
      </div>
    </section>
  )
}
