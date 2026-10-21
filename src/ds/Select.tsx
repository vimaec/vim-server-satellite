/**
 * The DS dropdown (vim-html-ds `atoms/ds-select.ts`): a `.ds-select` trigger
 * button and a DS `Menu` under it. Not a native `<select>`, as in the DS, so
 * the popup has the DS look and can carry action items and separators.
 */
import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { EditState } from './atoms'
import { Menu } from './Menu'
import type { MenuEntry } from './Menu'
import { cx, dataAttributes } from './util'
import type { CommonProps } from './util'

export type SelectOption = {
  id: string
  label: string
  /** A colour swatch before the label, in the trigger and the menu. */
  dot?: string
  /** A glyph before the label, in the trigger and the menu. */
  icon?: string
  /** Colour for `icon`. Default: the dim text tone. */
  iconColor?: string
  /** Dim trailing context after the label (a count). */
  hint?: string
  /**
   * An ACTION item ("New sheet…"): picking it runs this and leaves the value
   * alone. The menu closes; `onChange` is not called.
   */
  action?: () => void
  /** Draw a separator after this option, e.g. between values and actions. */
  separatorAfter?: boolean
  disabled?: boolean
}

export type SelectProps = CommonProps & {
  options: (SelectOption | string)[]
  /** The selected option id; null (or an unknown id) shows the placeholder. */
  value: string | null
  /** A value option was picked (never for an action item, never for the current value). */
  onChange: (id: string) => void
  /** Shown, dimmed, when no option matches `value`, e.g. "(mixed)". Default "Select…". */
  placeholder?: string
  /** Text for the trigger instead of the option's label (the menu still lists labels). */
  label?: string
  /** Edit-state tint: `pending` amber, `invalid` red. */
  state?: EditState
  /** Fill the container's width (`ds-select--block`). */
  block?: boolean
  /** The bare underline variant for dense rows (`ds-select--inline`). */
  inline?: boolean
  ariaLabel?: string
  title?: string
}

/**
 * The trigger carries the caller's `data-*` plus `data-value` (the current id).
 * Each menu row carries `data-testid="select-option"` and `data-value` = its id.
 */
export function Select(props: SelectProps): JSX.Element {
  const { value, onChange, placeholder = 'Select…', state = 'clean' } = props
  const options = props.options.map((option) => (typeof option === 'string' ? { id: option, label: option } : option))
  const current = options.find((option) => !option.action && option.id === value)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  const openMenu = (): void => {
    const trigger = triggerRef.current
    if (!trigger || props.disabled) return
    const rect = trigger.getBoundingClientRect()
    setMenuAt({ x: rect.left, y: rect.bottom + 2 })
  }

  // Built only while open: a virtualized tree renders many closed selects.
  const entries: MenuEntry[] = []
  if (menuAt) for (const option of options) {
    entries.push({
      label: option.label,
      dot: option.dot,
      icon: option.icon,
      iconColor: option.iconColor,
      hint: option.hint,
      disabled: option.disabled,
      selected: !option.action && option.id === value,
      'data-testid': 'select-option',
      'data-value': option.id,
      onClick: option.action
        ? option.action
        : () => {
            if (option.id !== value) onChange(option.id)
          },
    })
    if (option.separatorAfter) entries.push('separator')
  }

  const label = props.label ?? current?.label
  return (
    <>
      <button
        {...dataAttributes(props)}
        ref={triggerRef}
        type="button"
        className={cx(
          'ds-select',
          props.block && 'ds-select--block',
          props.inline && 'ds-select--inline',
          menuAt && 'ds-open',
          state === 'pending' && 'ds-pending',
          state === 'invalid' && 'ds-invalid',
          props.disabled && 'ds-disabled',
          props.className,
        )}
        style={props.style}
        disabled={props.disabled}
        data-value={value ?? ''}
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        aria-label={props.ariaLabel}
        title={props.title}
        onClick={openMenu}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          openMenu()
        }}
      >
        {current?.dot ? <span className="ds-seldot" style={{ background: current.dot }} /> : null}
        {current?.icon ? (
          <span className="ds-selicon" style={current.iconColor ? { color: current.iconColor } : undefined}>
            {current.icon}
          </span>
        ) : null}
        <span className={cx('ds-select__label', label === undefined && 'ds-placeholder')}>
          {label ?? placeholder}
        </span>
        {current?.hint ? <span className="ds-select__hint">{current.hint}</span> : null}
        <span className="ds-select__chev" />
      </button>
      <Menu
        open={menuAt !== null}
        x={menuAt?.x ?? 0}
        y={menuAt?.y ?? 0}
        items={entries}
        anchor={triggerRef.current}
        onClose={() => setMenuAt(null)}
      />
    </>
  )
}
