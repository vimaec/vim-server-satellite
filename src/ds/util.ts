/**
 * Small helpers the DS components share. Internal to src/ds.
 */
import type { CSSProperties } from 'react'

/**
 * `data-*` attributes a caller passes straight through to a component's DOM
 * (`data-testid`, `data-key`, ...). Typed as an index signature so any data
 * attribute is accepted without a prop per name.
 */
export type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined }

/** Props every DS component accepts. */
export type CommonProps = DataAttributes & {
  /** Extra classes, added after the DS classes (for layout only; ds.css owns the look). */
  className?: string
  /** Inline style, for layout only (width, flex). Colours come from ds.css tokens. */
  style?: CSSProperties
  disabled?: boolean
}

/** Joins class names, skipping the falsy ones. */
export function cx(...names: (string | false | 0 | null | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

/** The `data-*` entries of a props object, ready to spread onto an element. */
export function dataAttributes(props: object): DataAttributes {
  const out: DataAttributes = {}
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('data-')) out[key as `data-${string}`] = value as string | number | boolean | undefined
  }
  return out
}

/**
 * Keeps a fixed-position box inside the window, as vim-html-ds `clampFixed`
 * does: a menu opened near the right or bottom edge moves in, it is not cut off.
 */
export function clampFixed(node: HTMLElement, x: number, y: number, pad = 8): void {
  const rect = node.getBoundingClientRect()
  node.style.left = `${Math.max(pad, Math.min(x, innerWidth - rect.width - pad))}px`
  node.style.top = `${Math.max(pad, Math.min(y, innerHeight - rect.height - pad))}px`
}
