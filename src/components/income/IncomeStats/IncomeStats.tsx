import { ArrowDownToLine, PackageCheck, Coins, Building2 } from 'lucide-react';
import type { IncomeSummary } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './IncomeStats.module.scss';

export interface IncomeStatsProps {
  summary: IncomeSummary;
}

export const IncomeStats = ({ summary }: IncomeStatsProps) => {
  return (
    <div className={styles.statsGrid} aria-label="Статистика приходов">
      {/* 1. Приходов сегодня */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconBlue}`} aria-hidden="true">
          <ArrowDownToLine size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Приходов сегодня</span>
          <span className={styles.value}>{formatNumber(summary.todayCount)}</span>
        </div>
      </div>

      {/* 2. Принято единиц сегодня */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconPurple}`} aria-hidden="true">
          <PackageCheck size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Принято единиц сегодня</span>
          <span className={styles.value}>{formatNumber(summary.todayUnits)} шт.</span>
        </div>
      </div>

      {/* 3. Сумма прихода сегодня */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconGreen}`} aria-hidden="true">
          <Coins size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Сумма прихода сегодня</span>
          <span className={styles.value}>{formatCurrency(summary.todayAmount)}</span>
        </div>
      </div>

      {/* 4. Всего поставщиков */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconOrange}`} aria-hidden="true">
          <Building2 size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Всего поставщиков</span>
          <span className={styles.value}>{formatNumber(summary.suppliersCount)}</span>
        </div>
      </div>
    </div>
  );
};
