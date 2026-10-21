/**
 * The panel's foot, always in view (footer.js): the active sheet's markups on
 * the left, the TOTAL on the right. A markup is a named percentage of the
 * direct cost; the total adds them all.
 *
 * Each control changes ONE markup, by id: the hook applies that change to the
 * stored list when it writes, so a markup someone else added or changed in
 * the meantime is not overwritten by this page's older copy of the list.
 */
import { Button, IconButton, Input, NumberInput } from '../../ds'
import { amount, codedText } from '../i18n'
import { useEstimateUi } from './context'

export function Footer(): JSX.Element {
  const { est } = useEstimateUi()
  const { t, totals, canEdit } = est
  const markups = est.sheet.markups

  return (
    <div className="en-foot" data-testid="footer">
      <div className="en-markups">
        <div className="en-mrow en-mrow--head">
          <span>{t('Markups')}</span>
          <span className="en-num">%</span>
          <span className="en-num">{t('Amount ¥')}</span>
          <span />
        </div>
        {markups.map((markup) => (
          <div key={markup.id} className="en-mrow" data-testid="markup-row" data-id={markup.id}>
            <Input
              value={markup.name}
              maxLength={80}
              disabled={!canEdit}
              ariaLabel={t('Markups')}
              data-testid="markup-name"
              onCommit={(name) => {
                if (name.trim()) est.updateMarkup(markup.id, { name })
              }}
            />
            <NumberInput
              value={markup.pct}
              min={-100}
              max={1000}
              step={0.5}
              decimals={2}
              disabled={!canEdit}
              ariaLabel="%"
              data-testid="markup-pct"
              onChange={(pct) => est.updateMarkup(markup.id, { pct: pct ?? 0 })}
            />
            <span className="en-num">{amount((totals.direct * markup.pct) / 100)}</span>
            <IconButton
              icon="trash"
              size="sm"
              variant="danger"
              tip={t('Delete')}
              disabled={!canEdit}
              data-testid="markup-delete"
              onClick={() => est.deleteMarkup(markup.id)}
            />
          </div>
        ))}
        <div>
          <Button
            variant="ghost"
            icon="add"
            disabled={!canEdit}
            data-testid="markup-add"
            onClick={() => est.addMarkup(t('New markup'))}
          >
            {t('Add markup')}
          </Button>
        </div>
      </div>
      <div className="en-total">
        <div className="en-total__label">{t('TOTAL')}</div>
        <div className="en-total__value" data-testid="total-value">
          {est.money(totals.total)}
        </div>
        <div className="en-total__sub" data-testid="direct-cost">
          {t('Direct cost')} {est.money(totals.direct)}
        </div>
        <div className="en-total__sub">
          {t('Markups {pct}%', { pct: Math.round(totals.markupPct * 100) / 100 })} {est.money(totals.markup)}
        </div>
        <div className="en-total__sub" data-testid="coded-count">
          {codedText(t, totals.ncode, totals.nall)}
        </div>
        {totals.nmissing ? (
          <div className="en-total__sub en-total__sub--warn" data-testid="missing-count">
            {t('{n} without a quantity', { n: totals.nmissing.toLocaleString() })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
