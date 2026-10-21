/**
 * React twins of the vim-html-ds atoms.
 *
 * Each component renders the same DOM, classes, modifiers and ARIA as the DS
 * factory of the same name (`src/atoms/ds-*.ts` in vim-html-ds), so ds.css
 * styles it with no extra CSS. They are controlled (`value` + `onChange`) where
 * the factory kept its own state, because React owns the state here.
 */
import { forwardRef, useEffect, useRef, useState } from 'react'
import type {
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from 'react'
import {
  CHEVRON_CLASS,
  FILLED_GLYPHS,
  SVG_PATHS,
  glyphText,
  isChevronName,
  isGlyphName,
  isSvgName,
} from './icons'
import type { IconName } from './icons'
import { cx, dataAttributes } from './util'
import type { CommonProps, DataAttributes } from './util'

/** The DS accent vocabulary (`Tone` in vim-html-ds dom.ts). */
export type Tone = 'cyan' | 'teal' | 'good' | 'warn' | 'bad' | 'violet' | 'orange'

/** The DS edit-state vocabulary: committed, unsaved (amber), rejected (red). */
export type EditState = 'clean' | 'pending' | 'invalid'

/** The DS text-field cap (DEFAULT_INPUT_MAX): a field that accepts megabytes breaks what reads it. */
export const DEFAULT_INPUT_MAX = 1000
/** The DS text-area cap (DEFAULT_TEXTAREA_MAX): a note, not a document. */
export const DEFAULT_TEXTAREA_MAX = 20000
/** The DS search cap (DEFAULT_SEARCH_MAX): a search term. */
export const DEFAULT_SEARCH_MAX = 200

/* ---- Button ---------------------------------------------------------------------------------- */

/** `secondary` is the plain DS button (no modifier class). The DS has no button sizes. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export type ButtonProps = CommonProps & {
  /** The label. */
  children?: ReactNode
  variant?: ButtonVariant
  /** A leading icon (a name from icons.ts, or literal glyph text). */
  icon?: IconName | string
  /** The toggled-on look (`ds-active`). */
  active?: boolean
  type?: 'button' | 'submit'
  /** A DS hover tip (`data-ds-tip`), shown by DsHost. */
  tip?: string
  autoFocus?: boolean
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}

export function Button(props: ButtonProps): JSX.Element {
  const { children, variant = 'secondary', icon, active, type = 'button', tip, autoFocus } = props
  return (
    <button
      {...dataAttributes(props)}
      type={type}
      className={cx(
        'ds-btn',
        variant !== 'secondary' && `ds-btn--${variant}`,
        active && 'ds-active',
        props.className,
      )}
      style={props.style}
      disabled={props.disabled}
      data-ds-tip={tip}
      autoFocus={autoFocus}
      onClick={props.onClick}
    >
      {icon ? <Icon icon={icon} /> : null}
      {children}
    </button>
  )
}

/* ---- IconButton ------------------------------------------------------------------------------ */

export type IconButtonProps = CommonProps & {
  /** A glyph name, a drawn SVG name, a chevron, `folder`, `browse` (…), or literal glyph text. */
  icon: IconName | string
  /** The hover tip; also the accessible name unless `ariaLabel` says otherwise. */
  tip?: string
  ariaLabel?: string
  /** The toggled-on look (`ds-active`). */
  active?: boolean
  /** Dense-row squares: `sm` = 22px, `xs` = 20px. The default is the control height (26px). */
  size?: 'sm' | 'xs'
  variant?: 'danger'
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}

/** The inside of an icon button, as `applyIcon` in ds-icon-button.ts builds it. */
function iconButtonContent(icon: string): ReactNode {
  if (isChevronName(icon)) return null
  if (icon === 'folder') return <span className="ds-pathchip__icon" />
  if (isSvgName(icon)) {
    const spec: { d: string; evenodd?: boolean } = SVG_PATHS[icon]
    return (
      <svg className="ds-iconbtn__svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d={spec.d} fillRule={spec.evenodd ? 'evenodd' : undefined} />
      </svg>
    )
  }
  return icon === 'browse' ? '…' : glyphText(icon)
}

export function IconButton(props: IconButtonProps): JSX.Element {
  const { icon, tip, ariaLabel, active, size, variant } = props
  return (
    <button
      {...dataAttributes(props)}
      type="button"
      className={cx(
        'ds-iconbtn',
        variant === 'danger' && 'ds-iconbtn--danger',
        size && `ds-iconbtn--${size}`,
        isChevronName(icon) && CHEVRON_CLASS[icon],
        isGlyphName(icon) && FILLED_GLYPHS.has(icon) && 'ds-iconbtn--filled',
        active && 'ds-active',
        props.disabled && 'ds-disabled',
        props.className,
      )}
      style={props.style}
      disabled={props.disabled}
      data-ds-tip={tip}
      aria-label={ariaLabel ?? tip}
      aria-pressed={active === undefined ? undefined : active}
      onClick={props.onClick}
    >
      {iconButtonContent(icon)}
    </button>
  )
}

/* ---- Icon ------------------------------------------------------------------------------------ */

export type IconProps = DataAttributes & {
  /** A glyph name from icons.ts, or literal glyph text. */
  icon: string
  size?: 'sm' | 'md' | 'lg'
  /** A DS colour token name without the dashes, e.g. `good` or `vim-cyan`. */
  tone?: string
  /** Draw from the Filled font. Implied for the names in FILLED_GLYPHS. */
  filled?: boolean
  /** Give the icon an accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string
  className?: string
}

export function Icon(props: IconProps): JSX.Element {
  const { icon, size = 'md', tone, label } = props
  const filled = props.filled ?? (isGlyphName(icon) && FILLED_GLYPHS.has(icon))
  return (
    <span
      {...dataAttributes(props)}
      className={cx('ds-icon', size !== 'md' && `ds-icon--${size}`, filled && 'ds-icon--filled', props.className)}
      style={tone ? { color: `var(--${tone})` } : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {glyphText(icon)}
    </span>
  )
}

/* ---- Text fields: shared draft / commit logic -------------------------------------------------- */

/**
 * Two ways to drive a text field. Live: pass `onChange`, the parent owns the
 * text and hears every keystroke. Commit: pass only `onCommit`, the field keeps
 * a draft and reports it on Enter (or blur), and Escape puts the value back —
 * what an edit-in-place cell wants, so a row is not rewritten per keystroke.
 */
function useDraft(
  value: string,
  onChange: ((value: string) => void) | undefined,
  onCommit: ((value: string) => void) | undefined,
): {
  text: string
  setText: (text: string) => void
  commit: () => void
  revert: () => void
} {
  const [draft, setDraft] = useState(value)
  // What was last reported, so the blur that follows an Enter does not report it twice.
  const committed = useRef(value)
  // A new value from outside (a reload, another row) replaces the draft. In
  // live mode the value moves with every keystroke, so it says nothing about
  // what was committed.
  const live = onChange !== undefined
  useEffect(() => {
    setDraft(value)
    if (!live) committed.current = value
  }, [value, live])
  const text = onChange ? value : draft
  return {
    text,
    setText: (next) => {
      if (onChange) onChange(next)
      else setDraft(next)
    },
    commit: () => {
      if (!onCommit || text === committed.current) return
      committed.current = text
      onCommit(text)
    },
    revert: () => {
      if (!onChange) setDraft(value)
    },
  }
}

/* ---- Input ----------------------------------------------------------------------------------- */

export type InputProps = CommonProps & {
  value: string
  /** Live mode: every keystroke. */
  onChange?: (value: string) => void
  /** Commit mode (or in addition to live mode): Enter or blur. */
  onCommit?: (value: string) => void
  /** `mono` = tabular figures; `inline` = the bare underline edit-in-place field. */
  variant?: 'mono' | 'inline'
  type?: string
  placeholder?: string
  /** Character cap, which also bounds a paste. Default DEFAULT_INPUT_MAX. */
  maxLength?: number
  readOnly?: boolean
  autoFocus?: boolean
  ariaLabel?: string
  title?: string
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) {
  const { variant, maxLength = DEFAULT_INPUT_MAX, onCommit } = props
  const draft = useDraft(props.value, props.onChange, onCommit)
  return (
    <input
      {...dataAttributes(props)}
      ref={ref}
      className={cx(
        variant === 'inline' ? 'ds-input--inline' : 'ds-input',
        variant === 'mono' && 'ds-input--mono',
        props.className,
      )}
      style={props.style}
      type={props.type ?? 'text'}
      value={draft.text}
      placeholder={props.placeholder}
      maxLength={Number.isFinite(maxLength) ? maxLength : undefined}
      readOnly={props.readOnly}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      aria-label={props.ariaLabel}
      title={props.title}
      onChange={(event) => draft.setText(event.target.value)}
      onKeyDown={(event) => {
        props.onKeyDown?.(event)
        if (event.defaultPrevented || !onCommit) return
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          draft.commit()
        } else if (event.key === 'Escape') {
          draft.revert()
        }
      }}
      onBlur={(event) => {
        props.onBlur?.(event)
        draft.commit()
      }}
    />
  )
})

/* ---- TextArea -------------------------------------------------------------------------------- */

export type TextAreaProps = CommonProps & {
  value: string
  /** Live mode: every keystroke. */
  onChange?: (value: string) => void
  /** Commit mode: blur or Ctrl+Enter (a plain Enter is a new line). Escape reverts. */
  onCommit?: (value: string) => void
  placeholder?: string
  rows?: number
  /** Character cap, which also bounds a paste. Default DEFAULT_TEXTAREA_MAX. */
  maxLength?: number
  autoFocus?: boolean
  ariaLabel?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(props, ref) {
  const { maxLength = DEFAULT_TEXTAREA_MAX, onCommit } = props
  const draft = useDraft(props.value, props.onChange, onCommit)
  return (
    <textarea
      {...dataAttributes(props)}
      ref={ref}
      className={cx('ds-textarea', props.className)}
      style={props.style}
      value={draft.text}
      placeholder={props.placeholder}
      rows={props.rows}
      maxLength={Number.isFinite(maxLength) ? maxLength : undefined}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      aria-label={props.ariaLabel}
      onChange={(event) => draft.setText(event.target.value)}
      onKeyDown={(event) => {
        if (!onCommit) return
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          draft.commit()
        } else if (event.key === 'Escape') {
          draft.revert()
        }
      }}
      onBlur={() => draft.commit()}
    />
  )
})

/* ---- NumberInput ----------------------------------------------------------------------------- */

export type NumberInputProps = CommonProps & {
  /** The committed value; null shows an empty field. */
  value: number | null
  /**
   * The committed value: Enter or blur on the field, ArrowUp / ArrowDown, a
   * click on ▴ / ▾. Null only when `allowEmpty` and the field was cleared.
   */
  onChange: (value: number | null) => void
  min?: number
  max?: number
  /** One nudge. Default 1. */
  step?: number
  /** Shown decimals. Default: the step's own (0.5 → 1, 1 → 0). */
  decimals?: number
  /** An empty field commits null instead of snapping back to the last value. */
  allowEmpty?: boolean
  /** Show the ▴▾ stack. Default true (as the DS stepper). */
  steppers?: boolean
  placeholder?: string
  ariaLabel?: string
  title?: string
  /** Text for a committed value. Default `value.toFixed(decimals)`. */
  format?: (value: number) => string
  /** Text back to a number; null for junk. Default: parseFloat, ignoring thousands commas. */
  parse?: (text: string) => number | null
}

function defaultParse(text: string): number | null {
  const n = parseFloat(text.replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * The DS numeric stepper. `data-*` attributes go to the inner `<input>`, so a
 * test can `fill()` it. The DS drag-scrub on the ▴▾ stack is not ported: the
 * buttons step on click only.
 */
export function NumberInput(props: NumberInputProps): JSX.Element {
  const { value, onChange, min = -Infinity, max = Infinity, step = 1, allowEmpty, steppers = true } = props
  const stepDecimals = String(step).includes('.') ? String(step).split('.')[1].length : 0
  const decimals =
    props.decimals !== undefined && Number.isInteger(props.decimals) && props.decimals >= 0
      ? Math.min(20, props.decimals)
      : stepDecimals
  const clamp = (n: number): number => Number(Math.max(min, Math.min(max, n)).toFixed(decimals))
  const format = (n: number | null): string =>
    n === null ? '' : props.format ? props.format(n) : n.toFixed(decimals)
  const parse = props.parse ?? defaultParse

  // The text while the user types; null when the field shows the committed value.
  const [draft, setDraft] = useState<string | null>(null)

  const commitNumber = (n: number | null): void => {
    setDraft(null)
    const next = n === null ? null : clamp(n)
    if (next !== value) onChange(next)
  }
  const commitText = (): void => {
    if (draft === null) return
    if (draft.trim() === '') {
      if (allowEmpty) commitNumber(null)
      else setDraft(null) // empty is not a number: back to the last value
      return
    }
    const n = parse(draft)
    if (n === null) setDraft(null) // junk: back to what it was, no commit
    else commitNumber(n)
  }
  const nudge = (direction: number): void => {
    const from = draft !== null ? (parse(draft) ?? value ?? 0) : (value ?? 0)
    commitNumber(from + direction * step)
  }

  return (
    <div
      className={cx('ds-number', props.disabled && 'ds-disabled', props.className)}
      style={props.style}
    >
      <input
        {...dataAttributes(props)}
        className="ds-number__input"
        value={draft ?? format(value)}
        placeholder={props.placeholder}
        disabled={props.disabled}
        inputMode="decimal"
        aria-label={props.ariaLabel}
        title={props.title}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            commitText()
          } else if (event.key === 'Escape') {
            setDraft(null)
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            nudge(event.key === 'ArrowUp' ? 1 : -1)
          }
        }}
        onBlur={commitText}
      />
      {steppers ? (
        <div className="ds-number__btns">
          <button type="button" className="ds-number__btn" tabIndex={-1} disabled={props.disabled} aria-label="Increase" onClick={() => nudge(1)}>
            ▴
          </button>
          <button type="button" className="ds-number__btn" tabIndex={-1} disabled={props.disabled} aria-label="Decrease" onClick={() => nudge(-1)}>
            ▾
          </button>
        </div>
      ) : null}
    </div>
  )
}

/* ---- Checkbox -------------------------------------------------------------------------------- */

/** DS tri-state: checked (`on`), unchecked (`off`), some descendants checked (`partial`). */
export type CheckboxState = 'on' | 'off' | 'partial'

export type CheckboxProps = CommonProps & {
  state: CheckboxState
  /**
   * The state a click asks for. As the DS selection contract says, a partial
   * box goes to `on` (it checks everything under it); `on` goes to `off`.
   */
  onChange?: (next: CheckboxState, event: MouseEvent<HTMLButtonElement>) => void
  /** Text after the box; also the accessible name. */
  label?: ReactNode
  /** Accessible name when there is no visible label. */
  ariaLabel?: string
  tip?: string
}

export function Checkbox(props: CheckboxProps): JSX.Element {
  const { state, label, ariaLabel, tip } = props
  return (
    <button
      {...dataAttributes(props)}
      type="button"
      role="checkbox"
      className={cx(
        'ds-check',
        state === 'on' && 'ds-on',
        state === 'partial' && 'ds-partial',
        props.disabled && 'ds-disabled',
        props.className,
      )}
      style={props.style}
      disabled={props.disabled}
      aria-checked={state === 'on' ? 'true' : state === 'partial' ? 'mixed' : 'false'}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      data-ds-tip={tip}
      onClick={(event) => props.onChange?.(state === 'on' ? 'off' : 'on', event)}
    >
      <span className="ds-check__box" />
      {label !== undefined ? <span>{label}</span> : null}
    </button>
  )
}

/* ---- Search ---------------------------------------------------------------------------------- */

export type SearchProps = CommonProps & {
  /** Controlled text. Leave it out for an uncontrolled field that starts at `defaultValue`. */
  value?: string
  defaultValue?: string
  /** Every keystroke (and "" on clear). */
  onChange?: (value: string) => void
  /**
   * Set, the search commits: Enter, a click on the magnifier (which becomes a
   * button), and the clear button (with "") hand the text here.
   */
  onSubmit?: (value: string) => void
  /** Default "Search…". */
  placeholder?: string
  /** Character cap. Default DEFAULT_SEARCH_MAX. */
  maxLength?: number
  ariaLabel?: string
}

/** The DS search field. `data-*` attributes go to the inner `<input>`, so a test can `fill()` it. */
export function Search(props: SearchProps): JSX.Element {
  const { onSubmit, maxLength = DEFAULT_SEARCH_MAX } = props
  const [own, setOwn] = useState(props.defaultValue ?? '')
  const text = props.value ?? own
  const set = (next: string): void => {
    if (props.value === undefined) setOwn(next)
    props.onChange?.(next)
  }
  return (
    <div className={cx('ds-search', props.className)} style={props.style}>
      {onSubmit ? (
        <button
          type="button"
          className="ds-search__icon ds-search__icon--go"
          aria-label="Search"
          data-ds-tip="Search (Enter)"
          disabled={props.disabled}
          onClick={() => onSubmit(text)}
        />
      ) : (
        <span className="ds-search__icon" />
      )}
      <input
        {...dataAttributes(props)}
        className="ds-input"
        type="text"
        value={text}
        placeholder={props.placeholder ?? 'Search…'}
        maxLength={maxLength}
        disabled={props.disabled}
        aria-label={props.ariaLabel ?? props.placeholder ?? 'Search'}
        onChange={(event) => set(event.target.value)}
        onKeyDown={(event) => {
          if (!onSubmit || event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          onSubmit(text)
        }}
      />
      <button
        type="button"
        className={cx('ds-search__clear', text.length > 0 && 'ds-show')}
        aria-label="Clear"
        disabled={props.disabled}
        onClick={(event) => {
          set('')
          onSubmit?.('')
          ;(event.currentTarget.previousElementSibling as HTMLInputElement | null)?.focus()
        }}
      >
        ×
      </button>
    </div>
  )
}

/* ---- Chip ------------------------------------------------------------------------------------ */

export type ChipProps = DataAttributes & {
  children?: ReactNode
  tone?: Tone
  /** Makes the chip actionable: pointer cursor, focusable, Enter / Space click. */
  onClick?: (event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) => void
  tip?: string
  title?: string
  className?: string
}

export function Chip(props: ChipProps): JSX.Element {
  const { tone, onClick } = props
  return (
    <span
      {...dataAttributes(props)}
      className={cx('ds-chip', tone && `ds-chip--${tone}`, onClick && 'ds-chip--clickable', props.className)}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      data-ds-tip={props.tip}
      title={props.title}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onClick(event)
            }
          : undefined
      }
    >
      {props.children}
    </span>
  )
}

/* ---- Segmented ------------------------------------------------------------------------------- */

export type SegmentedOption = DataAttributes & {
  id: string
  label: ReactNode
  tip?: string
  disabled?: boolean
}

export type SegmentedProps = CommonProps & {
  options: (SegmentedOption | string)[]
  value: string
  onChange: (id: string) => void
  ariaLabel?: string
}

function normalizeOption<T extends { id: string; label: ReactNode }>(option: T | string): T {
  return typeof option === 'string' ? ({ id: option, label: option } as T) : option
}

/** Mutually exclusive strip. Each segment carries `data-value` = its id. */
export function Segmented(props: SegmentedProps): JSX.Element {
  const { value, onChange } = props
  return (
    <div
      {...dataAttributes(props)}
      className={cx('ds-segmented', props.disabled && 'ds-disabled', props.className)}
      style={props.style}
      role="group"
      aria-label={props.ariaLabel}
    >
      {props.options.map(normalizeOption<SegmentedOption>).map((option) => {
        const { id, label, tip, disabled, ...rest } = option
        return (
          <button
            {...dataAttributes(rest)}
            key={id}
            type="button"
            className={cx('ds-seg', id === value && 'ds-active')}
            data-value={id}
            data-ds-tip={tip}
            aria-pressed={id === value}
            disabled={props.disabled || disabled}
            onClick={() => {
              if (id !== value) onChange(id)
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/* ---- Tabs + TabPanel ------------------------------------------------------------------------- */

export type TabOption = DataAttributes & {
  id: string
  label: ReactNode
  /** A count chip after the label (cyan, as the DS tab chip). */
  chip?: string | number
  /** A disabled tab refuses clicks; `tip` says why. */
  disabled?: boolean
  tip?: string
}

export type TabsProps = DataAttributes & {
  /** An option's own `data-*` (e.g. `data-testid`) goes on its tab button. */
  options: (TabOption | string)[]
  value: string
  onChange: (id: string) => void
  /** `filled`: the active tab is a cyan-tint block (sub-navigation). */
  variant?: 'filled'
  className?: string
}

/**
 * The DS tab strip. The DS overflow "…" menu is not ported: the app's strips
 * hold two or three tabs.
 */
export function Tabs(props: TabsProps): JSX.Element {
  const { value, onChange } = props
  return (
    <div
      {...dataAttributes(props)}
      className={cx('ds-tabs', props.variant === 'filled' && 'ds-tabs--filled', props.className)}
      role="tablist"
    >
      {props.options.map(normalizeOption<TabOption>).map((option) => {
        const { id, label, chip, disabled, tip, ...rest } = option
        return (
          <button
            {...dataAttributes(rest)}
            key={id}
            type="button"
            role="tab"
            className={cx('ds-tab', id === value && 'ds-active', disabled && 'ds-disabled')}
            aria-selected={id === value}
            aria-disabled={disabled || undefined}
            data-ds-tip={disabled ? tip : undefined}
            onClick={() => {
              if (id !== value && !disabled) onChange(id)
            }}
          >
            <span>{label}</span>
            {chip !== undefined ? <span className="ds-chip ds-chip--cyan">{String(chip)}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

export type TabPanelProps = DataAttributes & {
  /** Only the active panel joins the layout (`ds-open`); the others stay mounted but hidden. */
  active: boolean
  children?: ReactNode
  className?: string
}

export function TabPanel(props: TabPanelProps): JSX.Element {
  return (
    <div
      {...dataAttributes(props)}
      className={cx('ds-tabpanel', props.active && 'ds-open', props.className)}
      role="tabpanel"
    >
      {props.children}
    </div>
  )
}

/* ---- Label ----------------------------------------------------------------------------------- */

export type LabelProps = DataAttributes & {
  /**
   * The DS text bands: `eyebrow` (mono caps), `title` (Roboto bold), `body`,
   * `dim` (small, faint), `value` (mono figures). Default: the plain label.
   */
  variant?: 'eyebrow' | 'title' | 'body' | 'dim' | 'value'
  /** One line, ellipsized past the box (the DS tooltip then shows the full text). */
  truncate?: boolean
  /** The element: a heading keeps its meaning while it takes the DS look. Default `span`. */
  as?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'label'
  children?: ReactNode
  tip?: string
  title?: string
  className?: string
}

/** The DS text atom (`atoms/ds-label.ts`). */
export function Label(props: LabelProps): JSX.Element {
  const { as: Tag = 'span', variant, truncate } = props
  return (
    <Tag
      {...dataAttributes(props)}
      className={cx('ds-label', variant && `ds-label--${variant}`, truncate && 'ds-label--truncate', props.className)}
      data-ds-tip={props.tip}
      title={props.title}
    >
      {props.children}
    </Tag>
  )
}
