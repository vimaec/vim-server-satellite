/**
 * The DS overlays that answer a function call: `confirm()`, `prompt()` and
 * `toast()`, plus the DS hover tooltip for every `data-ds-tip`.
 *
 * In vim-html-ds these are factories that put nodes on document.body. In React
 * something has to render them, so `<DsHost />` is mounted ONCE, next to the
 * app (see main.tsx). The helpers push a request into a small module store and
 * DsHost renders it; a call made before the host mounts waits in the store.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Button, Input } from './atoms'
import { FormField } from './blocks'
import { Modal } from './Modal'
import { clampFixed, cx } from './util'

/* ---- The store --------------------------------------------------------------------------------- */

export type ConfirmOptions = {
  title: string
  /** The message; a "\n" starts a new line. */
  text?: string
  /** Default "OK". Pass the translated verb ("Delete"). */
  confirmLabel?: string
  /** Default "Cancel". */
  cancelLabel?: string
  /** The confirm button is red (`ds-btn--danger`). */
  destructive?: boolean
  /** A typed-word gate: confirm stays disabled until this exact text is typed. */
  requireText?: string
  requirePlaceholder?: string
}

export type PromptOptions = {
  title: string
  /** The field label. Default "Name". */
  label?: string
  /** The starting text, selected on open. */
  value?: string
  /** Default "OK". */
  confirmLabel?: string
  /** Default "Cancel". */
  cancelLabel?: string
  placeholder?: string
  /** An error message for a bad value, or null when it is fine. Blocks the confirm. */
  validate?: (value: string) => string | null
  /** Let "" be confirmed. Default: an empty value disables the confirm. */
  allowEmpty?: boolean
  /** Character cap. Default 200: a name, not a document. */
  maxLength?: number
}

export type ToastTone = 'cyan' | 'good' | 'warn' | 'bad'

type DialogRequest =
  | { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

type ToastItem = { id: number; text: string; tone: ToastTone }

type Snapshot = { dialogs: DialogRequest[]; toasts: ToastItem[] }

let snapshot: Snapshot = { dialogs: [], toasts: [] }
let nextId = 1
const listeners = new Set<() => void>()

function update(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function removeDialog(id: number): void {
  update({ dialogs: snapshot.dialogs.filter((dialog) => dialog.id !== id) })
}

/**
 * Ask a yes / no question in a DS confirm dialog. Resolves true on the confirm
 * button, false on Cancel, ×, Escape or a backdrop press.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextId++
    update({ dialogs: [...snapshot.dialogs, { id, kind: 'confirm', options, resolve }] })
  })
}

/**
 * Ask for one line of text (a name) in a DS rename dialog, as `ask()` in the
 * Estimate workflow. Resolves the trimmed text, or null when cancelled.
 */
export function prompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const id = nextId++
    update({ dialogs: [...snapshot.dialogs, { id, kind: 'prompt', options, resolve }] })
  })
}

/**
 * Show a transient DS toast (top-right). Returns a function that dismisses it
 * early. `timeout` 0 keeps it until its × is pressed.
 */
export function toast(text: string, tone: ToastTone = 'cyan', timeout = 4000): () => void {
  const id = nextId++
  update({ toasts: [...snapshot.toasts, { id, text, tone }] })
  const dismiss = (): void => update({ toasts: snapshot.toasts.filter((item) => item.id !== id) })
  if (timeout > 0) setTimeout(dismiss, timeout)
  return dismiss
}

/* ---- The dialogs ----------------------------------------------------------------------------- */

export type ConfirmDialogProps = ConfirmOptions & {
  /** True for the confirm button, false for every cancel path. Called once. */
  onResult: (ok: boolean) => void
}

/**
 * The DS confirm (`organisms/ds-confirm.ts`) as a component, for a caller that
 * wants to render it itself. Most code calls `confirm()` instead. Test ids:
 * `dialog`, `dialog-confirm`, `dialog-cancel`, and `dialog-input` for the gate.
 */
export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const { onResult, requireText } = props
  const [typed, setTyped] = useState('')
  const lines = (props.text ?? '').split('\n')
  return (
    <Modal
      open
      title={props.title}
      variant="confirm"
      data-testid="dialog"
      onClose={() => onResult(false)}
      foot={
        <>
          <Button variant="ghost" data-testid="dialog-cancel" onClick={() => onResult(false)}>
            {props.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={props.destructive ? 'danger' : 'primary'}
            data-testid="dialog-confirm"
            disabled={requireText !== undefined && typed !== requireText}
            onClick={() => onResult(true)}
          >
            {props.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <span>
        {lines.map((line, i) => (
          <span key={i}>
            {i > 0 ? <br /> : null}
            {line}
          </span>
        ))}
      </span>
      {requireText !== undefined ? (
        <div className="ds-confirm__gate">
          <Input
            value={typed}
            onChange={setTyped}
            placeholder={props.requirePlaceholder ?? `Type ${requireText} to confirm`}
            data-testid="dialog-input"
          />
        </div>
      ) : null}
    </Modal>
  )
}

export type PromptDialogProps = PromptOptions & {
  /** The trimmed text on confirm, null on every cancel path. Called once. */
  onResult: (value: string | null) => void
}

/**
 * The DS rename dialog (`organisms/ds-rename.ts`) as a component. Opens with
 * the value selected; Enter confirms, Escape cancels. Most code calls
 * `prompt()` instead. Test ids: `dialog`, `dialog-input`, `dialog-confirm`,
 * `dialog-cancel`.
 */
export function PromptDialog(props: PromptDialogProps): JSX.Element {
  const { onResult, validate, allowEmpty } = props
  const [value, setValue] = useState(props.value ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = value.trim()
  const error = validate ? validate(trimmed) : null
  const blocked = Boolean(error) || (!allowEmpty && !trimmed)
  const commit = (): void => {
    if (!blocked) onResult(trimmed)
  }
  return (
    <Modal
      open
      title={props.title}
      variant="confirm"
      data-testid="dialog"
      initialFocus={inputRef}
      onClose={() => onResult(null)}
      foot={
        <>
          <Button variant="ghost" data-testid="dialog-cancel" onClick={() => onResult(null)}>
            {props.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant="primary" data-testid="dialog-confirm" disabled={blocked} onClick={commit}>
            {props.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <FormField label={props.label ?? 'Name'} error={value === (props.value ?? '') ? null : error}>
        <Input
          ref={inputRef}
          value={value}
          onChange={setValue}
          placeholder={props.placeholder}
          maxLength={props.maxLength ?? 200}
          data-testid="dialog-input"
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            commit()
          }}
        />
      </FormField>
    </Modal>
  )
}

/* ---- The tooltip ----------------------------------------------------------------------------- */

/** As the DS tooltip: wait before showing, so a passing pointer does not flash tips. */
const TIP_DELAY_MS = 350

/**
 * The DS hover tooltip (`atoms/ds-tooltip.ts`, cursor anchor): one `.ds-tip`
 * node that shows the `data-ds-tip` of the hovered element, or the full text
 * of an ellipsis-clipped element. Driven by DOM listeners, not React state, so
 * hovering never re-renders the app.
 */
function TooltipLayer(): JSX.Element {
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = tipRef.current
    if (!node) return
    let timer = 0
    let px = 0
    let py = 0
    const hide = (): void => {
      clearTimeout(timer)
      node.classList.remove('ds-show')
    }
    const show = (text: string): void => {
      node.textContent = text
      if (!text) return
      node.classList.add('ds-show') // visible first, so it can be measured
      clampFixed(node, px + 12, py + 14)
    }
    const onMove = (event: MouseEvent): void => {
      px = event.clientX
      py = event.clientY
    }
    const onOver = (event: MouseEvent): void => {
      px = event.clientX
      py = event.clientY
      const target = event.target as Element | null
      const tipped = target?.closest?.('[data-ds-tip]')
      const text = tipped?.getAttribute('data-ds-tip') ?? clippedText(target)
      clearTimeout(timer)
      if (!text) {
        hide()
        return
      }
      const delay = Number(tipped?.getAttribute('data-ds-tip-delay') ?? TIP_DELAY_MS)
      timer = window.setTimeout(() => show(text), Number.isFinite(delay) ? delay : TIP_DELAY_MS)
    }
    document.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', hide)
    document.addEventListener('mousedown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', hide)
      document.removeEventListener('mousedown', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  return createPortal(<div ref={tipRef} className="ds-tip" role="tooltip" />, document.body)
}

/**
 * The full text of an element whose text is really cut off by an ellipsis: the
 * hovered element or one of its two nearest ancestors (the pointer often lands
 * on an inner span), as the DS tooltip does.
 */
function clippedText(start: Element | null): string {
  let current: Element | null = start
  for (let depth = 0; current && depth < 3; current = current.parentElement, depth++) {
    if (!(current instanceof HTMLElement)) break
    if (current.scrollWidth > current.clientWidth + 1 && getComputedStyle(current).textOverflow === 'ellipsis') {
      const text = (current.textContent ?? '').trim()
      return text.length > 400 ? `${text.slice(0, 400)}…` : text
    }
  }
  return ''
}

/* ---- The host -------------------------------------------------------------------------------- */

/**
 * Mount once, beside the app. Renders the pending `confirm()` / `prompt()`
 * dialogs (newest on top), the `toast()` stack (`data-testid="toast"`, with
 * `data-tone`), and the `data-ds-tip` tooltip.
 */
export function DsHost(): JSX.Element {
  const state = useSyncExternalStore(subscribe, () => snapshot)

  return (
    <>
      {state.dialogs.map((dialog) => {
        if (dialog.kind === 'confirm') {
          return (
            <ConfirmDialog
              key={dialog.id}
              {...dialog.options}
              onResult={(ok) => {
                removeDialog(dialog.id)
                dialog.resolve(ok)
              }}
            />
          )
        }
        return (
          <PromptDialog
            key={dialog.id}
            {...dialog.options}
            onResult={(value) => {
              removeDialog(dialog.id)
              dialog.resolve(value)
            }}
          />
        )
      })}
      {createPortal(
        <div className="ds-toaster" role="status" aria-live="polite">
          {state.toasts.map((item) => (
            <div
              key={item.id}
              className={cx('ds-toast', item.tone !== 'cyan' && `ds-toast--${item.tone}`)}
              data-testid="toast"
              data-tone={item.tone}
            >
              <span className="ds-toast__msg">{item.text}</span>
              <button
                type="button"
                className="ds-toast__close"
                aria-label="Dismiss"
                onClick={() => update({ toasts: snapshot.toasts.filter((other) => other.id !== item.id) })}
              >
                ×
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
      <TooltipLayer />
    </>
  )
}
