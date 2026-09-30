import { Eye, FileSpreadsheet, SearchX, CheckCircle2 } from 'lucide-react';
import type { IncomeReceipt } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import { formatDateTime } from '../../../utils/dateUtils';
import styles from './IncomeTable.module.scss';

export interface IncomeTableProps {
  receipts: IncomeReceipt[];
  totalReceiptsCount: number;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  onOpenCreateModal: () => void;
  onViewReceipt: (receipt: IncomeReceipt) => void;
}

export const IncomeTable = ({
  receipts,
  totalReceiptsCount,
  hasActiveFilters,
  onResetFilters,
  onOpenCreateModal,
  onViewReceipt,
}: IncomeTableProps) => {
  // Empty state: No receipts registered at all
  if (totalReceiptsCount === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyIconBox}>
          <FileSpreadsheet size={32} className={styles.emptyIcon} />
        </div>
        <h3 className={styles.emptyTitle}>Приходных накладных пока нет</h3>
        <p className={styles.emptySubtitle}>
          Оформите первое поступление товаров от поставщика на склад для автоматического учёта остатков.
        </p>
        <button
          type="button"
          className={styles.emptyActionBtn}
          onClick={onOpenCreateModal}
        >
          Оформить первый приход
        </button>
      </div>
    );
  }

  const handleEmptyReset = () => {
    onResetFilters();
    requestAnimationFrame(() => {
      const searchInput = document.querySelector<HTMLInputElement>(
        'input[type="search"]'
      );
      if (searchInput && document.contains(searchInput)) {
        searchInput.focus();
      }
    });
  };

  // Filtered empty state: No receipts matching active filters
  if (receipts.length === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyIconBox}>
          <SearchX size={32} className={styles.emptyIcon} />
        </div>
        <h3 className={styles.emptyTitle}>Ничего не найдено</h3>
        <p className={styles.emptySubtitle}>
          По вашему запросу не найдено ни одной приходной накладной. Попробуйте изменить параметры поиска или период.
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
              <th>№ прихода</th>
              <th>Дата и время</th>
              <th>Поставщик</th>
              <th>Документ</th>
              <th className={styles.thRight}>Позиций</th>
              <th className={styles.thRight}>Кол-во единиц</th>
              <th className={styles.thRight}>Сумма</th>
              <th>Ответственный</th>
              <th>Статус</th>
              <th className={styles.thCenter}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id}>
                <td>
                  <span className={styles.receiptNumber}>{receipt.receiptNumber}</span>
                </td>
                <td>
                  <span className={styles.dateText}>
                    {formatDateTime(receipt.receivedAt)}
                  </span>
                </td>
                <td>
                  <span className={styles.supplierText}>{receipt.supplier}</span>
                </td>
                <td>
                  <span className={styles.docText}>
                    {receipt.documentNumber || '—'}
                  </span>
                </td>
                <td className={styles.tdRight}>
                  <span>{receipt.items.length}</span>
                </td>
                <td className={styles.tdRight}>
                  <span className={styles.quantityText}>
                    {formatNumber(receipt.totalQuantity)} шт.
                  </span>
                </td>
                <td className={styles.tdRight}>
                  <strong className={styles.amountText}>
                    {formatCurrency(receipt.totalAmount)}
                  </strong>
                </td>
                <td>
                  <span className={styles.authorText}>
                    {receipt.responsiblePerson}
                  </span>
                </td>
                <td>
                  <span className={styles.statusBadgeCompleted}>
                    <CheckCircle2 size={12} className={styles.badgeIcon} />
                    <span>Проведён</span>
                  </span>
                </td>
                <td className={styles.tdCenter}>
                  <button
                    type="button"
                    className={styles.viewBtn}
                    onClick={() => onViewReceipt(receipt)}
                    title={`Просмотреть накладную ${receipt.receiptNumber}`}
                    aria-label={`Просмотреть накладную ${receipt.receiptNumber}`}
                  >
                    <Eye size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
