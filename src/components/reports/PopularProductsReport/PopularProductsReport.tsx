import { Award, PackageOpen } from 'lucide-react';
import type { ProductSalesReportItem } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './PopularProductsReport.module.scss';

export interface PopularProductsReportProps {
  items: ProductSalesReportItem[];
}

export const PopularProductsReport = ({ items }: PopularProductsReportProps) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <Award size={20} className={styles.titleIcon} aria-hidden="true" />
          <h3 className={styles.title}>Популярные товары (Топ-5)</h3>
        </div>
        <span className={styles.subtitle}>По количеству проданных единиц</span>
      </div>

      {items.length === 0 ? (
        <div className={styles.emptyState}>
          <PackageOpen size={36} className={styles.emptyIcon} aria-hidden="true" />
          <p className={styles.emptyText}>Нет продаж товаров за выбранный период</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thRank}>#</th>
                <th className={styles.thProduct}>Товар</th>
                <th className={styles.thQuantity}>Продано</th>
                <th className={styles.thRevenue}>Выручка</th>
                <th className={styles.thShare}>Доля</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.productId}>
                  <td className={styles.tdRank}>
                    <span
                      className={`${styles.rankBadge} ${
                        item.rank === 1
                          ? styles.rankFirst
                          : item.rank === 2
                          ? styles.rankSecond
                          : item.rank === 3
                          ? styles.rankThird
                          : ''
                      }`}
                    >
                      {item.rank}
                    </span>
                  </td>
                  <td>
                    <div className={styles.productName} title={item.productName}>
                      {item.productName}
                    </div>
                    <div className={styles.productSku}>{item.sku}</div>
                  </td>
                  <td className={styles.tdQuantity}>
                    <span className={styles.quantityValue}>
                      {formatNumber(item.unitsSold)}&nbsp;шт.
                    </span>
                  </td>
                  <td className={styles.tdRevenue}>
                    <span className={styles.revenueValue}>
                      {formatCurrency(item.revenue)}
                    </span>
                  </td>
                  <td>
                    <div className={styles.shareGroup}>
                      <span className={styles.shareValue}>
                        {item.revenueShare.toFixed(1)}%
                      </span>
                      <div className={styles.shareTrack}>
                        <div
                          className={styles.shareFill}
                          style={{ width: `${Math.min(item.revenueShare, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
