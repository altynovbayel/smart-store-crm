import { useEffect, useRef } from 'react';
import { Archive, AlertTriangle, X } from 'lucide-react';
import type { Product } from '../../../types';
import { restoreFocusWithFallback, getFocusableElements } from '../../../utils/focusUtils';
import styles from './ArchiveProductModal.module.scss';

export interface ArchiveProductModalProps {
  isOpen: boolean;
  product: Product | null;
  isSubmitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (product: Product) => Promise<void> | void;
}

export const ArchiveProductModal = ({
  isOpen,
  product,
  isSubmitting = false,
  error = null,
  onClose,
  onConfirm,
}: ArchiveProductModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isSubmittingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  // When an error appears after submission, restore focus inside the modal to the cancel button
  useEffect(() => {
    if (error && !isSubmitting) {
      requestAnimationFrame(() => {
        const cancelBtn = modalRef.current?.querySelector<HTMLButtonElement>(
          `.${styles.cancelBtn}`
        );
        cancelBtn?.focus();
      });
    }
  }, [error, isSubmitting]);

  useEffect(() => {
    isMountedRef.current = true;
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
        if (!isSubmittingRef.current) {
          onClose();
        }
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

        // If focus is currently on the modal card itself or outside
        if (
          document.activeElement === modalRef.current ||
          !modalRef.current.contains(document.activeElement)
        ) {
          e.preventDefault();
          if (e.shiftKey) {
            last.focus();
          } else {
            first.focus();
          }
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
      isMountedRef.current = false;
      document.body.classList.remove('drawer-open');
      window.removeEventListener('keydown', handleKeyDown);

      // Reliable cleanup focus restoration
      restoreFocusWithFallback(previousFocusRef.current);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !product) return null;

  const hasRemainingStock = product.stock > 0;

  return (
    <div
      className={styles.modalOverlay}
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className={styles.modalCard}
        ref={modalRef}
        tabIndex={-1}
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

            {error && (
              <div role="alert" className={styles.stockAlertBox} style={{ borderColor: '#ef4444', color: '#dc2626' }}>
                <strong>Ошибка архивации</strong>
                <span>{error}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isSubmitting}
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
            disabled={isSubmitting}
          >
            {hasRemainingStock ? 'Понятно, закрыть' : 'Отмена'}
          </button>
          {!hasRemainingStock && (
            <button
              type="button"
              className={styles.archiveBtn}
              disabled={isSubmitting}
              onClick={async () => {
                await onConfirm(product);
              }}
            >
              {isSubmitting ? 'Архивация...' : 'Архивировать товар'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
