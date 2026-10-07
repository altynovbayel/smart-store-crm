import { Eye, Receipt, SearchX, CheckCircle2 } from 'lucide-react';
import type { Sale, PaymentMethod } from '../../../types';
import { PAYMENT_METHODS } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import { formatDateTime } from '../../../utils/dateUtils';
import styles from './SalesTable.module.scss';

export interface SalesTableProps {
  sales: Sale[];
  totalCount: number;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  onOpenCreateModal: () => void;
  onViewSale: (sale: Sale) => void;
}

const getPaymentBadgeClass = (method: PaymentMethod): string => {
  switch (method) {
    case 'cash':
      return `${styles.paymentBadge} ${styles.paymentCash}`;
    case 'card':
      return `${styles.paymentBadge} ${styles.paymentCard}`;
    case 'transfer':
      return `${styles.paymentBadge} ${styles.paymentTransfer}`;
    default:
      return styles.paymentBadge;
  }
};

export const SalesTable = ({
  sales,
  totalCount,
  hasActiveFilters,
  onResetFilters,
  onOpenCreateModal,
  onViewSale,
}: SalesTableProps) => {
  // Empty state: No sales registered at all
  if (totalCount === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyIconBox}>
          <Receipt size={32} className={styles.emptyIcon} />
        </div>
        <h3 className={styles.emptyTitle}>Продаж пока нет</h3>
        <p className={styles.emptySubtitle}>
          Оформите первую розничную продажу товаров через кассу для списания остатков и фиксации выручки.
        </p>
        <button
          type="button"
          className={styles.emptyActionBtn}
          onClick={onOpenCreateModal}
        >
          Оформить первую продажу
        </button>
      </div>
    );
  }

  const handleEmptyReset = () => {
    onResetFilters();
  };

  // Filtered empty state: No sales matching active filters
  if (sales.length === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyIconBox}>
          <SearchX size={32} className={styles.emptyIcon} />
        </div>
        <h3 className={styles.emptyTitle}>Ничего не найдено</h3>
        <p className={styles.emptySubtitle}>
          По вашему запросу не найдено ни одного чека продажи. Попробуйте изменить параметры поиска или фильтры.
        </p>
        {hasActiveFilters && (
          <button
            type="button"
            className={styles.emptyResetBtn}
            onClick={handleEmptyReset}
          >
            Сбросить фильтры
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.tableCard}>
      <div className={styles.tableResponsiveWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>№ чека</th>
              <th>Дата и время</th>
              <th>Товары</th>
              <th className={styles.thRight}>Кол-во единиц</th>
              <th className={styles.thRight}>Сумма без скидок</th>
              <th className={styles.thRight}>Скидка</th>
              <th className={styles.thRight}>Итог</th>
              <th>Способ оплаты</th>
              <th>Ответственный</th>
              <th>Статус</th>
              <th className={styles.thCenter}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => {
              const totalDiscount =
                sale.itemDiscountTotal + (sale.receiptDiscountAmount || 0);

              const displayItemsCount =
                sale.itemsCount ??
                sale.items.reduce((sum, it) => sum + it.quantity, 0);

              const displayProduct =
                sale.primaryProductName ||
                (sale.items.length > 1
                  ? `${sale.items[0]?.productName || 'Товар'} +${sale.items.length - 1}`
                  : sale.items[0]?.productName || '—');

              return (
                <tr key={sale.id}>
                  <td>
                    <span className={styles.receiptNumber}>
                      {sale.receiptNumber}
                    </span>
                  </td>
                  <td>
                    <span className={styles.dateText}>
                      {sale.dateTimeFormatted || formatDateTime(sale.soldAt)}
                    </span>
                  </td>
                  <td>
                    <div className={styles.productNameCell}>
                      <span className={styles.primaryProduct} title={displayProduct}>
                        {displayProduct}
                      </span>
                    </div>
                  </td>
                  <td className={styles.tdRight}>
                    <span className={styles.quantityText}>
                      {formatNumber(displayItemsCount)} шт.
                    </span>
                  </td>
                  <td className={styles.tdRight}>
                    <span className={styles.subtotalText}>
                      {formatCurrency(sale.subtotal)}
                    </span>
                  </td>
                  <td className={styles.tdRight}>
                    {totalDiscount > 0 ? (
                      <span className={styles.discountText}>
                        -{formatCurrency(totalDiscount)}
                      </span>
                    ) : (
                      <span className={styles.discountZero}>—</span>
                    )}
                  </td>
                  <td className={styles.tdRight}>
                    <strong className={styles.totalAmountText}>
                      {formatCurrency(sale.totalAmount)}
                    </strong>
                  </td>
                  <td>
                    <span className={getPaymentBadgeClass(sale.paymentMethod)}>
                      {PAYMENT_METHODS[sale.paymentMethod]}
                    </span>
                  </td>
                  <td>
                    <span className={styles.authorText}>
                      {sale.responsiblePerson}
                    </span>
                  </td>
                  <td>
                    <span className={styles.statusBadgeCompleted}>
                      <CheckCircle2 size={12} className={styles.badgeIcon} />
                      <span>{sale.statusLabel || 'Завершено'}</span>
                    </span>
                  </td>
                  <td className={styles.tdCenter}>
                    <button
                      type="button"
                      className={styles.viewBtn}
                      onClick={() => onViewSale(sale)}
                      title={`Просмотреть чек ${sale.receiptNumber}`}
                      aria-label={`Просмотреть чек ${sale.receiptNumber}`}
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
