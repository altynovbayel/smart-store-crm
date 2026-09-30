import { Link } from 'react-router-dom';
import type { LowStockItem } from '../../../types';
import { Badge } from '../../common/Badge/Badge';
import styles from './LowStock.module.scss';

export interface LowStockProps {
  items: LowStockItem[];
}

export const LowStock = ({ items }: LowStockProps) => {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h2 className={styles.title}>Товары, которые заканчиваются</h2>
        <Link to="/warehouse" className={styles.actionLink}>
          Все товары
        </Link>
      </header>

      <div className={styles.tableResponsiveWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Товар</th>
              <th scope="col">Остаток</th>
              <th scope="col">Порог</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={styles.productCell}>{item.name}</td>
                <td
                  className={`${styles.stockCell} ${
                    item.severity === 'critical'
                      ? styles.stockCritical
                      : styles.stockWarning
                  }`}
                >
                  {item.stock} шт.
                </td>
                <td className={styles.thresholdCell}>{item.threshold} шт.</td>
                <td className={styles.statusCell}>
                  <Badge variant={item.severity === 'critical' ? 'danger' : 'warning'}>
                    {item.statusLabel}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
