import { useState, useEffect, useRef, type FormEvent } from 'react';
import { X, SlidersHorizontal, AlertCircle } from 'lucide-react';
import type { Product } from '../../../types';
import { restoreFocusWithFallback, getFocusableElements } from '../../../utils/focusUtils';
import styles from './AdjustStockModal.module.scss';

export interface AdjustStockModalProps {
  isOpen: boolean;
  product: Product | null;
  onClose: () => void;
  onSubmit: (params: {
    productId: string;
    newStock: number;
    reason: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

export const AdjustStockModal = ({
  isOpen,
  product,
  onClose,
  onSubmit,
}: AdjustStockModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isSubmittingRef = useRef<boolean>(false);

  const [newStock, setNewStock] = useState<string>(() =>
    product ? String(product.stock) : ''
  );
  const [reason, setReason] = useState<string>('');
  const [errors, setErrors] = useState<{ stock?: string; reason?: string; general?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  // Accessibility: focus trap, Esc key, restoration
  useEffect(() => {
    isMountedRef.current = true;
    if (!isOpen) return;

    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    document.body.classList.add('drawer-open');

    // Immediate focus on new stock input
    const stockInput = modalRef.current?.querySelector<HTMLInputElement>('#adjust-stock');
    stockInput?.focus();

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
      restoreFocusWithFallback(previousFocusRef.current);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !product) return null;

  const validate = (): { isValid: boolean; parsedStock?: number; cleanReason?: string } => {
    const nextErrors: { stock?: string; reason?: string; general?: string } = {};

    const trimmedStock = newStock.trim();
    if (!trimmedStock) {
      nextErrors.stock = 'Укажите новый остаток';
    } else if (!/^\d+$/.test(trimmedStock)) {
      nextErrors.stock = 'Введите целое неотрицательное число';
    } else {
      const num = Number(trimmedStock);
      if (!Number.isSafeInteger(num) || num < 0 || num > 100_000_000) {
        nextErrors.stock = 'Остаток должен быть целым числом от 0 до 100 000 000';
      }
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      nextErrors.reason = 'Обязательно укажите причину корректировки';
    } else if (trimmedReason.length < 3) {
      nextErrors.reason = 'Причина должна содержать не менее 3 символов';
    }

    setErrors(nextErrors);

    if (nextErrors.stock || nextErrors.reason) {
      return { isValid: false };
    }

    return {
      isValid: true,
      parsedStock: Number(trimmedStock),
      cleanReason: trimmedReason,
    };
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const { isValid, parsedStock, cleanReason } = validate();
    if (!isValid || parsedStock === undefined || !cleanReason) {
      requestAnimationFrame(() => {
        const firstInvalid = modalRef.current?.querySelector<HTMLElement>(
          '[aria-invalid="true"]'
        );
        firstInvalid?.focus();
      });
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const result = await onSubmit({
        productId: product.id,
        newStock: parsedStock,
        reason: cleanReason,
      });

      if (!isMountedRef.current) return;

      if (result.success) {
        onClose();
      } else {
        setErrors({ general: result.error || 'Ошибка при сохранении корректировки остатка' });
        requestAnimationFrame(() => {
          if (isMountedRef.current) {
            modalRef.current?.querySelector<HTMLElement>('#adjust-stock')?.focus();
          }
        });
      }
    } catch {
      if (isMountedRef.current) {
        setErrors({ general: 'Произошла непредвиденная ошибка. Повторите попытку.' });
      }
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

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
        aria-labelledby="adjust-stock-title"
      >
        <header className={styles.modalHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.iconCircle} aria-hidden="true">
              <SlidersHorizontal size={20} />
            </div>
            <div>
              <h2 id="adjust-stock-title" className={styles.modalTitle}>
                Корректировка остатка
              </h2>
              <p className={styles.productSub}>
                {product.name} ({product.sku})
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Закрыть модальное окно"
          >
            <X size={20} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.scrollableContent}>
            {/* Current Stock Banner */}
            <div className={styles.currentStockBox}>
              <span className={styles.currentStockLabel}>Текущий остаток в системе:</span>
              <span className={styles.currentStockValue}>
                {product.stock} {product.unit}
              </span>
            </div>

            {/* General error banner if returned by server */}
            {errors.general && (
              <div role="alert" className={styles.errorBanner}>
                <AlertCircle size={16} />
                <span>{errors.general}</span>
              </div>
            )}

            {/* New Stock Input */}
            <div className={styles.formGroup}>
              <label htmlFor="adjust-stock" className={styles.label}>
                Новый фактический остаток (шт.) <span className={styles.req}>*</span>
              </label>
              <input
                id="adjust-stock"
                type="text"
                inputMode="numeric"
                className={`${styles.input} ${errors.stock ? styles.inputError : ''}`}
                value={newStock}
                disabled={isSubmitting}
                placeholder="0"
                aria-invalid={errors.stock ? 'true' : undefined}
                aria-describedby={errors.stock ? 'adjust-stock-error' : undefined}
                onChange={(e) => setNewStock(e.target.value)}
              />
              {errors.stock && (
                <span id="adjust-stock-error" role="alert" className={styles.errorText}>
                  <AlertCircle size={12} /> {errors.stock}
                </span>
              )}
            </div>

            {/* Reason Textarea */}
            <div className={styles.formGroup}>
              <label htmlFor="adjust-reason" className={styles.label}>
                Причина корректировки <span className={styles.req}>*</span>
              </label>
              <textarea
                id="adjust-reason"
                className={`${styles.textarea} ${errors.reason ? styles.inputError : ''}`}
                value={reason}
                disabled={isSubmitting}
                placeholder="Например: Плановая инвентаризация, пересчет витрины"
                aria-invalid={errors.reason ? 'true' : undefined}
                aria-describedby={errors.reason ? 'adjust-reason-error' : undefined}
                onChange={(e) => setReason(e.target.value)}
              />
              {errors.reason && (
                <span id="adjust-reason-error" role="alert" className={styles.errorText}>
                  <AlertCircle size={12} /> {errors.reason}
                </span>
              )}
            </div>
          </div>

          <footer className={styles.modalFooter}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={isSubmitting}
            >
              Отмена
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Сохранение...' : 'Применить корректировку'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};
