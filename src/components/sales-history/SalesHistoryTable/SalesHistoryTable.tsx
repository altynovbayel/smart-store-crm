import {
  Eye,
  Receipt,
  SearchX,
  CheckCircle2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type {
  Sale,
  PaymentMethod,
  SalesHistorySort,
  SalesHistorySortField,
} from '../../../types';
import { PAYMENT_METHODS } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import { formatDateTime } from '../../../utils/dateUtils';
import {
  getSaleUnitsCount,
  getSaleTotalDiscount,
} from '../../../utils/salesHistoryUtils';
import styles from './SalesHistoryTable.module.scss';

export interface SalesHistoryTableProps {
  sales: Sale[];
  totalCount: number;
  sort: SalesHistorySort;
  onSortChange: (sort: SalesHistorySort) => void;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
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

export const SalesHistoryTable = ({
  sales,
  totalCount,
  sort,
  onSortChange,
  hasActiveFilters,
  onResetFilters,
  onViewSale,
}: SalesHistoryTableProps) => {
  const handleSort = (field: SalesHistorySortField) => {
    if (sort.field === field) {
      onSortChange({
        field,
        direction: sort.direction === 'asc' ? 'desc' : 'asc',
      });
    } else {
      onSortChange({
        field,
        direction: field === 'receiptNumber' ? 'asc' : 'desc',
      });
    }
  };

  const renderSortIndicator = (field: SalesHistorySortField) => {
    if (sort.field !== field) {
      return <ArrowUpDown size={13} className={styles.sortInactive} aria-hidden="true" />;
    }
    return sort.direction === 'asc' ? (
      <ArrowUp size={13} className={styles.sortActive} aria-hidden="true" />
    ) : (
      <ArrowDown size={13} className={styles.sortActive} aria-hidden="true" />
    );
  };

  // Empty state: No sales exist in the system
  if (totalCount === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyIconBox}>
          <Receipt size={32} className={styles.emptyIcon} />
        </div>
        <h3 className={styles.emptyTitle}>История продаж пуста</h3>
        <p className={styles.emptySubtitle}>
          Проведённые продажи через кассу будут автоматически фиксироваться в этом журнале.
        </p>
      </div>
    );
  }

  // Filtered empty state: No sales matching current filters
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
            onClick={onResetFilters}
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
        <table className={styles.table} aria-label="Журнал фискальных чеков">
          <thead>
            <tr>
              {/* № чека - sortable */}
              <th
                scope="col"
                aria-sort={
                  sort.field === 'receiptNumber'
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button
                  type="button"
                  className={styles.sortableHeaderBtn}
                  onClick={() => handleSort('receiptNumber')}
                  aria-label="Сортировать по номеру чека"
                >
                  <span>№ чека</span>
                  {renderSortIndicator('receiptNumber')}
                </button>
              </th>

              {/* Дата и время - sortable */}
              <th
                scope="col"
                aria-sort={
                  sort.field === 'soldAt'
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button
                  type="button"
                  className={styles.sortableHeaderBtn}
                  onClick={() => handleSort('soldAt')}
                  aria-label="Сортировать по дате и времени"
                >
                  <span>Дата и время</span>
                  {renderSortIndicator('soldAt')}
                </button>
              </th>

              {/* Товары */}
              <th scope="col">Товары</th>

              {/* Кол-во товаров - sortable */}
              <th
                scope="col"
                className={styles.thRight}
                aria-sort={
                  sort.field === 'unitsCount'
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button
                  type="button"
                  className={`${styles.sortableHeaderBtn} ${styles.btnRight}`}
                  onClick={() => handleSort('unitsCount')}
                  aria-label="Сортировать по количеству единиц товара"
                >
                  <span>Кол-во (шт.)</span>
                  {renderSortIndicator('unitsCount')}
                </button>
              </th>

              {/* Сумма без скидок */}
              <th scope="col" className={styles.thRight}>
                Сумма без скидок
              </th>

              {/* Скидка */}
              <th scope="col" className={styles.thRight}>
                Скидка
              </th>

              {/* Итог - sortable */}
              <th
                scope="col"
                className={styles.thRight}
                aria-sort={
                  sort.field === 'totalAmount'
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button
                  type="button"
                  className={`${styles.sortableHeaderBtn} ${styles.btnRight}`}
                  onClick={() => handleSort('totalAmount')}
                  aria-label="Сортировать по сумме чека"
                >
                  <span>Итого</span>
                  {renderSortIndicator('totalAmount')}
                </button>
              </th>

              {/* Способ оплаты */}
              <th scope="col">Способ оплаты</th>

              {/* Ответственный */}
              <th scope="col">Ответственный</th>

              {/* Статус */}
              <th scope="col">Статус</th>

              {/* Действия */}
              <th scope="col" className={styles.thCenter}>
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => {
              const totalDiscount = getSaleTotalDiscount(sale);
              const unitsCount = getSaleUnitsCount(sale);

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
                      {formatNumber(unitsCount)} шт.
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
