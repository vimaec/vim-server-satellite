/**
 * The DS overlay menu (vim-html-ds `molecules/ds-menu.ts`) as a React component.
 *
 * Same DOM as the factory: a transparent `.ds-menu-backdrop` and an opaque
 * `.ds-menu` of `.ds-menu__item` rows, both on document.body. The backdrop
 * takes the outside press that closes the menu. Keyboard as the DS: ↑ / ↓ /
 * Home / End rove the enabled rows, a printable key types ahead, Enter / Space
 * activates, Escape and Tab close, and focus goes back to the anchor.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { clampFixed, cx, dataAttributes } from './util'
import type { DataAttributes } from './util'

export type MenuItem = DataAttributes & {
  label: string
  /** A leading glyph (literal text from icons.ts ICON_GLYPHS). */
  icon?: string
  /** Colour for `icon`. Default: the dim text tone. */
  iconColor?: string
  /** A colour swatch before the label (any CSS colour). */
  dot?: string
  /** Dim trailing context: a count, a shortcut. */
  hint?: string
  /** A sentence that explains the row, shown as a DS tip on hover. */
  tip?: string
  disabled?: boolean
  /** The current choice: cyan text and a drawn check. */
  selected?: boolean
  /** A stable verb for tests and analytics, emitted as `data-action`. */
  action?: string
  onClick?: () => void
}

export type MenuEntry = MenuItem | 'separator'

export type MenuProps = DataAttributes & {
  /** Rendered only while open. */
  open: boolean
  /** Viewport position of the top-left corner; the menu is moved in to stay on screen. */
  x: number
  y: number
  items: MenuEntry[]
  /** Outside press, Escape, Tab, or a row was picked (before its onClick runs). The parent sets `open` false. */
  onClose: () => void
  /** Where focus goes back to on close (the button that opened the menu). */
  anchor?: HTMLElement | null
  /** `data-testid` of every row. Default `menu-item`. */
  itemTestId?: string
  className?: string
}

/** Idle time that clears the type-ahead prefix (as the DS). */
const TYPE_AHEAD_MS = 500

export function Menu(props: MenuProps): JSX.Element | null {
  const { open, x, y, items, onClose, anchor, itemTestId = 'menu-item' } = props
  const menuRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  /**
   * Every close the menu decides itself: focus goes back to the anchor first,
   * while the focused row still exists (after React removes it, focus is lost).
   */
  const close = (): void => {
    const menu = menuRef.current
    const active = document.activeElement as HTMLElement | null
    if (menu && active && menu.contains(active)) {
      if (anchor) anchor.focus()
      else active.blur()
    }
    onClose()
  }
  // The newest close, for the window listener that is bound once per open.
  const closeRef = useRef(close)
  closeRef.current = close

  // Place it and focus the first enabled row, before the browser paints.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!open || !menu) return
    clampFixed(menu, x, y)
    rows(menu)[0]?.focus()
    // Not on every items change: a re-render while open must not move the focus.
  }, [open, x, y])

  // Escape closes, and stops there: a dialog under the menu must not close too.
  useEffect(() => {
    if (!open) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!open) return null

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const menu = menuRef.current
    if (!menu) return
    const key = event.key
    if (key === 'Tab') {
      close()
      return
    }
    if (key === 'Enter' || key === ' ') return // the row's own handler activates
    const list = rows(menu)
    const index = list.indexOf(document.activeElement as HTMLElement)
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      if (!list.length) return
      event.preventDefault()
      const n = list.length
      const next =
        key === 'Home' ? 0 : key === 'End' ? n - 1 : key === 'ArrowDown' ? (index + 1) % n : index <= 0 ? n - 1 : index - 1
      list[next]?.focus()
      return
    }
    if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault()
      // Prefix search: a repeated single letter cycles, a longer prefix narrows.
      const now = Date.now()
      if (now - typed.current.at > TYPE_AHEAD_MS) typed.current.text = ''
      typed.current.at = now
      const c = key.toLowerCase()
      if (typed.current.text !== c) typed.current.text += c
      const prefix = typed.current.text
      const from = prefix.length === 1 ? index + 1 : Math.max(index, 0)
      for (let k = 0; k < list.length; k++) {
        const row = list[(from + k) % list.length]
        if ((row.dataset.label ?? '').toLowerCase().startsWith(prefix)) {
          row.focus()
          return
        }
      }
    }
  }

  const run = (item: MenuItem): void => {
    close()
    item.onClick?.()
  }

  return createPortal(
    <>
      <div
        className="ds-menu-backdrop ds-open"
        onMouseDown={close}
        onContextMenu={(event) => {
          event.preventDefault()
          close()
        }}
      />
      <div
        {...dataAttributes(props)}
        ref={menuRef}
        className={cx('ds-menu ds-open', props.className)}
        role="menu"
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((item, i) => {
          if (item === 'separator') return <div key={`sep-${i}`} className="ds-menu__sep" role="separator" />
          return (
            <div
              {...dataAttributes(item)}
              key={`${i}-${item.label}`}
              className={cx('ds-menu__item', item.disabled && 'ds-disabled', item.selected && 'ds-selected')}
              role="menuitem"
              tabIndex={item.disabled ? -1 : 0}
              aria-disabled={item.disabled || undefined}
              data-testid={item['data-testid'] ?? itemTestId}
              data-action={item.action}
              data-label={item.label}
              data-enabled={item.disabled ? undefined : ''}
              data-ds-tip={item.tip}
              onClick={() => {
                if (!item.disabled) run(item)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                if (!item.disabled) run(item)
              }}
            >
              {item.icon ? (
                <span className="ds-icon" style={item.iconColor ? { color: item.iconColor } : undefined}>
                  {item.icon}
                </span>
              ) : null}
              {item.dot ? <span className="ds-seldot" style={{ background: item.dot }} /> : null}
              <span className="ds-menu__label">{item.label}</span>
              {item.hint ? <span className="ds-menu__hint">{item.hint}</span> : null}
            </div>
          )
        })}
      </div>
    </>,
    document.body,
  )
}

/** The enabled rows, in order: what the arrows and the type-ahead move through. */
function rows(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('.ds-menu__item[data-enabled]'))
}
