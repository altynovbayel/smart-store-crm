import { AlertCircle } from 'lucide-react';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import type { OutcomeTotals } from '../../../utils/outcomeCalculations';
import type { HistoricalPriceStatus } from './useOutcomeHistoricalPrices';
import styles from './OutcomeFormModal.module.scss';

export interface OutcomeFormSummaryProps {
  itemsCount: number;
  totals: OutcomeTotals;
  priceStatus: HistoricalPriceStatus;
  priceErrorMessage: string | null;
}

/**
 * Summary card shown before conducting a write-off: positions, units and historical cost.
 */
export const OutcomeFormSummary = ({
  itemsCount,
  totals,
  priceStatus,
  priceErrorMessage,
}: OutcomeFormSummaryProps) => (
  <div className={styles.summaryCard}>
    <div className={styles.summaryItem}>
      <span className={styles.summaryLabel}>Всего позиций:</span>
      <strong className={styles.summaryValue}>{itemsCount}</strong>
    </div>
    <div className={styles.summaryItem}>
      <span className={styles.summaryLabel}>Всего единиц к списанию:</span>
      <strong className={styles.summaryValue}>
        {formatNumber(totals.totalUnits)} шт.
      </strong>
    </div>
    <div className={styles.summaryItem}>
      <span className={styles.summaryLabel}>Общая себестоимость:</span>
      <strong
        className={
          totals.isOverflow ? styles.summaryTotalOverflow : styles.summaryTotalAmount
        }
      >
        {priceStatus === 'loading'
          ? 'Загрузка цен...'
          : priceStatus === 'error'
            ? 'Расчёт на сервере'
            : totals.isOverflow
              ? 'Превышен предел сумм'
              : formatCurrency(totals.totalCost)}
      </strong>
    </div>
    {priceStatus === 'error' && (
      <div className={styles.priceWarningNotice} role="note">
        <AlertCircle size={14} />
        <span>
          {priceErrorMessage ||
            'Не удалось загрузить историю цен. Итоговая себестоимость будет точно рассчитана сервером при проведении.'}
        </span>
      </div>
    )}
  </div>
);
