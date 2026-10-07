import { Banknote, CreditCard, ArrowRightLeft } from 'lucide-react';
import type { PaymentReportItem, PaymentMethod } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './PaymentBreakdown.module.scss';

export interface PaymentBreakdownProps {
  items: PaymentReportItem[];
}

const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowRightLeft,
};

const METHOD_COLOR_CLASSES: Record<PaymentMethod, { icon: string; bar: string }> = {
  cash: { icon: styles.iconCash, bar: styles.barCash },
  card: { icon: styles.iconCard, bar: styles.barCard },
  transfer: { icon: styles.iconTransfer, bar: styles.barTransfer },
};

export const PaymentBreakdown = ({ items }: PaymentBreakdownProps) => {
  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Структура оплат</h3>

      <div className={styles.list}>
        {items.map((item) => {
          const Icon = METHOD_ICONS[item.method] || CreditCard;
          const colorClass = METHOD_COLOR_CLASSES[item.method] || {
            icon: styles.iconCard,
            bar: styles.barCard,
          };

          return (
            <div key={item.method} className={styles.itemCard}>
              <div className={styles.itemHeader}>
                <div className={styles.itemTitleGroup}>
                  <div className={`${styles.iconWrapper} ${colorClass.icon}`}>
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <div className={styles.methodName}>{item.label}</div>
                    <div className={styles.receiptsCount}>
                      {formatNumber(item.receiptsCount)} {item.receiptsCount === 1 ? 'чек' : 'чеков'}
                    </div>
                  </div>
                </div>

                <div className={styles.amountGroup}>
                  <div className={styles.amount}>{formatCurrency(item.amount)}</div>
                  <div className={styles.percentage}>{item.percentage.toFixed(1)}%</div>
                </div>
              </div>

              {/* Progress bar */}
              <div className={styles.progressBarTrack} role="progressbar" aria-valuenow={item.percentage} aria-valuemin={0} aria-valuemax={100} aria-label={`${item.label}: ${item.percentage.toFixed(1)}%`}>
                <div
                  className={`${styles.progressBarFill} ${colorClass.bar}`}
                  style={{ width: `${Math.max(item.percentage, item.amount > 0 ? 2 : 0)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
