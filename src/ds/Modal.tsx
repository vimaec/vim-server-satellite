/**
 * The DS dialog (vim-html-ds `organisms/ds-modal.ts`) as a React component.
 *
 * Same DOM: `.ds-modal-backdrop > .ds-modal > head / body / foot`, on
 * document.body. Closes on the ×, Escape and a backdrop press (all the
 * cancel path), unless `dismissible` is false. Focus is trapped inside while
 * open and goes back to the opener on close. Foot order, as the DS rule: the
 * dismissing button first, the primary action LAST (bottom-right).
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ICON_GLYPHS } from './icons'
import { cx, dataAttributes } from './util'
import type { DataAttributes } from './util'

export type ModalProps = DataAttributes & {
  /** Rendered only while open. */
  open: boolean
  title?: ReactNode
  /** Fixed widths from the DS scale: sm 360px, md 480px, lg 640px. Default: content, 320px to 90vw. */
  size?: 'sm' | 'md' | 'lg'
  /** The narrow message-only dialog (360px). */
  variant?: 'confirm'
  /** The ×, Escape, or a backdrop press. The parent sets `open` false. */
  onClose: () => void
  /** False: only the dialog's own buttons close it (no ×, no Escape, no backdrop). Default true. */
  dismissible?: boolean
  /** False: a backdrop press does not close it (× and Escape still do). Default true. */
  closeOnBackdrop?: boolean
  /** The buttons. Left out, there is no foot. */
  foot?: ReactNode
  /** The body. */
  children?: ReactNode
  /** Focused on open. Default: the first focusable control that is not the ×. */
  initialFocus?: { current: HTMLElement | null }
  className?: string
}

/** Open dialogs, oldest first: only the top one answers Escape. */
const openStack: object[] = []

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function Modal(props: ModalProps): JSX.Element | null {
  const { open, onClose, dismissible = true, closeOnBackdrop = true } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible

  // Focus in on open, back to the opener on close.
  useLayoutEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const root = rootRef.current
    if (root) {
      const target =
        props.initialFocus?.current ??
        focusables(root).find((element) => element !== closeRef.current) ??
        root
      target.focus()
      if (target instanceof HTMLInputElement) target.select()
    }
    return () => {
      if (opener && document.contains(opener)) opener.focus()
    }
    // initialFocus is read once per open, on purpose.
  }, [open])

  // Escape, for the top-most dialog only.
  useEffect(() => {
    if (!open) return
    const token = {}
    openStack.push(token)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || openStack[openStack.length - 1] !== token) return
      if (!dismissibleRef.current) return
      event.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const at = openStack.indexOf(token)
      if (at >= 0) openStack.splice(at, 1)
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="ds-modal-backdrop ds-open"
      onMouseDown={(event) => {
        if (dismissible && closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        {...dataAttributes(props)}
        ref={rootRef}
        className={cx(
          'ds-modal',
          props.variant === 'confirm' && 'ds-modal--confirm',
          props.size && `ds-modal--${props.size}`,
          props.className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={typeof props.title === 'string' ? props.title : undefined}
        tabIndex={-1}
        onKeyDown={(event) => {
          // Focus trap: Tab cycles within the dialog.
          if (event.key !== 'Tab' || !rootRef.current) return
          const list = focusables(rootRef.current)
          if (list.length === 0) {
            event.preventDefault()
            return
          }
          const first = list[0]
          const last = list[list.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div className="ds-modal__head">
          <div className="ds-modal__title">{props.title}</div>
          {dismissible ? (
            <button ref={closeRef} type="button" className="ds-modal__close" aria-label="Close" onClick={onClose}>
              {ICON_GLYPHS.clear}
            </button>
          ) : null}
        </div>
        <div className="ds-modal__body">{props.children}</div>
        {props.foot ? <div className="ds-modal__foot">{props.foot}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute('disabled'),
  )
}
