import {
  TrendingUp,
  Receipt,
  ShoppingBag,
  Calculator,
  Tag,
  Coins,
} from 'lucide-react';
import type { SalesReportSummary } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './SalesReportStats.module.scss';

export interface SalesReportStatsProps {
  summary: SalesReportSummary;
}

export const SalesReportStats = ({ summary }: SalesReportStatsProps) => {
  return (
    <div className={styles.statsGrid} aria-label="Сводные показатели продаж">
      {/* 1. Выручка */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconGreen}`}>
          <TrendingUp size={22} aria-hidden="true" />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Выручка</span>
          <span className={styles.value} title={formatCurrency(summary.revenue)}>
            {formatCurrency(summary.revenue)}
          </span>
        </div>
      </div>

      {/* 2. Валовая прибыль */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconBlue}`}>
          <Coins size={22} aria-hidden="true" />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Валовая прибыль</span>
          <span
            className={styles.value}
            title={
              summary.isGrossProfitAvailable && summary.grossProfit !== null
                ? formatCurrency(summary.grossProfit)
                : 'Недоступно: отсутствуют данные о себестоимости'
            }
          >
            {summary.isGrossProfitAvailable && summary.grossProfit !== null
              ? formatCurrency(summary.grossProfit)
              : '—'}
          </span>
        </div>
      </div>

      {/* 3. Количество чеков */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconPurple}`}>
          <Receipt size={22} aria-hidden="true" />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Количество чеков</span>
          <span className={styles.value}>
            {formatNumber(summary.receiptsCount)}
          </span>
        </div>
      </div>

      {/* 4. Продано товаров */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconIndigo}`}>
          <ShoppingBag size={22} aria-hidden="true" />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Продано товаров</span>
          <span className={styles.value}>
            {formatNumber(summary.unitsSold)}&nbsp;шт.
          </span>
        </div>
      </div>

      {/* 5. Средний чек */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconOrange}`}>
          <Calculator size={22} aria-hidden="true" />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Средний чек</span>
          <span className={styles.value} title={formatCurrency(summary.averageCheck)}>
            {formatCurrency(summary.averageCheck)}
          </span>
        </div>
      </div>

      {/* 6. Предоставлено скидок */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconPink}`}>
          <Tag size={22} aria-hidden="true" />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Предоставлено скидок</span>
          <span className={styles.value} title={formatCurrency(summary.totalDiscount)}>
            {formatCurrency(summary.totalDiscount)}
          </span>
        </div>
      </div>
    </div>
  );
};
