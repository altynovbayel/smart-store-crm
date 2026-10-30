import { useEffect, useRef } from 'react';
import { ArchiveRestore, X } from 'lucide-react';
import type { WarehouseCatalogProduct } from '../../../types';
import { restoreFocusWithFallback, getFocusableElements } from '../../../utils/focusUtils';
import baseStyles from '../ArchiveProductModal/ArchiveProductModal.module.scss';
import styles from './RestoreProductModal.module.scss';

export interface RestoreProductModalProps {
  isOpen: boolean;
  product: WarehouseCatalogProduct | null;
  isSubmitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (product: WarehouseCatalogProduct) => Promise<void> | void;
}

/**
 * Confirmation dialog for restoring an archived product (same layout and focus handling as
 * ArchiveProductModal): focus trap, Escape closes unless submitting, focus returns on close.
 */
export const RestoreProductModal = ({
  isOpen,
  product,
  isSubmitting = false,
  error = null,
  onClose,
  onConfirm,
}: RestoreProductModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isSubmittingRef = useRef<boolean>(false);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  // When an error appears after submission, move focus back to the cancel button
  useEffect(() => {
    if (error && !isSubmitting) {
      requestAnimationFrame(() => cancelBtnRef.current?.focus());
    }
  }, [error, isSubmitting]);

  useEffect(() => {
    if (!isOpen) return;

    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    document.body.classList.add('drawer-open');
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isSubmittingRef.current) onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = getFocusableElements(modalRef.current);
        if (focusable.length === 0) {
          e.preventDefault();
          modalRef.current.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (
          document.activeElement === modalRef.current ||
          !modalRef.current.contains(document.activeElement)
        ) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
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
      // The row of a restored product is gone: falls back to the warehouse search field
      restoreFocusWithFallback(previousFocusRef.current, '[data-warehouse-search]');
    };
  }, [isOpen, onClose]);

  if (!isOpen || !product) return null;

  return (
    <div
      className={baseStyles.modalOverlay}
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className={baseStyles.modalCard}
        ref={modalRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-dialog-title"
        aria-describedby="restore-dialog-description"
      >
        <div className={baseStyles.content}>
          <div className={`${baseStyles.iconBox} ${styles.iconRestore}`} aria-hidden="true">
            <ArchiveRestore size={24} />
          </div>

          <div className={baseStyles.textGroup}>
            <h2 id="restore-dialog-title" className={baseStyles.title}>
              Восстановление товара
            </h2>
            <p id="restore-dialog-description" className={baseStyles.description}>
              Восстановить товар{' '}
              <strong className={baseStyles.productName}>“{product.name}”</strong>? Он снова
              появится в каталоге и станет доступен для операций.
            </p>

            {error && (
              <div role="alert" className={styles.errorBox}>
                <strong>Ошибка восстановления</strong>
                <span>{error}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className={baseStyles.closeBtn}
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Закрыть окно"
          >
            <X size={18} />
          </button>
        </div>

        <div className={baseStyles.footer}>
          <button
            ref={cancelBtnRef}
            type="button"
            className={baseStyles.cancelBtn}
            onClick={onClose}
            disabled={isSubmitting}
          >
            Отмена
          </button>
          <button
            type="button"
            className={styles.restoreBtn}
            disabled={isSubmitting}
            onClick={async () => {
              await onConfirm(product);
            }}
          >
            {isSubmitting ? 'Восстановление...' : 'Восстановить'}
          </button>
        </div>
      </div>
    </div>
  );
};
