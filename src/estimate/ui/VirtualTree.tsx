/**
 * A windowed tree: a sticky column header over fixed-height rows, of which
 * only the ones in view (plus a margin) are in the DOM. A 20k-element model
 * then costs ~60 row components, not 20k.
 *
 * Header and rows live in ONE scroll box, so they scroll sideways together and
 * share one width: a column's label stays over its cells whatever the panel
 * width, the scrollbar, or the horizontal scroll. The DS virtual tree
 * (`.ds-tree--virtual`) keeps its header outside the scroll box and has no
 * horizontal scroll, which a 9-column estimate needs in a narrow panel.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode, RefObject } from 'react'
import { cx } from '../../ds'

/** The row height, in px; `.en-vt` rows are drawn to it (styles.css `--en-row-h`). */
export const ROW_HEIGHT = 26

/** Rows rendered above and below the visible ones, so a fast scroll does not show blanks. */
const OVERSCAN = 8

export type VirtualTreeProps = {
  rowCount: number
  /** The row at `index` (a keyed element). Called only for the rows in the window. */
  renderRow: (index: number) => ReactNode
  /** The column header row. */
  header: ReactNode
  /** Below this width the tree scrolls sideways instead of squeezing its columns. */
  minWidth: number
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode
  /** A right-click on the empty part of the tree. */
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
  className?: string
  'data-testid'?: string
}

/** The scroll position and viewport height, as React state (they decide the window). */
function useViewport(): {
  ref: RefObject<HTMLDivElement>
  scrollTop: number
  height: number
  onScroll: () => void
} {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)
  // A hidden tab panel measures 0: watch the size, so the rows appear when it shows.
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    setHeight(node.clientHeight)
    const observer = new ResizeObserver(() => setHeight(node.clientHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const onScroll = (): void => {
    const node = ref.current
    if (node) setScrollTop(node.scrollTop)
  }
  return { ref, scrollTop, height, onScroll }
}

export function VirtualTree(props: VirtualTreeProps): JSX.Element {
  const { rowCount, renderRow } = props
  const { ref, scrollTop, height, onScroll } = useViewport()

  // Fewer rows than before (a collapse, a narrower search): the browser clamps
  // scrollTop on its own, but the window must follow it now, not on the next scroll.
  useEffect(() => {
    const node = ref.current
    if (node && node.scrollTop !== scrollTop) onScroll()
  })

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rowCount - 1, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)
  const rows: ReactNode[] = []
  for (let index = first; index <= last; index++) rows.push(renderRow(index))

  return (
    <div
      ref={ref}
      className={cx('en-vt', props.className)}
      data-testid={props['data-testid']}
      role="tree"
      onScroll={onScroll}
      onContextMenu={props.onContextMenu}
    >
      <div className="en-vt__canvas" style={{ minWidth: props.minWidth }}>
        <div className="en-vt__head">{props.header}</div>
        {rowCount === 0 ? (
          props.empty
        ) : (
          <div className="en-vt__body" style={{ height: rowCount * ROW_HEIGHT }}>
            <div className="en-vt__rows" style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
              {rows}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
