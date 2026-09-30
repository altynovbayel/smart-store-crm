import { Link } from 'react-router-dom';
import type { Sale } from '../../../types';
import { Badge } from '../../common/Badge/Badge';
import styles from './RecentSales.module.scss';

export interface RecentSalesProps {
  sales: Sale[];
}

export const RecentSales = ({ sales }: RecentSalesProps) => {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h2 className={styles.title}>Последние продажи</h2>
        <Link to="/sales-history" className={styles.actionLink}>
          Все продажи
        </Link>
      </header>

      <div className={styles.tableResponsiveWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">№ чека</th>
              <th scope="col">Дата и время</th>
              <th scope="col">Товар</th>
              <th scope="col">Кол-во</th>
              <th scope="col">Сумма</th>
              <th scope="col">Способ оплаты</th>
              <th scope="col" className={styles.colStatus}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => (
              <tr key={sale.id}>
                <td className={styles.receiptCell}>{sale.receiptNumber}</td>
                <td className={styles.dateCell}>{sale.dateTimeFormatted}</td>
                <td className={styles.productCell}>{sale.primaryProductName}</td>
                <td className={styles.qtyCell}>{sale.itemsCount}</td>
                <td className={styles.amountCell}>
                  {sale.totalAmount.toLocaleString('ru-RU')} сом
                </td>
                <td className={styles.paymentCell}>{sale.paymentMethodLabel}</td>
                <td className={styles.statusCell}>
                  <Badge variant="success">{sale.statusLabel}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
