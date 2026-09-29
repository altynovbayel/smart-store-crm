import { useEffect, useRef } from 'react';
import { X, ArrowDownRight, ArrowUpRight, History, PackageX } from 'lucide-react';
import type { Product, WarehouseMovement } from '../../../types';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';
import styles from './ProductMovementsModal.module.scss';

export interface ProductMovementsModalProps {
  isOpen: boolean;
  product: Product | null;
  movements: WarehouseMovement[];
  onClose: () => void;
}

export const ProductMovementsModal = ({
  isOpen,
  product,
  movements,
  onClose,
}: ProductMovementsModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    document.body.classList.add('drawer-open');

    // Immediate focus without setTimeout
    const closeBtn = modalRef.current?.querySelector<HTMLButtonElement>(
      `.${styles.closeBtn}`
    );
    closeBtn?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

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

      // Reliable cleanup focus restoration
      restoreFocusWithFallback(previousFocusRef.current);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !product) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalCard}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="movements-title"
      >
        <header className={styles.modalHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.iconCircle} aria-hidden="true">
              <History size={18} />
            </div>
            <div>
              <h2 id="movements-title" className={styles.modalTitle}>
                Движения товара
              </h2>
              <span className={styles.productSub}>
                {product.name} ({product.sku})
              </span>
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

        <div className={styles.content}>
          <div className={styles.stockSummaryBar}>
            <div className={styles.sumItem}>
              <span className={styles.sumLabel}>Текущий остаток:</span>
              <strong className={styles.sumVal}>
                {product.stock} {product.unit}
              </strong>
            </div>
            <div className={styles.sumItem}>
              <span className={styles.sumLabel}>Мин. порог:</span>
              <strong className={styles.sumVal}>
                {product.minStockThreshold} {product.unit}
              </strong>
            </div>
          </div>

          {movements.length === 0 ? (
            <div className={styles.emptyMovements}>
              <PackageX size={32} className={styles.emptyMovIcon} />
              <p className={styles.emptyMovTitle}>История движений пуста</p>
              <span className={styles.emptyMovSubtitle}>
                По данному товару ещё не зафиксировано операций прихода, расхода или инвентаризации.
              </span>
            </div>
          ) : (
            <div className={styles.movementsList}>
              {movements.map((mov) => {
                const isPositive = mov.quantity > 0;
                return (
                  <div key={mov.id} className={styles.movementItem}>
                    <div
                      className={`${styles.movIcon} ${
                        isPositive ? styles.movPositive : styles.movNegative
                      }`}
                    >
                      {isPositive ? (
                        <ArrowUpRight size={16} />
                      ) : (
                        <ArrowDownRight size={16} />
                      )}
                    </div>

                    <div className={styles.movDetails}>
                      <div className={styles.movTopRow}>
                        <strong className={styles.movDoc}>{mov.documentNumber}</strong>
                        <span className={styles.movTypeBadge}>{mov.typeLabel}</span>
                        <time className={styles.movTime}>{mov.createdAt}</time>
                      </div>
                      {mov.reason && <p className={styles.movReason}>{mov.reason}</p>}
                      <span className={styles.movAuthor}>Ответственный: {mov.author}</span>
                    </div>

                    <div
                      className={`${styles.movQty} ${
                        isPositive ? styles.qtyPositive : styles.qtyNegative
                      }`}
                    >
                      {isPositive ? `+${mov.quantity}` : mov.quantity} {mov.unit}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className={styles.modalFooter}>
          <button type="button" className={styles.closeActionBtn} onClick={onClose}>
            Закрыть
          </button>
        </footer>
      </div>
    </div>
  );
};
