/**
 * Group by: the current levels as a strip ("Work package › Cost code › … ·
 * Element ID") and a button that opens the drawer under it, where levels are
 * added, removed, moved and reset. A change applies at once (no Apply step):
 * the tree is right there to show the result.
 */
import { Button, Chip, IconButton, Select } from '../../ds'
import type { SelectOption } from '../../ds'
import { DEFAULT_NESTING, GROUPABLE, LEVEL_LABEL } from '../grouping'
import type { GroupLevel } from '../grouping'
import type { Translator } from '../i18n'

/** The estimate's own levels; the drawer's add list puts them first, then the element's. */
const ESTIMATE_LEVELS: GroupLevel[] = ['wp', 'code']

export type GroupingBarProps = {
  t: Translator
  nesting: GroupLevel[]
  onChange: (nesting: GroupLevel[]) => void
  drawerOpen: boolean
  onDrawerOpen: (open: boolean) => void
}

/** The strip, in the label column's row. */
export function GroupStrip({ t, nesting, drawerOpen, onDrawerOpen }: GroupingBarProps): JSX.Element {
  return (
    <div className="en-strip">
      <div className="en-strip__chips" data-testid="group-strip">
        {nesting.map((level, i) => (
          <span key={level} className="en-strip__step">
            {i > 0 ? <span className="en-strip__sep">›</span> : null}
            <Chip data-level={level}>{t(LEVEL_LABEL[level])}</Chip>
          </span>
        ))}
        <span className="en-strip__leaf">· {t('Element ID')}</span>
      </div>
      {/* "menu", as the original workflow: the DS icon set has no settings / options glyph. */}
      <IconButton
        icon="menu"
        size="sm"
        active={drawerOpen}
        tip={t('Configure grouping — add, remove, reorder levels')}
        data-testid="group-config"
        onClick={() => onDrawerOpen(!drawerOpen)}
      />
    </div>
  )
}

/** The drawer: one line per level with its moves, then the add list and Reset. */
export function GroupDrawer({ t, nesting, onChange }: GroupingBarProps): JSX.Element {
  const move = (from: number, to: number): void => {
    const next = [...nesting]
    const [level] = next.splice(from, 1)
    next.splice(to, 0, level)
    onChange(next)
  }
  const unused = GROUPABLE.filter((level) => !nesting.includes(level))
  const lastEstimate = unused.filter((level) => ESTIMATE_LEVELS.includes(level)).length - 1
  const addOptions: SelectOption[] = unused.map((level, i) => ({
    id: level,
    label: t(LEVEL_LABEL[level]),
    separatorAfter: i === lastEstimate,
  }))
  const isDefault = nesting.join() === DEFAULT_NESTING.join()

  return (
    <div className="en-drawer" data-testid="group-drawer">
      {nesting.map((level, i) => (
        <div key={level} className="en-drawer__row" data-testid="group-level" data-level={level}>
          <span className="en-drawer__num">{i + 1}</span>
          <span className="en-drawer__label">{t(LEVEL_LABEL[level])}</span>
          <IconButton
            icon="arrow-up"
            size="xs"
            tip={t('Move up')}
            disabled={i === 0}
            data-testid="group-up"
            onClick={() => move(i, i - 1)}
          />
          <IconButton
            icon="arrow-down"
            size="xs"
            tip={t('Move down')}
            disabled={i === nesting.length - 1}
            data-testid="group-down"
            onClick={() => move(i, i + 1)}
          />
          <IconButton
            icon="clear"
            size="xs"
            variant="danger"
            tip={t('Remove')}
            data-testid="group-remove"
            onClick={() => onChange(nesting.filter((other) => other !== level))}
          />
        </div>
      ))}
      <div className="en-drawer__foot">
        <Select
          options={addOptions}
          value={null}
          placeholder={t('Add a level')}
          disabled={addOptions.length === 0}
          data-testid="group-add"
          onChange={(level) => onChange([...nesting, level as GroupLevel])}
        />
        <Button variant="ghost" disabled={isDefault} data-testid="group-reset" onClick={() => onChange([...DEFAULT_NESTING])}>
          {t('Reset')}
        </Button>
      </div>
    </div>
  )
}
