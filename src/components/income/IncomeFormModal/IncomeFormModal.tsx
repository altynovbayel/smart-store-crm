import { useState, useEffect, useRef, type FormEvent } from 'react';
import { X, Plus, AlertCircle, ArrowDownToLine } from 'lucide-react';
import type { Product, IncomeReceiptFormData, FormItemState } from '../../../types';
import { getCurrentLocalDatetime } from '../../../utils/dateUtils';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';
import {
  calculateIncomeTotals,
  MAX_SAFE_PRICE,
  toCents,
} from '../../../utils/incomeCalculations';
import { IncomeFormItemRow } from './IncomeFormItemRow';
import styles from './IncomeFormModal.module.scss';

export interface IncomeFormModalProps {
  isOpen: boolean;
  activeProducts: Product[];
  onClose: () => void;
  onSubmit: (data: IncomeReceiptFormData) => { success: boolean; error?: string };
}

export const IncomeFormModal = ({
  isOpen,
  activeProducts,
  onClose,
  onSubmit,
}: IncomeFormModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [supplier, setSupplier] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => getCurrentLocalDatetime());
  const [responsiblePerson, setResponsiblePerson] = useState('Администратор');
  const [comment, setComment] = useState('');

  // Initial single empty item
  const [items, setItems] = useState<FormItemState[]>(() => {
    const firstProduct = activeProducts[0];
    return [
      {
        id: `row-1`,
        productId: firstProduct ? firstProduct.id : '',
        rawQuantity: '10',
        rawPurchasePrice: firstProduct ? String(firstProduct.purchasePrice) : '',
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
      const supplierInput = modalRef.current?.querySelector<HTMLInputElement>('#inc-supplier');
      supplierInput?.focus();
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
      restoreFocusWithFallback(previousFocusRef.current, '[data-add-income-btn]');
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Add line item
  const handleAddItem = () => {
    // Pick the first product that is not already chosen in items
    const selectedIds = new Set(items.map((it) => it.productId));
    const available = activeProducts.find((p) => !selectedIds.has(p.id)) ?? activeProducts[0];

    setItems((prev) => [
      ...prev,
      {
        id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        productId: available ? available.id : '',
        rawQuantity: '10',
        rawPurchasePrice: available ? String(available.purchasePrice) : '',
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
    const product = activeProducts.find((p) => p.id === newProductId);
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== rowId) return it;
        return {
          ...it,
          productId: newProductId,
          rawPurchasePrice: product ? String(product.purchasePrice) : it.rawPurchasePrice,
        };
      })
    );
  };

  const handleItemFieldChange = (
    rowId: string,
    field: 'rawQuantity' | 'rawPurchasePrice',
    val: string
  ) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== rowId) return it;
        return {
          ...it,
          [field]: val,
        };
      })
    );
  };

  // Computed live totals for preview
  const liveTotals = calculateIncomeTotals(items);

  const validate = (): { isValid: boolean; data?: IncomeReceiptFormData } => {
    const newErrors: Record<string, string> = {};

    const cleanSupplier = supplier.trim();
    if (!cleanSupplier) {
      newErrors.supplier = 'Укажите наименование поставщика';
    }

    if (!receivedAt) {
      newErrors.receivedAt = 'Укажите дату и время прихода';
    }

    if (!responsiblePerson.trim()) {
      newErrors.responsiblePerson = 'Укажите ответственного сотрудника';
    }

    if (items.length === 0) {
      newErrors.itemsGeneral = 'Добавьте хотя бы одну позицию';
    }

    const seenProductIds = new Set<string>();
    const validatedItems: IncomeReceiptFormData['items'] = [];

    items.forEach((it, index) => {
      const rowNum = index + 1;
      if (!it.productId) {
        newErrors[`item-${it.id}-product`] = `Строка ${rowNum}: выберите товар`;
      } else if (seenProductIds.has(it.productId)) {
        newErrors[`item-${it.id}-product`] = `Строка ${rowNum}: товар уже выбран в другой строке`;
      } else {
        seenProductIds.add(it.productId);
      }

      // Quantity validation
      const trimmedQty = it.rawQuantity.trim();
      if (!trimmedQty) {
        newErrors[`item-${it.id}-qty`] = `Строка ${rowNum}: укажите количество`;
      } else if (!/^\d+$/.test(trimmedQty)) {
        newErrors[`item-${it.id}-qty`] = `Строка ${rowNum}: введите целое положительное число`;
      } else {
        const q = Number(trimmedQty);
        if (!Number.isSafeInteger(q) || q <= 0 || q > 1_000_000) {
          newErrors[`item-${it.id}-qty`] = `Строка ${rowNum}: количество от 1 до 1 000 000`;
        } else if (it.productId) {
          const currentProd = activeProducts.find((p) => p.id === it.productId);
          if (currentProd && currentProd.stock + q > 100_000_000) {
            newErrors[`item-${it.id}-qty`] = `Строка ${rowNum}: суммарный остаток превысит лимит 100 000 000`;
          }
        }
      }

      // Price validation
      const trimmedPrice = it.rawPurchasePrice.trim().replace(',', '.');
      if (!trimmedPrice) {
        newErrors[`item-${it.id}-price`] = `Строка ${rowNum}: укажите закупочную цену`;
      } else if (!/^\d+(\.\d{1,2})?$/.test(trimmedPrice)) {
        newErrors[`item-${it.id}-price`] = `Строка ${rowNum}: введите число >= 0 (макс. 2 знака)`;
      } else {
        const p = Number(trimmedPrice);
        if (!Number.isFinite(p) || p < 0 || p > MAX_SAFE_PRICE) {
          newErrors[`item-${it.id}-price`] = `Строка ${rowNum}: цена от 0 до 10 000 000 сом`;
        } else {
          const q = Number(trimmedQty);
          if (Number.isSafeInteger(q) && q > 0 && it.productId) {
            const lineCents = q * toCents(p);
            if (!Number.isSafeInteger(lineCents)) {
              newErrors[`item-${it.id}-price`] = `Строка ${rowNum}: сумма строки превышает допустимый предел`;
            } else {
              validatedItems.push({
                productId: it.productId,
                quantity: q,
                purchasePrice: p,
              });
            }
          }
        }
      }
    });

    // Check total document amount for safe integer bounds
    let docTotalCents = 0;
    for (const it of items) {
      const q = Number(it.rawQuantity.trim());
      const p = Number(it.rawPurchasePrice.trim().replace(',', '.'));
      if (Number.isSafeInteger(q) && q > 0 && Number.isFinite(p) && p >= 0) {
        const lineCents = q * toCents(p);
        if (
          !Number.isSafeInteger(lineCents) ||
          !Number.isSafeInteger(docTotalCents + lineCents)
        ) {
          newErrors.itemsGeneral =
            'Общая сумма накладной превышает допустимый математический предел';
          break;
        }
        docTotalCents += lineCents;
      }
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0 || validatedItems.length !== items.length) {
      return { isValid: false };
    }

    return {
      isValid: true,
      data: {
        supplier: cleanSupplier,
        documentNumber: documentNumber.trim() || undefined,
        receivedAt,
        responsiblePerson: responsiblePerson.trim(),
        comment: comment.trim() || undefined,
        items: validatedItems,
      },
    };
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const result = validate();
    if (result.isValid && result.data) {
      setIsSubmitting(true);
      const res = onSubmit(result.data);
      if (res.success) {
        onClose();
      } else {
        setIsSubmitting(false);
        setErrors((prev) => ({
          ...prev,
          general: res.error || 'Ошибка при проведении накладной',
        }));
      }
    } else {
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
        aria-labelledby="new-income-title"
      >
        {/* Header */}
        <header className={styles.modalHeader}>
          <div className={styles.titleGroup}>
            <div className={styles.iconCircle} aria-hidden="true">
              <ArrowDownToLine size={20} />
            </div>
            <div>
              <h2 id="new-income-title" className={styles.modalTitle}>
                Новое поступление товара
              </h2>
              <p className={styles.modalSubtitle}>
                Оприходование накладной от поставщика и пополнение остатков
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
              {/* Поставщик */}
              <div className={styles.formGroup}>
                <label htmlFor="inc-supplier" className={styles.label}>
                  Поставщик <span className={styles.required}>*</span>
                </label>
                <input
                  id="inc-supplier"
                  type="text"
                  className={styles.input}
                  placeholder="Например: Baseus Official KG"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  aria-invalid={errors.supplier ? 'true' : undefined}
                  aria-describedby={errors.supplier ? 'inc-supplier-error' : undefined}
                />
                {errors.supplier && (
                  <span id="inc-supplier-error" className={styles.errorText} role="alert">
                    {errors.supplier}
                  </span>
                )}
              </div>

              {/* Номер документа */}
              <div className={styles.formGroup}>
                <label htmlFor="inc-doc-num" className={styles.label}>
                  Номер документа поставщика
                </label>
                <input
                  id="inc-doc-num"
                  type="text"
                  className={styles.input}
                  placeholder="СФ-00123 / ТОРГ-12"
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                />
              </div>

              {/* Дата и время прихода */}
              <div className={styles.formGroup}>
                <label htmlFor="inc-received-at" className={styles.label}>
                  Дата и время поступления <span className={styles.required}>*</span>
                </label>
                <input
                  id="inc-received-at"
                  type="datetime-local"
                  className={styles.input}
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                  aria-invalid={errors.receivedAt ? 'true' : undefined}
                  aria-describedby={errors.receivedAt ? 'inc-received-at-error' : undefined}
                />
                {errors.receivedAt && (
                  <span id="inc-received-at-error" className={styles.errorText} role="alert">
                    {errors.receivedAt}
                  </span>
                )}
              </div>

              {/* Ответственный */}
              <div className={styles.formGroup}>
                <label htmlFor="inc-responsible" className={styles.label}>
                  Ответственный сотрудник <span className={styles.required}>*</span>
                </label>
                <input
                  id="inc-responsible"
                  type="text"
                  className={styles.input}
                  value={responsiblePerson}
                  onChange={(e) => setResponsiblePerson(e.target.value)}
                  aria-invalid={errors.responsiblePerson ? 'true' : undefined}
                  aria-describedby={errors.responsiblePerson ? 'inc-resp-error' : undefined}
                />
                {errors.responsiblePerson && (
                  <span id="inc-resp-error" className={styles.errorText} role="alert">
                    {errors.responsiblePerson}
                  </span>
                )}
              </div>
            </div>

            {/* Примечание */}
            <div className={styles.formGroup}>
              <label htmlFor="inc-comment" className={styles.label}>
                Примечание к накладной
              </label>
              <textarea
                id="inc-comment"
                rows={2}
                className={styles.textarea}
                placeholder="Дополнительная информация о поставке или комментарий..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            {/* Line Items Section */}
            <div className={styles.itemsSection}>
              <div className={styles.itemsHeader}>
                <h3 className={styles.itemsTitle}>
                  Товары в накладной ({items.length})
                </h3>
                <button
                  type="button"
                  className={styles.addItemBtn}
                  onClick={handleAddItem}
                >
                  <Plus size={14} />
                  <span>Добавить позицию</span>
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
                    <IncomeFormItemRow
                      key={item.id}
                      index={idx}
                      item={item}
                      activeProducts={activeProducts}
                      selectedProduct={selectedProduct}
                      allItems={items}
                      errors={errors}
                      isOnlyRow={items.length <= 1}
                      onProductChange={handleItemProductChange}
                      onFieldChange={handleItemFieldChange}
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
                <span className={styles.summaryLabel}>Всего единиц товара:</span>
                <strong className={styles.summaryValue}>
                  {formatNumber(liveTotals.totalUnits)} шт.
                </strong>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Итоговая сумма:</span>
                <strong
                  className={
                    liveTotals.isOverflow
                      ? styles.summaryTotalOverflow
                      : styles.summaryTotalAmount
                  }
                >
                  {liveTotals.isOverflow
                    ? 'Превышен предел сумм'
                    : formatCurrency(liveTotals.totalAmount)}
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
              {isSubmitting ? 'Проведение...' : 'Провести приход'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};
