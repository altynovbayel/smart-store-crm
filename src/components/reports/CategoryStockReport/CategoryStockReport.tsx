import { Layers } from 'lucide-react';
import type { CategoryStockReportItem } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './CategoryStockReport.module.scss';

export interface CategoryStockReportProps {
  items: CategoryStockReportItem[];
}

export const CategoryStockReport = ({ items }: CategoryStockReportProps) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <Layers size={20} className={styles.titleIcon} aria-hidden="true" />
          <h3 className={styles.title}>Остатки по категориям</h3>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thCategory}>Категория</th>
              <th className={styles.thCount}>Позиций</th>
              <th className={styles.thUnits}>Остаток</th>
              <th className={styles.thPurchase}>Закупочная стоимость</th>
              <th className={styles.thPotential}>Потенциальная выручка</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.category}>
                <td>
                  <span className={styles.categoryName}>{item.categoryLabel}</span>
                </td>
                <td className={styles.tdCount}>
                  <span className={styles.countValue}>{formatNumber(item.positionsCount)}</span>
                </td>
                <td className={styles.tdUnits}>
                  <span className={styles.unitsValue}>{formatNumber(item.totalUnits)}&nbsp;шт.</span>
                </td>
                <td className={styles.tdPurchase}>
                  <span className={styles.purchaseValue}>{formatCurrency(item.purchaseValue)}</span>
                </td>
                <td className={styles.tdPotential}>
                  <span className={styles.potentialValue}>{formatCurrency(item.potentialRevenue)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
