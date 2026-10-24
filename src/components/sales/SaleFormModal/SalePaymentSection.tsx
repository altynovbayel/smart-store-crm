import type { PaymentMethod } from '../../../types';
import { PAYMENT_METHODS } from '../../../types';
import { formatCurrency } from '../../../utils/formatUtils';
import styles from './SaleFormModal.module.scss';

export interface SalePaymentSectionProps {
  paymentMethod: PaymentMethod;
  rawReceivedAmount: string;
  totalAmount: number;
  changeAmount: number;
  errors: Record<string, string>;
  disabled: boolean;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  onReceivedAmountChange: (value: string) => void;
}

const isPaymentMethod = (value: string): value is PaymentMethod => value in PAYMENT_METHODS;

/**
 * Payment method selector and, for cash, the received amount with the change preview.
 */
export const SalePaymentSection = ({
  paymentMethod,
  rawReceivedAmount,
  totalAmount,
  changeAmount,
  errors,
  disabled,
  onPaymentMethodChange,
  onReceivedAmountChange,
}: SalePaymentSectionProps) => (
  <>
    <div className={styles.formGroup}>
      <label htmlFor="sale-payment-method" className={styles.label}>
        Способ оплаты <span className={styles.requiredStar}>*</span>
      </label>
      <select
        id="sale-payment-method"
        className={styles.select}
        value={paymentMethod}
        disabled={disabled}
        onChange={(e) => {
          if (isPaymentMethod(e.target.value)) onPaymentMethodChange(e.target.value);
        }}
      >
        {(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((pm) => (
          <option key={pm} value={pm}>
            {PAYMENT_METHODS[pm]}
          </option>
        ))}
      </select>
    </div>

    {paymentMethod === 'cash' && (
      <div className={styles.cashPaymentBox}>
        <div className={styles.cashInputGroup}>
          <div className={styles.formGroup}>
            <label htmlFor="sale-cash-received" className={styles.label}>
              Получено от покупателя (сом) <span className={styles.requiredStar}>*</span>
            </label>
            <input
              id="sale-cash-received"
              type="text"
              inputMode="decimal"
              className={styles.input}
              placeholder={String(totalAmount)}
              value={rawReceivedAmount}
              disabled={disabled}
              onChange={(e) => onReceivedAmountChange(e.target.value)}
              aria-invalid={errors.receivedAmount ? 'true' : undefined}
              aria-describedby={errors.receivedAmount ? 'sale-received-err' : undefined}
            />
            {errors.receivedAmount && (
              <span id="sale-received-err" className={styles.errorText} role="alert">
                {errors.receivedAmount}
              </span>
            )}
          </div>
        </div>

        <div className={styles.cashChangeDisplay}>
          <span className={styles.changeLabel}>Сдача к выдаче</span>
          <span className={styles.changeValue}>{formatCurrency(changeAmount)}</span>
        </div>
      </div>
    )}
  </>
);
