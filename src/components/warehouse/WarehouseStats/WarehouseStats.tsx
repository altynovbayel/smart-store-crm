import { Package, Coins, AlertTriangle, XCircle } from 'lucide-react';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './WarehouseStats.module.scss';

export interface WarehouseStatsProps {
  totalCount: number;
  totalCost: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export const WarehouseStats = ({
  totalCount,
  totalCost,
  lowStockCount,
  outOfStockCount,
}: WarehouseStatsProps) => {
  return (
    <div className={styles.statsGrid} aria-label="Сводка склада">
      {/* 1. Всего товаров */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconBlue}`} aria-hidden="true">
          <Package size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Всего товаров</span>
          <span className={styles.value}>{formatNumber(totalCount)}</span>
        </div>
      </div>

      {/* 2. Стоимость склада */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconGreen}`} aria-hidden="true">
          <Coins size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Стоимость склада</span>
          <span className={styles.value}>{formatCurrency(totalCost)}</span>
        </div>
      </div>

      {/* 3. Заканчиваются */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconOrange}`} aria-hidden="true">
          <AlertTriangle size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Заканчиваются</span>
          <span className={styles.value}>{formatNumber(lowStockCount)}</span>
        </div>
      </div>

      {/* 4. Нет в наличии */}
      <div className={styles.statCard}>
        <div className={`${styles.iconBox} ${styles.iconRed}`} aria-hidden="true">
          <XCircle size={22} />
        </div>
        <div className={styles.content}>
          <span className={styles.title}>Нет в наличии</span>
          <span className={styles.value}>{formatNumber(outOfStockCount)}</span>
        </div>
      </div>
    </div>
  );
};
