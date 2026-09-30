import { Eye, FileSpreadsheet, SearchX, CheckCircle2 } from 'lucide-react';
import type { OutcomeDocument, OutcomeReason } from '../../../types';
import { OUTCOME_REASONS } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import { formatDateTime } from '../../../utils/dateUtils';
import styles from './OutcomeTable.module.scss';

export interface OutcomeTableProps {
  documents: OutcomeDocument[];
  totalCount: number;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  onOpenCreateModal: () => void;
  onViewDocument: (document: OutcomeDocument) => void;
}

const getReasonBadgeClass = (reason: OutcomeReason): string => {
  switch (reason) {
    case 'damaged':
      return `${styles.reasonBadge} ${styles.reasonDamaged}`;
    case 'defective':
      return `${styles.reasonBadge} ${styles.reasonDefective}`;
    case 'lost':
      return `${styles.reasonBadge} ${styles.reasonLost}`;
    case 'internal_use':
      return `${styles.reasonBadge} ${styles.reasonInternalUse}`;
    case 'other':
    default:
      return `${styles.reasonBadge} ${styles.reasonOther}`;
  }
};

export const OutcomeTable = ({
  documents,
  totalCount,
  hasActiveFilters,
  onResetFilters,
  onOpenCreateModal,
  onViewDocument,
}: OutcomeTableProps) => {
  // Empty state: No outcome documents registered at all
  if (totalCount === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyIconBox}>
          <FileSpreadsheet size={32} className={styles.emptyIcon} />
        </div>
        <h3 className={styles.emptyTitle}>Списаний пока нет</h3>
        <p className={styles.emptySubtitle}>
          Оформите первое списание товаров со склада для учёта брака, повреждений или внутренних нужд магазина.
        </p>
        <button
          type="button"
          className={styles.emptyActionBtn}
          onClick={onOpenCreateModal}
        >
          Оформить первое списание
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

  // Filtered empty state: No documents matching active filters
  if (documents.length === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyIconBox}>
          <SearchX size={32} className={styles.emptyIcon} />
        </div>
        <h3 className={styles.emptyTitle}>Ничего не найдено</h3>
        <p className={styles.emptySubtitle}>
          По вашему запросу не найдено ни одного документа списания. Попробуйте изменить параметры поиска или фильтры.
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
              <th>№ списания</th>
              <th>Дата и время</th>
              <th>Причина</th>
              <th className={styles.thRight}>Позиций</th>
              <th className={styles.thRight}>Кол-во единиц</th>
              <th className={styles.thRight}>Себестоимость</th>
              <th>Ответственный</th>
              <th>Статус</th>
              <th className={styles.thCenter}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>
                  <span className={styles.outcomeNumber}>{doc.outcomeNumber}</span>
                </td>
                <td>
                  <span className={styles.dateText}>
                    {formatDateTime(doc.documentDate)}
                  </span>
                </td>
                <td>
                  <span className={getReasonBadgeClass(doc.reason)}>
                    {OUTCOME_REASONS[doc.reason]}
                  </span>
                </td>
                <td className={styles.tdRight}>
                  <span>{doc.items.length}</span>
                </td>
                <td className={styles.tdRight}>
                  <span className={styles.quantityText}>
                    {formatNumber(doc.totalQuantity)} шт.
                  </span>
                </td>
                <td className={styles.tdRight}>
                  <strong className={styles.costText}>
                    {formatCurrency(doc.totalCost)}
                  </strong>
                </td>
                <td>
                  <span className={styles.authorText}>
                    {doc.responsiblePerson}
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
                    onClick={() => onViewDocument(doc)}
                    title={`Просмотреть списание ${doc.outcomeNumber}`}
                    aria-label={`Просмотреть списание ${doc.outcomeNumber}`}
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
