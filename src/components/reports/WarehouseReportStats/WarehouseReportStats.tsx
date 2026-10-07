import {
  Boxes,
  PackageCheck,
  CircleDollarSign,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import type { WarehouseReportSummary } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './WarehouseReportStats.module.scss';

export interface WarehouseReportStatsProps {
  summary: WarehouseReportSummary;
}

export const WarehouseReportStats = ({ summary }: WarehouseReportStatsProps) => {
  return (
    <div className={styles.wrapper}>
      {summary.isOverflow && (
        <div className={styles.overflowAlert} role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>Значения некоторых складских сумм превышают предел безопасных вычислений JavaScript.</span>
        </div>
      )}

      <div className={styles.statsGrid} aria-label="Сводные складские показатели">
        {/* 1. Активных позиций */}
        <div className={styles.statCard}>
          <div className={`${styles.iconBox} ${styles.iconBlue}`}>
            <Boxes size={22} aria-hidden="true" />
          </div>
          <div className={styles.content}>
            <span className={styles.title}>Активных позиций</span>
            <span className={styles.value}>
              {formatNumber(summary.activePositionsCount)}
            </span>
          </div>
        </div>

        {/* 2. Всего единиц на складе */}
        <div className={styles.statCard}>
          <div className={`${styles.iconBox} ${styles.iconIndigo}`}>
            <PackageCheck size={22} aria-hidden="true" />
          </div>
          <div className={styles.content}>
            <span className={styles.title}>Всего единиц на складе</span>
            <span className={styles.value}>
              {formatNumber(summary.totalUnitsInStock)}&nbsp;шт.
            </span>
          </div>
        </div>

        {/* 3. Закупочная стоимость остатков */}
        <div className={styles.statCard}>
          <div className={`${styles.iconBox} ${styles.iconPurple}`}>
            <CircleDollarSign size={22} aria-hidden="true" />
          </div>
          <div className={styles.content}>
            <span className={styles.title}>Закупочная стоимость</span>
            <span className={styles.value} title={formatCurrency(summary.totalPurchaseValue)}>
              {formatCurrency(summary.totalPurchaseValue)}
            </span>
          </div>
        </div>

        {/* 4. Потенциальная выручка */}
        <div className={styles.statCard}>
          <div className={`${styles.iconBox} ${styles.iconGreen}`}>
            <TrendingUp size={22} aria-hidden="true" />
          </div>
          <div className={styles.content}>
            <span className={styles.title}>Потенциальная выручка</span>
            <span className={styles.value} title={formatCurrency(summary.totalPotentialRevenue)}>
              {formatCurrency(summary.totalPotentialRevenue)}
            </span>
          </div>
        </div>

        {/* 5. Требуют внимания */}
        <div className={styles.statCard}>
          <div className={`${styles.iconBox} ${summary.attentionItemsCount > 0 ? styles.iconDanger : styles.iconMuted}`}>
            <AlertTriangle size={22} aria-hidden="true" />
          </div>
          <div className={styles.content}>
            <span className={styles.title}>Требуют внимания</span>
            <span className={`${styles.value} ${summary.attentionItemsCount > 0 ? styles.valueDanger : ''}`}>
              {formatNumber(summary.attentionItemsCount)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
