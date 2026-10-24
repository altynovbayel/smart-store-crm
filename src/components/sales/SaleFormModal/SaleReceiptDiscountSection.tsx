import type { DiscountType } from '../../../types';
import styles from './SaleFormModal.module.scss';

export interface SaleReceiptDiscountSectionProps {
  discountType: DiscountType;
  rawDiscountValue: string;
  error?: string;
  disabled: boolean;
  onDiscountTypeChange: (type: DiscountType) => void;
  onDiscountValueChange: (value: string) => void;
}

/**
 * Receipt-level (total) discount: fixed amount in som or percent.
 */
export const SaleReceiptDiscountSection = ({
  discountType,
  rawDiscountValue,
  error,
  disabled,
  onDiscountTypeChange,
  onDiscountValueChange,
}: SaleReceiptDiscountSectionProps) => (
  <div className={styles.discountSection}>
    <div className={styles.sectionTitle}>Скидка на чек (общая)</div>
    <div className={styles.fieldGrid}>
      <div className={styles.formGroup}>
        <label htmlFor="sale-receipt-discount-type" className={styles.label}>
          Тип скидки
        </label>
        <select
          id="sale-receipt-discount-type"
          className={styles.select}
          value={discountType}
          disabled={disabled}
          onChange={(e) => onDiscountTypeChange(e.target.value === 'percent' ? 'percent' : 'fixed')}
        >
          <option value="fixed">Фиксированная (сом)</option>
          <option value="percent">Процентная (%)</option>
        </select>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="sale-receipt-discount-val" className={styles.label}>
          Размер скидки на чек
        </label>
        <input
          id="sale-receipt-discount-val"
          type="text"
          inputMode="decimal"
          className={styles.input}
          placeholder="0"
          value={rawDiscountValue}
          disabled={disabled}
          onChange={(e) => onDiscountValueChange(e.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'sale-receipt-discount-err' : undefined}
        />
        {error && (
          <span id="sale-receipt-discount-err" className={styles.errorText} role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  </div>
);
