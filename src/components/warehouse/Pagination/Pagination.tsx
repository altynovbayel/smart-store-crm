import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber } from '../../../utils/formatUtils';
import styles from './Pagination.module.scss';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}

export const Pagination = ({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  itemLabel = 'товаров',
}: PaginationProps) => {
  if (totalItems === 0 || totalPages <= 1) {
    return null;
  }

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // Generate page numbers with ellipsis
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);

      if (currentPage > 3) {
        pages.push('ellipsis');
      }

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push('ellipsis');
      }

      pages.push(totalPages);
    }

    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div className={styles.paginationContainer} aria-label="Пагинация таблицы">
      <div className={styles.infoText}>
        Показано {startItem}–{endItem} из {formatNumber(totalItems)} {itemLabel}
      </div>

      <div className={styles.controls}>
        {/* Previous Button */}
        <button
          type="button"
          className={styles.navBtn}
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Предыдущая страница"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Page numbers */}
        {pages.map((p, index) => {
          if (p === 'ellipsis') {
            return (
              <span key={`ellipsis-${index}`} className={styles.ellipsis}>
                ...
              </span>
            );
          }
          const isCurrent = p === currentPage;
          return (
            <button
              key={p}
              type="button"
              className={`${styles.pageBtn} ${isCurrent ? styles.activePageBtn : ''}`}
              onClick={() => onPageChange(p)}
              aria-current={isCurrent ? 'page' : undefined}
            >
              {p}
            </button>
          );
        })}

        {/* Next Button */}
        <button
          type="button"
          className={styles.navBtn}
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Следующая страница"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};
