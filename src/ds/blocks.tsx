/**
 * React twins of the vim-html-ds layout blocks: Banner, Empty, Card, Panel and
 * FormField (`molecules/ds-banner.ts`, `ds-empty.ts`, `ds-field.ts`,
 * `organisms/ds-card.ts`, `ds-panel.ts`). Same DOM and classes, so ds.css
 * styles them.
 */
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { Button } from './atoms'
import type { ButtonVariant } from './atoms'
import { cx, dataAttributes } from './util'
import type { DataAttributes } from './util'

/** A button inside a block (a banner's Retry, an empty state's action). */
export type BlockAction = DataAttributes & {
  label: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  variant?: ButtonVariant
  disabled?: boolean
}

function ActionButton({ action, fallback }: { action: BlockAction; fallback: ButtonVariant }): JSX.Element {
  const { label, onClick, variant, disabled, ...rest } = action
  return (
    <Button {...dataAttributes(rest)} variant={variant ?? fallback} disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  )
}

/* ---- Banner ---------------------------------------------------------------------------------- */

export type BannerProps = DataAttributes & {
  /** The left keyline colour. Default `info` (cyan). */
  tone?: 'info' | 'good' | 'warn' | 'bad'
  /** The message. */
  children?: ReactNode
  action?: BlockAction
  /** Set, the banner shows a × that calls it. The parent removes the banner. */
  onClose?: () => void
  /** `alert` for an error the user must see now; default none. */
  role?: 'alert' | 'status'
  className?: string
}

/** A persistent in-flow message; it stays until resolved or dismissed (toasts go away). */
export function Banner(props: BannerProps): JSX.Element {
  const { tone = 'info', action, onClose } = props
  return (
    <div
      {...dataAttributes(props)}
      className={cx('ds-banner', tone !== 'info' && `ds-banner--${tone}`, props.className)}
      role={props.role}
    >
      <span className="ds-banner__msg">{props.children}</span>
      {action ? <ActionButton action={action} fallback="secondary" /> : null}
      {onClose ? (
        <button type="button" className="ds-banner__close" aria-label="Dismiss" onClick={onClose}>
          ×
        </button>
      ) : null}
    </div>
  )
}

/* ---- Empty ----------------------------------------------------------------------------------- */

export type EmptyProps = DataAttributes & {
  title: ReactNode
  hint?: ReactNode
  /** A ghost button by default, as the DS. */
  action?: BlockAction
  /** Take the parent's whole room (a growing flex item) and centre the state in it. */
  fill?: boolean
  className?: string
}

/** The no-rows / no-selection state. */
export function Empty(props: EmptyProps): JSX.Element {
  const box = (
    <div {...(props.fill ? {} : dataAttributes(props))} className={cx('ds-empty', !props.fill && props.className)}>
      <div className="ds-empty__title">{props.title}</div>
      {props.hint ? <div className="ds-empty__hint">{props.hint}</div> : null}
      {props.action ? <ActionButton action={props.action} fallback="ghost" /> : null}
    </div>
  )
  if (!props.fill) return box
  return (
    <div {...dataAttributes(props)} className={cx('ds-empty-fill', props.className)}>
      {box}
    </div>
  )
}

/* ---- Card ---------------------------------------------------------------------------------- */

export type CardProps = DataAttributes & {
  title?: ReactNode
  /** The heading element of the title. Default `span`. */
  titleAs?: 'span' | 'h1' | 'h2' | 'h3'
  /** A muted mono line under the title. */
  sub?: ReactNode
  /** The 2px cyan keyline before the title. Default true. */
  keyline?: boolean
  /** Controls at the right of the head. */
  actions?: ReactNode
  /** The body. */
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

/** The DS content card (`organisms/ds-card.ts`): flat panel, keyline head, body slot. */
export function Card(props: CardProps): JSX.Element {
  const { title, titleAs: TitleTag = 'span', sub, keyline = true, actions } = props
  return (
    <div
      {...dataAttributes(props)}
      className={cx('ds-card', !keyline && 'ds-card--no-keyline', props.className)}
      style={props.style}
    >
      {title || sub ? (
        <div className="ds-card__head">
          <div className="ds-card__titles">
            <TitleTag className="ds-label ds-label--title">{title}</TitleTag>
            {sub ? <span className="ds-card__sub">{sub}</span> : null}
          </div>
          <div className="ds-card__actions">{actions}</div>
        </div>
      ) : null}
      <div className="ds-card__body">{props.children}</div>
    </div>
  )
}

/* ---- Panel ----------------------------------------------------------------------------------- */

export type PanelProps = DataAttributes & {
  title?: ReactNode
  /** A muted live caption beside the title ("42,000 elements"). */
  subtitle?: ReactNode
  /** A hover tip on the title, for the tagline the subtitle does not carry. */
  tip?: string
  /** The subject the panel is ON, after the title behind a "›" ("Estimate › Sheet 1"). */
  crumb?: ReactNode
  /** Panel-level controls, right-aligned in the head. */
  actions?: ReactNode
  /** Default `right` (hairline on the left edge). */
  side?: 'left' | 'right'
  width?: number | string
  /** The panel IS a layout cell: no dock width clamps, fill the parent. */
  fill?: boolean
  /** Set, the head shows a × that calls it. */
  onClose?: () => void
  /** The action row under the body. Left out, there is no foot. */
  foot?: ReactNode
  /** The body (scrolls, 12px padding, 10px gap). */
  children?: ReactNode
  /** Extra classes on `.ds-panel__body`, e.g. to drop its padding for a full-bleed tree. */
  bodyClassName?: string
  className?: string
  style?: CSSProperties
}

/** The DS side panel: an in-flow column (head / body / foot), never an overlay. */
export function Panel(props: PanelProps): JSX.Element {
  const { title, subtitle, crumb, actions, onClose, foot } = props
  // A head with nothing to say is no head at all (as the DS).
  const hasHead = Boolean(title || subtitle || onClose || actions || crumb)
  const style: CSSProperties = { ...props.style }
  if (props.width !== undefined) style.width = typeof props.width === 'number' ? `${props.width}px` : props.width
  return (
    <aside
      {...dataAttributes(props)}
      className={cx('ds-panel', props.side === 'left' && 'ds-panel--left', props.fill && 'ds-panel--fill', props.className)}
      style={style}
    >
      {hasHead ? (
        <div className={cx('ds-panel__head', crumb && 'ds-panel__head--crumb')}>
          <div className="ds-panel__title" data-ds-tip={props.tip}>
            {title}
          </div>
          {crumb ? <div className="ds-panel__crumb">{crumb}</div> : null}
          {subtitle ? <span className="ds-panel__subtitle">{subtitle}</span> : null}
          {actions ? <div className="ds-panel__actions">{actions}</div> : null}
          {onClose ? (
            <button type="button" className="ds-panel__close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={cx('ds-panel__body', props.bodyClassName)}>{props.children}</div>
      {foot ? <div className="ds-panel__foot">{foot}</div> : null}
    </aside>
  )
}

/* ---- FormField ------------------------------------------------------------------------------- */

export type FormFieldProps = DataAttributes & {
  label: ReactNode
  /** The id of the control, so a click on the label focuses it. */
  htmlFor?: string
  required?: boolean
  help?: ReactNode
  /** Set, the field turns red and shows it under the control. */
  error?: string | null
  /** The control. */
  children?: ReactNode
  className?: string
}

/** Label + control + help / error: the unit of a DS form. */
export function FormField(props: FormFieldProps): JSX.Element {
  const { error } = props
  return (
    <div {...dataAttributes(props)} className={cx('ds-formfield', error && 'ds-invalid', props.className)}>
      <label className="ds-formfield__label" htmlFor={props.htmlFor}>
        {props.label}
        {props.required ? <span className="ds-formfield__req">*</span> : null}
      </label>
      <div>{props.children}</div>
      {props.help ? <span className="ds-formfield__help">{props.help}</span> : null}
      <span className="ds-formfield__error">{error ?? ''}</span>
    </div>
  )
}
