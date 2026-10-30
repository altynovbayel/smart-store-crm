import { useState, useEffect, useRef, type FormEvent } from 'react';
import { X, Plus, AlertCircle, ArrowUpFromLine } from 'lucide-react';
import type {
  Product,
  OutcomeFormItemState,
  OutcomeReason,
  OutcomeSubmitPayload,
  OutcomeSubmitResult,
  ProductPickResult,
} from '../../../types';
import {
  getCurrentLocalDatetime,
  formatToLocalDatetime,
} from '../../../utils/dateUtils';
import {
  addOutcomeProductLine,
  calculateOutcomeTotals,
  validateOutcomeForm,
} from '../../../utils/outcomeCalculations';
import { createFormRowId } from '../../../utils/productSearch';
import { useProductSearchPicker } from '../../../hooks/useProductSearchPicker';
import { ProductSearchField } from '../../common/ProductSearchField/ProductSearchField';
import { generateUuid, isValidUuid } from '../../../utils/uuidUtils';
import { isIndeterminateOutcomeError } from '../../../api/outcome';
import {
  normalizeOutcomePayload,
  type PendingOutcomeOperation,
} from '../../../utils/pendingOutcomeStorage';
import { OutcomeFormItemRow } from './OutcomeFormItemRow';
import { OutcomeFormFields } from './OutcomeFormFields';
import { OutcomeFormSummary } from './OutcomeFormSummary';
import { useOutcomeHistoricalPrices } from './useOutcomeHistoricalPrices';
import { useOutcomeModalA11y } from './useOutcomeModalA11y';
import styles from './OutcomeFormModal.module.scss';

export interface OutcomeFormModalProps {
  isOpen: boolean;
  activeProducts: Product[];
  initialResponsiblePerson?: string;
  pendingOperation?: PendingOutcomeOperation | null;
  onClose: () => void;
  onSubmit: (data: OutcomeSubmitPayload) => Promise<OutcomeSubmitResult>;
}

const PAYLOAD_MISMATCH_MESSAGE =
  'Предыдущий запрос завершился ошибкой сети, и его результат на сервере ещё не определён. Чтобы избежать дублирования или некорректного списания, повторите отправку с исходными данными.';

const MISSING_RETRY_KEY_MESSAGE =
  'Внутренняя ошибка: потерян идентификатор неподтверждённой операции. Закройте форму и нажмите «Проверить статус» на странице.';

const UUID_UNAVAILABLE_MESSAGE =
  'Не удалось создать идентификатор операции: браузер не предоставляет криптографический генератор. Списание не отправлено.';

export const OutcomeFormModal = ({
  isOpen,
  activeProducts,
  initialResponsiblePerson,
  pendingOperation,
  onClose,
  onSubmit,
}: OutcomeFormModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Idempotency key: restored from the pending operation or generated once on the first submit.
  // It is never regenerated while the previous outcome is indeterminate.
  const idempotencyKeyRef = useRef<string | null>(
    pendingOperation ? pendingOperation.id : null
  );
  const lastSubmittedPayloadRef = useRef<string | null>(
    pendingOperation ? normalizeOutcomePayload(pendingOperation.payload) : null
  );
  const isIndeterminateRef = useRef<boolean>(Boolean(pendingOperation));
  const [isIndeterminate, setIsIndeterminate] = useState<boolean>(() =>
    Boolean(pendingOperation)
  );

  const [reason, setReason] = useState<OutcomeReason>(
    () => pendingOperation?.payload.reason ?? 'damaged'
  );
  const [documentDate, setDocumentDate] = useState<string>(() =>
    pendingOperation?.payload.documentDate
      ? formatToLocalDatetime(pendingOperation.payload.documentDate)
      : getCurrentLocalDatetime()
  );
  const responsiblePerson =
    pendingOperation?.payload.responsiblePerson ||
    initialResponsiblePerson?.trim() ||
    'Администратор';
  const [comment, setComment] = useState(
    () => pendingOperation?.payload.comment ?? ''
  );

  // A new write-off starts without lines (no catalog product is preselected);
  // a pending operation restores its original lines
  const [items, setItems] = useState<OutcomeFormItemState[]>(() =>
    (pendingOperation?.payload.items ?? []).map((it, idx) => ({
      id: `pending-row-${idx + 1}`,
      productId: it.productId,
      rawQuantity: String(it.quantity),
    }))
  );

  const [errors, setErrors] = useState<Record<string, string>>(() => {
    const initialErrors: Record<string, string> = {};
    if (pendingOperation) {
      initialErrors.general =
        'Предыдущая отправка этого списания завершилась ошибкой сети. Нажмите «Повторить отправку», чтобы безопасно завершить проведение с исходным ключом.';
    }
    return initialErrors;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  // Cancel pending focus frames on close/unmount
  useEffect(() => {
    if (!isOpen) return;
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen]);

  const { historicalPrices, priceStatus, priceErrorMessage } = useOutcomeHistoricalPrices({
    isOpen,
    documentDate,
    items,
    activeProducts,
  });

  useOutcomeModalA11y({ isOpen, modalRef, isSubmittingRef, onClose });

  // Scan / search: re-scanning increments the line only within the loaded stock
  const handlePickProduct = (product: Product): ProductPickResult => {
    const res = addOutcomeProductLine(items, product, createFormRowId());
    if (!res.ok) return res;
    setItems(res.items);
    if (errors.itemsGeneral) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.itemsGeneral;
        return next;
      });
    }
    return { ok: true, message: res.message };
  };

  const productPicker = useProductSearchPicker({
    products: activeProducts,
    disabled: isSubmitting,
    onPick: handlePickProduct,
  });

  if (!isOpen) return null;

  const scheduleFocus = (focusFn: () => void) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      focusFn();
    });
  };

  // Manual line: empty product choice (nothing is preselected), focus moves to its select
  const handleAddItem = () => {
    const rowId = createFormRowId();
    setItems((prev) => [...prev, { id: rowId, productId: '', rawQuantity: '1' }]);
    scheduleFocus(() => {
      document.getElementById(`item-prod-${rowId}`)?.focus();
    });
  };

  // Remove line item and retain accessible focus
  const handleRemoveItem = (id: string) => {
    if (isSubmittingRef.current) return;
    const targetIndex = items.findIndex((it) => it.id === id);
    setItems((prev) => prev.filter((it) => it.id !== id));

    scheduleFocus(() => {
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
        // No lines left: back to the search / scan field
        productPicker.inputRef.current?.focus();
      }
    });
  };

  const handleItemProductChange = (rowId: string, newProductId: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === rowId ? { ...it, productId: newProductId } : it))
    );
  };

  const handleItemQuantityChange = (rowId: string, val: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === rowId ? { ...it, rawQuantity: val } : it))
    );
  };

  // Computed live totals for preview
  const liveTotals = calculateOutcomeTotals(
    items,
    activeProducts,
    documentDate,
    historicalPrices
  );

  const showGeneralError = (message: string) => {
    setErrors((prev) => ({ ...prev, general: message }));
    scheduleFocus(() => {
      modalRef.current
        ?.querySelector<HTMLElement>(`.${styles.generalAlert}`)
        ?.focus();
    });
  };

  /**
   * Returns the idempotency key for this submission without ever creating a new one
   * while the previous outcome is indeterminate. Returns null (with a shown error) when unusable.
   */
  const resolveIdempotencyKey = (): string | null => {
    if (!idempotencyKeyRef.current) {
      if (isIndeterminateRef.current) {
        showGeneralError(MISSING_RETRY_KEY_MESSAGE);
        return null;
      }
      idempotencyKeyRef.current = generateUuid();
    }
    if (!isValidUuid(idempotencyKeyRef.current)) {
      // A fresh key could not be generated; nothing has been sent with it yet
      if (!isIndeterminateRef.current) idempotencyKeyRef.current = null;
      showGeneralError(
        isIndeterminateRef.current ? MISSING_RETRY_KEY_MESSAGE : UUID_UNAVAILABLE_MESSAGE
      );
      return null;
    }
    return idempotencyKeyRef.current;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;

    const isRetrySubmission = Boolean(isIndeterminate && idempotencyKeyRef.current);
    const result = validateOutcomeForm(
      reason,
      documentDate,
      responsiblePerson,
      comment,
      items,
      activeProducts,
      historicalPrices,
      isRetrySubmission
    );

    if (!result.isValid || !result.data) {
      setErrors(result.errors);
      // Focus first element with aria-invalid="true" after state update
      scheduleFocus(() => {
        modalRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus();
      });
      return;
    }

    const payloadSnapshot = normalizeOutcomePayload(result.data);

    // Guard against double stock-decrease after indeterminate network outcome
    if (
      isIndeterminateRef.current &&
      lastSubmittedPayloadRef.current &&
      lastSubmittedPayloadRef.current !== payloadSnapshot
    ) {
      showGeneralError(PAYLOAD_MISMATCH_MESSAGE);
      return;
    }

    const idempotencyKey = resolveIdempotencyKey();
    if (!idempotencyKey) return;

    lastSubmittedPayloadRef.current = payloadSnapshot;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    let res: OutcomeSubmitResult;
    try {
      res = await onSubmit({ ...result.data, id: idempotencyKey });
    } catch {
      // Unexpected failure: the request may have been sent, keep the key and payload locked
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      isIndeterminateRef.current = true;
      setIsIndeterminate(true);
      showGeneralError(
        'Произошла непредвиденная ошибка при проведении списания. Результат не подтверждён — повторите отправку с теми же данными.'
      );
      return;
    }

    if (res.success) {
      idempotencyKeyRef.current = null;
      lastSubmittedPayloadRef.current = null;
      isIndeterminateRef.current = false;
      setIsIndeterminate(false);
      onClose();
      return;
    }

    isSubmittingRef.current = false;
    setIsSubmitting(false);

    const indeterminate = isIndeterminateOutcomeError(res.error);
    isIndeterminateRef.current = indeterminate;
    setIsIndeterminate(indeterminate);
    if (!indeterminate) {
      // Nothing was committed under this key: corrected data will get a fresh key
      idempotencyKeyRef.current = null;
      lastSubmittedPayloadRef.current = null;
    }
    showGeneralError(res.error.message || 'Ошибка при проведении списания');
  };

  return (
    <div className={styles.modalOverlay} onClick={isSubmitting ? undefined : onClose}>
      <div
        className={styles.modalCard}
        ref={modalRef}
        tabIndex={-1}
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
            disabled={isSubmitting}
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
              <div className={styles.generalAlert} role="alert" tabIndex={-1}>
                <AlertCircle size={16} />
                <span>{errors.general}</span>
              </div>
            )}

            {/* Document Details Grid */}
            <OutcomeFormFields
              reason={reason}
              documentDate={documentDate}
              responsiblePerson={responsiblePerson}
              comment={comment}
              errors={errors}
              disabled={isSubmitting}
              onReasonChange={setReason}
              onDocumentDateChange={setDocumentDate}
              onCommentChange={setComment}
            />

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
                  disabled={isSubmitting}
                >
                  <Plus size={14} />
                  <span>Добавить товар</span>
                </button>
              </div>

              <ProductSearchField inputId="out-product-search" picker={productPicker} />

              {errors.itemsGeneral && (
                <span className={styles.errorText} role="alert">
                  {errors.itemsGeneral}
                </span>
              )}

              {items.length === 0 && (
                <p className={styles.itemsEmpty}>Добавьте товар через поиск или сканер</p>
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
                      disabled={isSubmitting}
                      historicalPrice={
                        item.productId ? historicalPrices[item.productId] : undefined
                      }
                      priceStatus={priceStatus}
                      onProductChange={handleItemProductChange}
                      onQuantityChange={handleItemQuantityChange}
                      onRemove={handleRemoveItem}
                    />
                  );
                })}
              </div>
            </div>

            {/* Summary card before conducting */}
            <OutcomeFormSummary
              itemsCount={items.length}
              totals={liveTotals}
              priceStatus={priceStatus}
              priceErrorMessage={priceErrorMessage}
            />
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
              disabled={isSubmitting || items.length === 0}
              title={items.length === 0 ? 'Добавьте хотя бы один товар' : undefined}
            >
              {isSubmitting
                ? 'Проведение...'
                : isIndeterminate
                  ? 'Повторить отправку'
                  : 'Провести списание'}
            </button>
          </footer>

        </form>

      </div>
    </div>
  );
};
