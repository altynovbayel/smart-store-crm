import { useEffect, useRef } from 'react';
import { X, Receipt, CheckCircle2 } from 'lucide-react';
import type { Sale, PaymentMethod } from '../../../types';
import { PAYMENT_METHODS } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import { formatDateTime } from '../../../utils/dateUtils';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';
import styles from './SaleViewModal.module.scss';

export interface SaleViewModalProps {
  isOpen: boolean;
  sale: Sale | null;
  onClose: () => void;
  fallbackFocusSelector?: string;
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

export const SaleViewModal = ({
  isOpen,
  sale,
  onClose,
  fallbackFocusSelector = '[data-add-sale-btn]',
}: SaleViewModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (window.document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = window.document.activeElement;
    }

    window.document.body.classList.add('drawer-open');

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
      restoreFocusWithFallback(
        previousFocusRef.current,
        fallbackFocusSelector
      );
    };
  }, [isOpen, onClose, fallbackFocusSelector]);

  if (!isOpen || !sale) return null;

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sale-view-modal-title"
    >
      <div className={styles.modalDialog} ref={modalRef}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerTitleWrapper}>
            <div className={styles.headerIcon} aria-hidden="true">
              <Receipt size={22} />
            </div>
            <div>
              <h2 id="sale-view-modal-title" className={styles.modalTitle}>
                Кассовый чек {sale.receiptNumber}
              </h2>
              <p className={styles.modalSubtitle}>
                Оформлен {formatDateTime(sale.soldAt)}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Закрыть окно просмотра чека"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>
          {/* Metadata Grid */}
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Дата и время</span>
              <span className={styles.infoValue}>
                {formatDateTime(sale.soldAt)}
              </span>
            </div>

            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Способ оплаты</span>
              <span className={getPaymentBadgeClass(sale.paymentMethod)}>
                {PAYMENT_METHODS[sale.paymentMethod]}
              </span>
            </div>

            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Ответственный</span>
              <span className={styles.infoValue}>
                {sale.responsiblePerson}
              </span>
            </div>

            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Статус</span>
              <span className={styles.statusBadge}>
                <CheckCircle2 size={12} />
                <span>{sale.statusLabel || 'Завершено'}</span>
              </span>
            </div>

            {sale.paymentMethod === 'cash' && (
              <>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Получено от покупателя</span>
                  <span className={styles.infoValue}>
                    {sale.receivedAmount !== undefined
                      ? formatCurrency(sale.receivedAmount)
                      : '—'}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Сдача</span>
                  <span className={styles.infoValue} style={{ color: '#15803d' }}>
                    {sale.changeAmount !== undefined
                      ? formatCurrency(sale.changeAmount)
                      : '0 сом'}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Comment */}
          {sale.comment && (
            <div className={styles.commentBox}>
              <strong>Примечание:</strong> {sale.comment}
            </div>
          )}

          {/* Items Table */}
          <div>
            <h3 className={styles.sectionTitle}>
              Позиции чека ({sale.items.length})
            </h3>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Наименование товара</th>
                    <th>Артикул</th>
                    <th className={styles.thRight}>Кол-во</th>
                    <th className={styles.thRight}>Цена за ед.</th>
                    <th className={styles.thRight}>Скидка</th>
                    <th className={styles.thRight}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((item, idx) => (
                    <tr key={item.id}>
                      <td>{idx + 1}</td>
                      <td>
                        <strong>{item.productName}</strong>
                      </td>
                      <td>{item.sku}</td>
                      <td className={styles.tdRight}>
                        {formatNumber(item.quantity)} шт.
                      </td>
                      <td className={styles.tdRight}>
                        {formatCurrency(item.unitPrice)}
                      </td>
                      <td className={styles.tdRight}>
                        {item.discountAmount > 0
                          ? `-${formatCurrency(item.discountAmount)}`
                          : '—'}
                      </td>
                      <td className={styles.tdRight}>
                        <strong>{formatCurrency(item.finalAmount)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Box */}
          <div className={styles.summaryBox}>
            <div className={styles.summaryRow}>
              <span>Сумма без скидок:</span>
              <span>{formatCurrency(sale.subtotal)}</span>
            </div>
            {sale.itemDiscountTotal > 0 && (
              <div className={styles.summaryRow}>
                <span>Скидки по строкам:</span>
                <span style={{ color: '#dc2626' }}>
                  -{formatCurrency(sale.itemDiscountTotal)}
                </span>
              </div>
            )}
            {sale.receiptDiscountAmount > 0 && (
              <div className={styles.summaryRow}>
                <span>Скидка на чек ({sale.receiptDiscountType === 'percent' ? `${sale.receiptDiscountValue}%` : 'фикс.'}):</span>
                <span style={{ color: '#dc2626' }}>
                  -{formatCurrency(sale.receiptDiscountAmount)}
                </span>
              </div>
            )}
            <div className={styles.summaryTotalRow}>
              <span>Итого к оплате:</span>
              <span className={styles.totalHighlight}>
                {formatCurrency(sale.totalAmount)}
              </span>
            </div>
            <div className={styles.summaryRow} style={{ marginTop: 4 }}>
              <span>Себестоимость товаров:</span>
              <span>{formatCurrency(sale.costAmount)}</span>
            </div>
            <div className={styles.summaryProfitRow}>
              <span>Расчетная прибыль:</span>
              <span>{formatCurrency(sale.profitAmount)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.closeFooterBtn}
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
