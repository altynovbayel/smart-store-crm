import { useEffect, useRef } from 'react';
import { X, FileText, CheckCircle2 } from 'lucide-react';
import type { OutcomeDocument, OutcomeReason } from '../../../types';
import { OUTCOME_REASONS } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import { formatDateTime } from '../../../utils/dateUtils';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';
import styles from './OutcomeViewModal.module.scss';

export interface OutcomeViewModalProps {
  isOpen: boolean;
  document: OutcomeDocument | null;
  onClose: () => void;
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

export const OutcomeViewModal = ({
  isOpen,
  document: doc,
  onClose,
}: OutcomeViewModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (window.document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = window.document.activeElement;
    }

    window.document.body.classList.add('drawer-open');

    // Focus close button if focus is not already inside the modal
    const isFocusInside = modalRef.current?.contains(window.document.activeElement);
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
        if (!modalRef.current.contains(window.document.activeElement)) {
          e.preventDefault();
          first.focus();
          return;
        }

        if (e.shiftKey && window.document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && window.document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.document.body.classList.remove('drawer-open');
      window.removeEventListener('keydown', handleKeyDown);
      restoreFocusWithFallback(previousFocusRef.current, '[data-add-outcome-btn]');
    };
  }, [isOpen, onClose]);

  if (!isOpen || !doc) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalCard}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-outcome-title"
      >
        {/* Header */}
        <header className={styles.modalHeader}>
          <div className={styles.titleGroup}>
            <div className={styles.iconCircle} aria-hidden="true">
              <FileText size={20} />
            </div>
            <div>
              <div className={styles.headerTop}>
                <h2 id="view-outcome-title" className={styles.modalTitle}>
                  Акт списания {doc.outcomeNumber}
                </h2>
                <span className={styles.statusBadge}>
                  <CheckCircle2 size={12} />
                  <span>Проведён</span>
                </span>
              </div>
              <p className={styles.modalSubtitle}>
                Списание от {formatDateTime(doc.documentDate)}
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
                <span className={styles.metaLabel}>Причина списания</span>
                <span className={getReasonBadgeClass(doc.reason)}>
                  {OUTCOME_REASONS[doc.reason]}
                </span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Дата списания</span>
                <strong className={styles.metaValue}>
                  {formatDateTime(doc.documentDate)}
                </strong>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Ответственный сотрудник</span>
                <strong className={styles.metaValue}>
                  {doc.responsiblePerson}
                </strong>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Дата проведения в системе</span>
                <strong className={styles.metaValue}>
                  {formatDateTime(doc.createdAt)}
                </strong>
              </div>
            </div>

            {doc.comment && (
              <div className={styles.commentBox}>
                <span className={styles.commentLabel}>Комментарий:</span>
                <p className={styles.commentText}>{doc.comment}</p>
              </div>
            )}
          </div>

          {/* Items Section */}
          <div className={styles.itemsSection}>
            <h3 className={styles.itemsSectionTitle}>
              Списанные товары ({doc.items.length})
            </h3>

            <div className={styles.tableResponsiveWrapper}>
              <table className={styles.itemsTable}>
                <thead>
                  <tr>
                    <th className={styles.thNum}>№</th>
                    <th>Наименование и артикул</th>
                    <th className={styles.thRight}>Количество</th>
                    <th className={styles.thRight}>Себестоимость</th>
                    <th className={styles.thRight}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items.map((item, idx) => (
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
                          {formatCurrency(item.totalCost)}
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
                {doc.items.length}
              </strong>
            </div>
            <div className={styles.summaryCol}>
              <span className={styles.summaryLabel}>Всего единиц:</span>
              <strong className={styles.summaryVal}>
                {formatNumber(doc.totalQuantity)} шт.
              </strong>
            </div>
            <div className={styles.summaryCol}>
              <span className={styles.summaryLabel}>Общая себестоимость:</span>
              <strong className={styles.summaryTotalVal}>
                {formatCurrency(doc.totalCost)}
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
