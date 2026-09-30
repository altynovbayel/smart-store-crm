import { useEffect, useRef } from 'react';
import { X, FileText, CheckCircle2 } from 'lucide-react';
import type { IncomeReceipt } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import { formatDateTime } from '../../../utils/dateUtils';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';
import styles from './IncomeViewModal.module.scss';

export interface IncomeViewModalProps {
  isOpen: boolean;
  receipt: IncomeReceipt | null;
  onClose: () => void;
}

export const IncomeViewModal = ({
  isOpen,
  receipt,
  onClose,
}: IncomeViewModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    document.body.classList.add('drawer-open');

    // Focus close button if focus is not already inside the modal
    const isFocusInside = modalRef.current?.contains(document.activeElement);
    if (!isFocusInside) {
      const closeBtn = modalRef.current?.querySelector<HTMLButtonElement>(
        `.${styles.closeBtn}`
      );
      closeBtn?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        // If focus escaped the dialog container, pull it back in
        if (!modalRef.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
          return;
        }

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.classList.remove('drawer-open');
      window.removeEventListener('keydown', handleKeyDown);
      restoreFocusWithFallback(previousFocusRef.current, '[data-add-income-btn]');
    };
  }, [isOpen, onClose]);

  if (!isOpen || !receipt) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalCard}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-receipt-title"
      >
        {/* Header */}
        <header className={styles.modalHeader}>
          <div className={styles.titleGroup}>
            <div className={styles.iconCircle} aria-hidden="true">
              <FileText size={20} />
            </div>
            <div>
              <div className={styles.headerTop}>
                <h2 id="view-receipt-title" className={styles.modalTitle}>
                  Приходная накладная {receipt.receiptNumber}
                </h2>
                <span className={styles.statusBadge}>
                  <CheckCircle2 size={12} />
                  <span>Проведён</span>
                </span>
              </div>
              <p className={styles.modalSubtitle}>
                Поступление от {formatDateTime(receipt.receivedAt)}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Закрыть окно"
          >
            <X size={20} />
          </button>
        </header>

        {/* Modal Body */}
        <div className={styles.modalBody}>
          {/* Metadata Card */}
          <div className={styles.metaCard}>
            <div className={styles.metaGrid}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Поставщик</span>
                <strong className={styles.metaValue}>{receipt.supplier}</strong>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Документ поставщика</span>
                <strong className={styles.metaValue}>
                  {receipt.documentNumber || '—'}
                </strong>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Дата поступления</span>
                <strong className={styles.metaValue}>
                  {formatDateTime(receipt.receivedAt)}
                </strong>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Ответственный</span>
                <strong className={styles.metaValue}>
                  {receipt.responsiblePerson}
                </strong>
              </div>
            </div>

            {receipt.comment && (
              <div className={styles.commentBox}>
                <span className={styles.commentLabel}>Примечание:</span>
                <p className={styles.commentText}>{receipt.comment}</p>
              </div>
            )}
          </div>

          {/* Items Section */}
          <div className={styles.itemsSection}>
            <h3 className={styles.itemsSectionTitle}>
              Список поступивших товаров ({receipt.items.length})
            </h3>

            <div className={styles.tableResponsiveWrapper}>
              <table className={styles.itemsTable}>
                <thead>
                  <tr>
                    <th className={styles.thNum}>№</th>
                    <th>Наименование и артикул</th>
                    <th className={styles.thRight}>Количество</th>
                    <th className={styles.thRight}>Закупочная цена</th>
                    <th className={styles.thRight}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((item, idx) => (
                    <tr key={item.id}>
                      <td className={styles.tdNum}>{idx + 1}</td>
                      <td>
                        <div className={styles.productCell}>
                          <span className={styles.productName}>
                            {item.productName}
                          </span>
                          <span className={styles.productSku}>{item.sku}</span>
                        </div>
                      </td>
                      <td className={styles.tdRight}>
                        <span className={styles.quantityVal}>
                          {formatNumber(item.quantity)} шт.
                        </span>
                      </td>
                      <td className={styles.tdRight}>
                        <span className={styles.priceVal}>
                          {formatCurrency(item.purchasePrice)}
                        </span>
                      </td>
                      <td className={styles.tdRight}>
                        <strong className={styles.itemTotalVal}>
                          {formatCurrency(item.totalAmount)}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Banner */}
          <div className={styles.summaryBar}>
            <div className={styles.summaryCol}>
              <span className={styles.summaryLabel}>Всего позиций:</span>
              <strong className={styles.summaryVal}>
                {receipt.items.length}
              </strong>
            </div>
            <div className={styles.summaryCol}>
              <span className={styles.summaryLabel}>Всего единиц:</span>
              <strong className={styles.summaryVal}>
                {formatNumber(receipt.totalQuantity)} шт.
              </strong>
            </div>
            <div className={styles.summaryCol}>
              <span className={styles.summaryLabel}>Общая сумма накладной:</span>
              <strong className={styles.summaryTotalVal}>
                {formatCurrency(receipt.totalAmount)}
              </strong>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className={styles.modalFooter}>
          <button
            type="button"
            className={styles.closeActionBtn}
            onClick={onClose}
          >
            Закрыть
          </button>
        </footer>
      </div>
    </div>
  );
};
