import { useState, useEffect, useRef, type FormEvent } from 'react';
import { X, Plus, AlertCircle, ArrowUpFromLine } from 'lucide-react';
import type {
  Product,
  OutcomeFormData,
  OutcomeFormItemState,
  OutcomeReason,
} from '../../../types';
import { OUTCOME_REASONS } from '../../../types';
import { getCurrentLocalDatetime } from '../../../utils/dateUtils';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';
import {
  calculateOutcomeTotals,
  validateOutcomeForm,
} from '../../../utils/outcomeCalculations';
import { OutcomeFormItemRow } from './OutcomeFormItemRow';
import styles from './OutcomeFormModal.module.scss';

export interface OutcomeFormModalProps {
  isOpen: boolean;
  activeProducts: Product[];
  onClose: () => void;
  onSubmit: (data: OutcomeFormData) => { success: boolean; error?: string };
}

export const OutcomeFormModal = ({
  isOpen,
  activeProducts,
  onClose,
  onSubmit,
}: OutcomeFormModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [reason, setReason] = useState<OutcomeReason>('damaged');
  const [documentDate, setDocumentDate] = useState(() => getCurrentLocalDatetime());
  const [responsiblePerson, setResponsiblePerson] = useState('Администратор');
  const [comment, setComment] = useState('');

  // Initial single item with first product having stock > 0
  const [items, setItems] = useState<OutcomeFormItemState[]>(() => {
    const firstAvailable = activeProducts.find((p) => p.stock > 0) ?? activeProducts[0];
    return [
      {
        id: 'row-1',
        productId: firstAvailable ? firstAvailable.id : '',
        rawQuantity: '1',
      },
    ];
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const rafRef = useRef<number | null>(null);

  // Focus trap, Escape listener, background scroll lock, cleanup focus restoration
  useEffect(() => {
    if (!isOpen) return;

    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    document.body.classList.add('drawer-open');

    // Focus first input if focus is not already inside the modal
    const isFocusInside = modalRef.current?.contains(document.activeElement);
    if (!isFocusInside) {
      const reasonSelect = modalRef.current?.querySelector<HTMLSelectElement>('#out-reason');
      reasonSelect?.focus();
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
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      document.body.classList.remove('drawer-open');
      window.removeEventListener('keydown', handleKeyDown);
      restoreFocusWithFallback(previousFocusRef.current, '[data-add-outcome-btn]');
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Add line item
  const handleAddItem = () => {
    // Pick the first product with stock > 0 that is not already chosen in items
    const selectedIds = new Set(items.map((it) => it.productId));
    const available =
      activeProducts.find((p) => !selectedIds.has(p.id) && p.stock > 0) ??
      activeProducts.find((p) => !selectedIds.has(p.id)) ??
      activeProducts[0];

    setItems((prev) => [
      ...prev,
      {
        id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        productId: available ? available.id : '',
        rawQuantity: '1',
      },
    ]);
  };

  // Remove line item and retain accessible focus
  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) return;
    const targetIndex = items.findIndex((it) => it.id === id);
    setItems((prev) => prev.filter((it) => it.id !== id));

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!modalRef.current) return;
      const remainingRows = modalRef.current.querySelectorAll<HTMLElement>(
        `.${styles.itemRow}`
      );

      if (remainingRows.length > 0) {
        // Focus the row at the same index, or the previous row if the last row was removed
        const newIndex = Math.min(targetIndex, remainingRows.length - 1);
        const targetRow = remainingRows[newIndex];
        const deleteBtn = targetRow.querySelector<HTMLElement>(
          `.${styles.deleteRowBtn}:not(:disabled)`
        );
        const anyInput = targetRow.querySelector<HTMLElement>(
          'input:not(:disabled), select:not(:disabled)'
        );
        (deleteBtn ?? anyInput ?? targetRow)?.focus();
      } else {
        const addItemBtn = modalRef.current.querySelector<HTMLElement>(
          `.${styles.addItemBtn}`
        );
        addItemBtn?.focus();
      }
    });
  };

  // Update item field
  const handleItemProductChange = (rowId: string, newProductId: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== rowId) return it;
        return {
          ...it,
          productId: newProductId,
        };
      })
    );
  };

  const handleItemQuantityChange = (rowId: string, val: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== rowId) return it;
        return {
          ...it,
          rawQuantity: val,
        };
      })
    );
  };

  // Computed live totals for preview
  const liveTotals = calculateOutcomeTotals(items, activeProducts);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const result = validateOutcomeForm(
      reason,
      documentDate,
      responsiblePerson,
      comment,
      items,
      activeProducts
    );

    if (result.isValid && result.data) {
      setIsSubmitting(true);
      const res = onSubmit(result.data);
      if (res.success) {
        onClose();
      } else {
        setIsSubmitting(false);
        setErrors((prev) => ({
          ...prev,
          general: res.error || 'Ошибка при проведении списания',
        }));
      }
    } else {
      setErrors(result.errors);
      // Focus first element with aria-invalid="true" after state update
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const firstInvalid = modalRef.current?.querySelector<HTMLElement>(
          '[aria-invalid="true"]'
        );
        firstInvalid?.focus();
      });
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalCard}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-outcome-title"
      >
        {/* Header */}
        <header className={styles.modalHeader}>
          <div className={styles.titleGroup}>
            <div className={styles.iconCircle} aria-hidden="true">
              <ArrowUpFromLine size={20} />
            </div>
            <div>
              <h2 id="new-outcome-title" className={styles.modalTitle}>
                Новое списание товара
              </h2>
              <p className={styles.modalSubtitle}>
                Списание повреждённых, бракованных товаров или товаров на нужды магазина
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.modalBody}>
            {/* General form error if any */}
            {errors.general && (
              <div className={styles.generalAlert} role="alert">
                <AlertCircle size={16} />
                <span>{errors.general}</span>
              </div>
            )}

            {/* Document Details Grid */}
            <div className={styles.fieldsGrid}>
              {/* Причина списания */}
              <div className={styles.formGroup}>
                <label htmlFor="out-reason" className={styles.label}>
                  Причина списания <span className={styles.required}>*</span>
                </label>
                <select
                  id="out-reason"
                  className={styles.select}
                  value={reason}
                  onChange={(e) => setReason(e.target.value as OutcomeReason)}
                  aria-invalid={errors.reason ? 'true' : undefined}
                  aria-describedby={errors.reason ? 'out-reason-error' : undefined}
                >
                  {(Object.keys(OUTCOME_REASONS) as OutcomeReason[]).map((r) => (
                    <option key={r} value={r}>
                      {OUTCOME_REASONS[r]}
                    </option>
                  ))}
                </select>
                {errors.reason && (
                  <span id="out-reason-error" className={styles.errorText} role="alert">
                    {errors.reason}
                  </span>
                )}
              </div>

              {/* Дата и время списания */}
              <div className={styles.formGroup}>
                <label htmlFor="out-date" className={styles.label}>
                  Дата и время списания <span className={styles.required}>*</span>
                </label>
                <input
                  id="out-date"
                  type="datetime-local"
                  className={styles.input}
                  value={documentDate}
                  onChange={(e) => setDocumentDate(e.target.value)}
                  aria-invalid={errors.documentDate ? 'true' : undefined}
                  aria-describedby={errors.documentDate ? 'out-date-error' : undefined}
                />
                {errors.documentDate && (
                  <span id="out-date-error" className={styles.errorText} role="alert">
                    {errors.documentDate}
                  </span>
                )}
              </div>

              {/* Ответственный */}
              <div className={styles.formGroup}>
                <label htmlFor="out-responsible" className={styles.label}>
                  Ответственный сотрудник <span className={styles.required}>*</span>
                </label>
                <input
                  id="out-responsible"
                  type="text"
                  className={styles.input}
                  value={responsiblePerson}
                  onChange={(e) => setResponsiblePerson(e.target.value)}
                  aria-invalid={errors.responsiblePerson ? 'true' : undefined}
                  aria-describedby={errors.responsiblePerson ? 'out-resp-error' : undefined}
                />
                {errors.responsiblePerson && (
                  <span id="out-resp-error" className={styles.errorText} role="alert">
                    {errors.responsiblePerson}
                  </span>
                )}
              </div>

              {/* Примечание / комментарий */}
              <div className={styles.formGroup}>
                <label htmlFor="out-comment" className={styles.label}>
                  Комментарий {reason === 'other' && <span className={styles.required}>*</span>}
                </label>
                <textarea
                  id="out-comment"
                  rows={2}
                  className={styles.textarea}
                  placeholder={
                    reason === 'other'
                      ? 'Опишите причину списания подробно (обязательно)...'
                      : 'Дополнительные сведения, причина списания или номер акта...'
                  }
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  aria-invalid={errors.comment ? 'true' : undefined}
                  aria-describedby={errors.comment ? 'out-comment-error' : undefined}
                />
                {errors.comment && (
                  <span id="out-comment-error" className={styles.errorText} role="alert">
                    {errors.comment}
                  </span>
                )}
              </div>
            </div>

            {/* Line Items Section */}
            <div className={styles.itemsSection}>
              <div className={styles.itemsHeader}>
                <h3 className={styles.itemsTitle}>
                  Позиции списания ({items.length})
                </h3>
                <button
                  type="button"
                  className={styles.addItemBtn}
                  onClick={handleAddItem}
                >
                  <Plus size={14} />
                  <span>Добавить товар</span>
                </button>
              </div>

              {errors.itemsGeneral && (
                <span className={styles.errorText} role="alert">
                  {errors.itemsGeneral}
                </span>
              )}

              <div className={styles.itemsList}>
                {items.map((item, idx) => {
                  const selectedProduct = activeProducts.find(
                    (p) => p.id === item.productId
                  );
                  return (
                    <OutcomeFormItemRow
                      key={item.id}
                      index={idx}
                      item={item}
                      activeProducts={activeProducts}
                      selectedProduct={selectedProduct}
                      allItems={items}
                      errors={errors}
                      isOnlyRow={items.length <= 1}
                      onProductChange={handleItemProductChange}
                      onQuantityChange={handleItemQuantityChange}
                      onRemove={handleRemoveItem}
                    />
                  );
                })}
              </div>
            </div>

            {/* Summary card before conducting */}
            <div className={styles.summaryCard}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Всего позиций:</span>
                <strong className={styles.summaryValue}>{items.length}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Всего единиц к списанию:</span>
                <strong className={styles.summaryValue}>
                  {formatNumber(liveTotals.totalUnits)} шт.
                </strong>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Общая себестоимость:</span>
                <strong
                  className={
                    liveTotals.isOverflow
                      ? styles.summaryTotalOverflow
                      : styles.summaryTotalAmount
                  }
                >
                  {liveTotals.isOverflow
                    ? 'Превышен предел сумм'
                    : formatCurrency(liveTotals.totalCost)}
                </strong>
              </div>
            </div>
          </div>

          {/* Footer buttons */}
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
              {isSubmitting ? 'Проведение...' : 'Провести списание'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};
