import type { SaleTotals } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './SaleFormModal.module.scss';

export interface SaleSummaryProps {
  itemsCount: number;
  totals: SaleTotals;
  totalError?: string;
}

/**
 * Receipt totals preview. Amounts mirror the server algorithm; the server recalculates them.
 */
export const SaleSummary = ({ itemsCount, totals, totalError }: SaleSummaryProps) => (
  <div className={styles.summaryBox}>
    <div className={styles.summaryRow}>
      <span>Всего позиций / единиц:</span>
      <span>
        {itemsCount} поз. / {formatNumber(totals.totalUnits)} шт.
      </span>
    </div>
    <div className={styles.summaryRow}>
      <span>Сумма без скидок:</span>
      <span>{formatCurrency(totals.subtotal)}</span>
    </div>
    {totals.itemDiscountTotal > 0 && (
      <div className={styles.summaryRow}>
        <span>Скидки по позициям:</span>
        <span style={{ color: '#dc2626' }}>-{formatCurrency(totals.itemDiscountTotal)}</span>
      </div>
    )}
    {totals.receiptDiscountAmount > 0 && (
      <div className={styles.summaryRow}>
        <span>Скидка на чек:</span>
        <span style={{ color: '#dc2626' }}>-{formatCurrency(totals.receiptDiscountAmount)}</span>
      </div>
    )}
    <div className={styles.summaryTotalRow}>
      <span>Итого к оплате:</span>
      <span className={styles.totalHighlight}>
        {totals.isOverflow ? 'Превышен предел сумм' : formatCurrency(totals.totalAmount)}
      </span>
    </div>
    {totals.isOverflow && !totalError && (
      <span className={styles.errorText} role="alert">
        Сумма чека или себестоимости превышает допустимый математический предел
      </span>
    )}
    {totalError && (
      <span className={styles.errorText} role="alert">
        {totalError}
      </span>
    )}
  </div>
);
