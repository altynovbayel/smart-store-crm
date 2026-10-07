import { CircleDollarSign, Receipt, Calculator, Coins } from 'lucide-react';
import type { SaleSummary } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './SalesStats.module.scss';

export interface SalesStatsProps {
  summary: SaleSummary;
}

export const SalesStats = ({ summary }: SalesStatsProps) => {
  return (
    <div className={styles.statsGrid} aria-label="Статистика продаж">
      {/* 1. Выручка сегодня */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconGreen}`} aria-hidden="true">
          <CircleDollarSign size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Выручка сегодня</span>
          <span className={styles.value}>{formatCurrency(summary.todayRevenue)}</span>
        </div>
      </div>

      {/* 2. Продажи сегодня */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconBlue}`} aria-hidden="true">
          <Receipt size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Продажи сегодня</span>
          <span className={styles.value}>{formatNumber(summary.todaySalesCount)}</span>
        </div>
      </div>

      {/* 3. Средний чек сегодня */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconPurple}`} aria-hidden="true">
          <Calculator size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Средний чек сегодня</span>
          <span className={styles.value}>{formatCurrency(summary.todayAverageCheck)}</span>
        </div>
      </div>

      {/* 4. Прибыль сегодня */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconOrange}`} aria-hidden="true">
          <Coins size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Прибыль сегодня</span>
          <span className={styles.value}>{formatCurrency(summary.todayProfit)}</span>
        </div>
      </div>
    </div>
  );
};
