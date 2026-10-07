import { CircleDollarSign, Receipt, Package, Calculator } from 'lucide-react';
import type { SalesHistorySummary } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './SalesHistoryStats.module.scss';

export interface SalesHistoryStatsProps {
  summary: SalesHistorySummary;
}

export const SalesHistoryStats = ({ summary }: SalesHistoryStatsProps) => {
  return (
    <div className={styles.statsGrid} aria-label="Сводные показатели продаж">
      {/* 1. Выручка */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconGreen}`} aria-hidden="true">
          <CircleDollarSign size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Выручка</span>
          <span className={styles.value}>{formatCurrency(summary.revenue)}</span>
        </div>
      </div>

      {/* 2. Количество чеков */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconBlue}`} aria-hidden="true">
          <Receipt size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Количество чеков</span>
          <span className={styles.value}>{formatNumber(summary.receiptsCount)}</span>
        </div>
      </div>

      {/* 3. Продано товаров */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconPurple}`} aria-hidden="true">
          <Package size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Продано товаров</span>
          <span className={styles.value}>{formatNumber(summary.unitsSold)} шт.</span>
        </div>
      </div>

      {/* 4. Средний чек */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconOrange}`} aria-hidden="true">
          <Calculator size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Средний чек</span>
          <span className={styles.value}>{formatCurrency(summary.averageCheck)}</span>
        </div>
      </div>
    </div>
  );
};
