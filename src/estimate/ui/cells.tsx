/**
 * Edit-in-place cells for the trees: the DS inline field, committing on Enter
 * or blur (Escape puts the value back), so a 20k-row estimate is not rewritten
 * per keystroke.
 */
import { useRef, useState } from 'react'
import { Input } from '../../ds'
import { parseNumber } from '../i18n'

export type InlineNumberProps = {
  value: number | null
  /** The committed number; null for an emptied field. */
  onCommit: (value: number | null) => void
  /** Text for a value. Default: the number as is. */
  format?: (value: number) => string
  /** `box`: the boxed DS field (a form), instead of the bare underline of a tree cell. */
  variant?: 'inline' | 'box'
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
  'data-testid'?: string
}

/**
 * A number typed the way people type money ("１，２００円" as readily as
 * "1200", see parseNumber). Text that is not a number is not committed: the
 * field goes back to the stored value instead of clearing it.
 */
export function InlineNumber(props: InlineNumberProps): JSX.Element {
  const { value, onCommit, format = String } = props
  // Bumped to remount the field, which drops a rejected draft.
  const [nonce, setNonce] = useState(0)
  return (
    <Input
      key={nonce}
      variant={props.variant === 'box' ? 'mono' : 'inline'}
      className="en-cellnum"
      value={value === null ? '' : format(value)}
      placeholder={props.placeholder}
      disabled={props.disabled}
      ariaLabel={props.ariaLabel}
      maxLength={20}
      data-testid={props['data-testid']}
      onCommit={(text) => {
        if (!text.trim()) {
          onCommit(null)
          return
        }
        const number = parseNumber(text)
        if (number === null) setNonce((count) => count + 1)
        else onCommit(number)
      }}
    />
  )
}

export type InlineTextProps = {
  value: string
  /** The committed text, trimmed. */
  onCommit: (value: string) => void
  maxLength?: number
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
  autoFocus?: boolean
  /** Escape or blur without a change: the editor can close. */
  onDone?: () => void
  'data-testid'?: string
}

export function InlineText(props: InlineTextProps): JSX.Element {
  const { onCommit, onDone } = props
  // Escape closes an editor; the browser may then blur the field as it goes, and
  // that blur must not commit the text Escape just threw away.
  const escaped = useRef(false)
  return (
    <Input
      variant="inline"
      value={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      ariaLabel={props.ariaLabel}
      maxLength={props.maxLength}
      autoFocus={props.autoFocus}
      data-testid={props['data-testid']}
      onCommit={(text) => {
        if (!escaped.current) onCommit(text.trim())
      }}
      onKeyDown={(event) => {
        // Typing again after an Escape is a new edit.
        escaped.current = event.key === 'Escape'
        if (escaped.current) onDone?.()
      }}
      onBlur={() => onDone?.()}
    />
  )
}
