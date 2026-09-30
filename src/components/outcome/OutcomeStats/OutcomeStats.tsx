import { ArrowUpFromLine, PackageMinus, Coins, CalendarDays } from 'lucide-react';
import type { OutcomeSummary } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './OutcomeStats.module.scss';

export interface OutcomeStatsProps {
  summary: OutcomeSummary;
}

export const OutcomeStats = ({ summary }: OutcomeStatsProps) => {
  return (
    <div className={styles.statsGrid} aria-label="Статистика списаний">
      {/* 1. Списаний сегодня */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconOrange}`} aria-hidden="true">
          <ArrowUpFromLine size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Списаний сегодня</span>
          <span className={styles.value}>{formatNumber(summary.todayCount)}</span>
        </div>
      </div>

      {/* 2. Списано штук сегодня */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconPurple}`} aria-hidden="true">
          <PackageMinus size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Списано штук сегодня</span>
          <span className={styles.value}>{formatNumber(summary.todayUnits)} шт.</span>
        </div>
      </div>

      {/* 3. Себестоимость списаний сегодня */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconRed}`} aria-hidden="true">
          <Coins size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Себестоимость сегодня</span>
          <span className={styles.value}>{formatCurrency(summary.todayCost)}</span>
        </div>
      </div>

      {/* 4. Списаний за 30 дней */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconBlue}`} aria-hidden="true">
          <CalendarDays size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Списаний за 30 дней</span>
          <span className={styles.value}>{formatNumber(summary.monthCount)}</span>
        </div>
      </div>
    </div>
  );
};
