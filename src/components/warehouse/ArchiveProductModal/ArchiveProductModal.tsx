import { useEffect, useRef } from 'react';
import { Archive, AlertTriangle, X } from 'lucide-react';
import type { Product } from '../../../types';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';
import styles from './ArchiveProductModal.module.scss';

export interface ArchiveProductModalProps {
  isOpen: boolean;
  product: Product | null;
  onClose: () => void;
  onConfirm: (product: Product) => void;
}

export const ArchiveProductModal = ({
  isOpen,
  product,
  onClose,
  onConfirm,
}: ArchiveProductModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    document.body.classList.add('drawer-open');

    // Immediate focus without setTimeout
    const cancelBtn = modalRef.current?.querySelector<HTMLButtonElement>(
      `.${styles.cancelBtn}`
    );
    cancelBtn?.focus();

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

  const hasRemainingStock = product.stock > 0;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalCard}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-dialog-title"
      >
        <div className={styles.content}>
          <div
            className={`${styles.iconBox} ${
              hasRemainingStock ? styles.iconWarn : styles.iconArchive
            }`}
            aria-hidden="true"
          >
            {hasRemainingStock ? (
              <AlertTriangle size={24} />
            ) : (
              <Archive size={24} />
            )}
          </div>

          <div className={styles.textGroup}>
            <h2 id="archive-dialog-title" className={styles.title}>
              {hasRemainingStock ? 'Невозможно архивировать' : 'Архивировать товар?'}
            </h2>

            {hasRemainingStock ? (
              <>
                <p className={styles.description}>
                  Товар <strong className={styles.productName}>«{product.name}»</strong> ({product.sku}) нельзя архивировать, так как на складе числится положительный остаток:
                </p>
                <div className={styles.stockAlertBox}>
                  <strong>Остаток на складе: {product.stock} {product.unit}</strong>
                  <span>Перед архивацией необходимо сначала оформить списание или расход остатка до 0.</span>
                </div>
              </>
            ) : (
              <p className={styles.description}>
                Вы действительно хотите архивировать товар{' '}
                <strong className={styles.productName}>«{product.name}»</strong> ({product.sku})? Позиция будет скрыта из основного списка склада, но история операций и движения сохранятся.
              </p>
            )}
          </div>

          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Закрыть окно"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
          >
            {hasRemainingStock ? 'Понятно, закрыть' : 'Отмена'}
          </button>
          {!hasRemainingStock && (
            <button
              type="button"
              className={styles.archiveBtn}
              onClick={() => {
                onConfirm(product);
                onClose();
              }}
            >
              Архивировать товар
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
