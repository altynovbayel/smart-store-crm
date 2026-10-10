import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import type { AttentionProductItem } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './AttentionProductsTable.module.scss';

export interface AttentionProductsTableProps {
  items: AttentionProductItem[];
}

export const AttentionProductsTable = ({ items }: AttentionProductsTableProps) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <AlertTriangle size={20} className={styles.titleIcon} aria-hidden="true" />
          <h3 className={styles.title}>Товары, требующие внимания</h3>
          {items.length > 0 && (
            <span className={styles.countBadge}>{items.length}</span>
          )}
        </div>

        <Link to="/warehouse" className={styles.warehouseLink}>
          <span>Перейти на склад</span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>

      {items.length === 0 ? (
        <div className={styles.emptyState}>
          <CheckCircle2 size={36} className={styles.emptyIcon} aria-hidden="true" />
          <p className={styles.emptyText}>Все товары в достаточном количестве на складе</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thProduct}>Товар</th>
                <th className={styles.thCategory}>Категория</th>
                <th className={styles.thStock}>Текущий остаток</th>
                <th className={styles.thThreshold}>Мин. порог</th>
                <th className={styles.thPrice}>Закупочная цена</th>
                <th className={styles.thValue}>Сумма остатка</th>
                <th className={styles.thStatus}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className={styles.productName} title={item.name}>
                      {item.name}
                    </div>
                    <div className={styles.productSku}>{item.sku}</div>
                  </td>
                  <td>
                    <span className={styles.categoryBadge}>{item.categoryLabel}</span>
                  </td>
                  <td className={styles.tdStock}>
                    <span
                      className={`${styles.stockValue} ${
                        item.stock === 0 ? styles.stockZero : styles.stockLow
                      }`}
                    >
                      {formatNumber(item.stock)}&nbsp;{item.unit}
                    </span>
                  </td>
                  <td className={styles.tdThreshold}>
                    <span className={styles.thresholdValue}>
                      {formatNumber(item.minStockThreshold)}&nbsp;{item.unit}
                    </span>
                  </td>
                  <td className={styles.tdPrice}>
                    <span className={styles.priceValue}>{formatCurrency(item.purchasePrice)}</span>
                  </td>
                  <td className={styles.tdValue}>
                    <span className={styles.valueText}>{formatCurrency(item.stockPurchaseValue)}</span>
                  </td>
                  <td>
                    <span
                      className={`${styles.statusBadge} ${
                        item.status === 'out_of_stock'
                          ? styles.statusOutOfStock
                          : styles.statusLowStock
                      }`}
                    >
                      {item.status === 'out_of_stock' ? 'Нет в наличии' : 'Заканчивается'}
                    </span>
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
