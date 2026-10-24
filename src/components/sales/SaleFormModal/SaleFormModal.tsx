import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { X, Plus, AlertCircle, ShoppingCart } from 'lucide-react';
import type {
  SaleCatalogProduct,
  SaleFormItemState,
  PaymentMethod,
  DiscountType,
  SaleSubmitPayload,
  SaleSubmitResult,
  PendingSaleOperation,
} from '../../../types';
import { getCurrentLocalDatetime, formatToLocalDatetime } from '../../../utils/dateUtils';
import { calculateSaleTotals, validateSaleForm } from '../../../utils/saleCalculations';
import { isIndeterminateSaleError } from '../../../api/sales';
import { SaleFormItemRow } from './SaleFormItemRow';
import { BarcodeScannerField } from './BarcodeScannerField';
import { SaleFormFields } from './SaleFormFields';
import { SalePaymentSection } from './SalePaymentSection';
import { SaleReceiptDiscountSection } from './SaleReceiptDiscountSection';
import { SaleSummary } from './SaleSummary';
import { useSaleModalA11y } from './useSaleModalA11y';
import { useSaleBarcodeScanner } from './useSaleBarcodeScanner';
import { useSaleIdempotency } from './useSaleIdempotency';
import styles from './SaleFormModal.module.scss';

export interface SaleFormModalProps {
  isOpen: boolean;
  /** Role-aware catalog without purchase prices (cost / profit are determined by the server). */
  activeProducts: SaleCatalogProduct[];
  initialResponsiblePerson?: string;
  pendingOperation?: PendingSaleOperation | null;
  onClose: () => void;
  onSubmit: (data: SaleSubmitPayload) => Promise<SaleSubmitResult>;
  /** Reloads the active catalog (stock / availability may be stale). */
  onRefreshCatalog?: () => void;
}

const createEmptyRow = (id: string): SaleFormItemState => ({
  id,
  productId: '',
  rawQuantity: '1',
  rawUnitPrice: '0',
  discountType: 'fixed',
  rawDiscountValue: '',
});

const formatOptionalAmount = (value: number): string => (value > 0 ? String(value) : '');

export const SaleFormModal = ({
  isOpen,
  activeProducts,
  initialResponsiblePerson,
  pendingOperation,
  onClose,
  onSubmit,
  onRefreshCatalog,
}: SaleFormModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const restored = pendingOperation?.payload;

  const { isIndeterminate, isRetrySubmission, prepareSubmission, completeSubmission } =
    useSaleIdempotency(pendingOperation);

  const [soldAt, setSoldAt] = useState(() =>
    restored ? formatToLocalDatetime(restored.soldAt) : getCurrentLocalDatetime()
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    () => restored?.paymentMethod ?? 'cash'
  );
  const [rawReceivedAmount, setRawReceivedAmount] = useState(() =>
    restored?.receivedAmount !== undefined ? String(restored.receivedAmount) : ''
  );
  const responsiblePerson = initialResponsiblePerson?.trim() || 'Сотрудник';
  const [comment, setComment] = useState(() => restored?.comment ?? '');
  const [receiptDiscountType, setReceiptDiscountType] = useState<DiscountType>(
    () => restored?.receiptDiscountType ?? 'fixed'
  );
  const [rawReceiptDiscountValue, setRawReceiptDiscountValue] = useState(() =>
    restored ? formatOptionalAmount(restored.receiptDiscountValue) : ''
  );

  const [items, setItems] = useState<SaleFormItemState[]>(() => {
    if (restored && restored.items.length > 0) {
      return restored.items.map((it, idx) => ({
        id: `pending-row-${idx + 1}`,
        productId: it.productId,
        rawQuantity: String(it.quantity),
        rawUnitPrice: String(it.unitPrice),
        discountType: it.discountType,
        rawDiscountValue: formatOptionalAmount(it.discountValue),
      }));
    }
    return [createEmptyRow('row-1')];
  });

  const [errors, setErrors] = useState<Record<string, string>>(() => {
    const initialErrors: Record<string, string> = {};
    if (pendingOperation) {
      initialErrors.general =
        'Предыдущая отправка этого чека завершилась ошибкой сети. Нажмите «Повторить отправку», чтобы безопасно завершить проведение с исходным ключом.';
    }
    return initialErrors;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

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

  useSaleModalA11y({ isOpen, modalRef, isSubmittingRef, onClose });

  /**
   * Selling prices are read-only and always come from the current catalog, so a catalog reload
   * updates every row. While a previous submission is indeterminate the confirmed (sent) prices
   * are kept, because the retry must reuse the exact same payload.
   */
  const effectiveItems = useMemo(
    () =>
      isIndeterminate
        ? items
        : items.map((it) => {
            const product = activeProducts.find((p) => p.id === it.productId);
            return product ? { ...it, rawUnitPrice: String(product.sellingPrice) } : it;
          }),
    [items, activeProducts, isIndeterminate]
  );

  const runValidation = (itemsToValidate: SaleFormItemState[], isRetrySubmission: boolean) =>
    validateSaleForm(
      soldAt,
      paymentMethod,
      rawReceivedAmount,
      responsiblePerson,
      comment,
      receiptDiscountType,
      rawReceiptDiscountValue,
      itemsToValidate,
      activeProducts,
      isRetrySubmission
    );

  const scanner = useSaleBarcodeScanner({
    isOpen,
    activeProducts,
    items,
    isSubmittingRef,
    onItemsScanned: (newItems) => {
      setItems(newItems);
      // Re-validate and update form errors if errors were previously active
      setErrors((prevErrors) =>
        Object.keys(prevErrors).length === 0 ? prevErrors : runValidation(newItems, false).errors
      );
    },
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

  // Computed live totals (preview; the server recalculates every amount)
  const liveTotals = calculateSaleTotals(
    effectiveItems,
    receiptDiscountType,
    rawReceiptDiscountValue,
    paymentMethod,
    rawReceivedAmount
  );

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      createEmptyRow(`row-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`),
    ]);
  };

  // Remove line item and retain accessible focus
  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((it) => it.id !== id));

    scheduleFocus(() => {
      if (!modalRef.current) return;
      const addItemBtn = modalRef.current.querySelector<HTMLElement>(`.${styles.addItemBtn}`);
      if (addItemBtn && document.contains(addItemBtn)) {
        addItemBtn.focus();
      }
    });
  };

  const handleItemProductChange = (rowId: string, newProductId: string) => {
    const targetProd = activeProducts.find((p) => p.id === newProductId);
    setItems((prev) =>
      prev.map((it) =>
        it.id === rowId
          ? {
              ...it,
              productId: newProductId,
              rawUnitPrice: targetProd ? String(targetProd.sellingPrice) : it.rawUnitPrice,
            }
          : it
      )
    );
  };

  const handleItemQuantityChange = (rowId: string, val: string) => {
    setItems((prev) => prev.map((it) => (it.id === rowId ? { ...it, rawQuantity: val } : it)));
  };

  const handleItemDiscountTypeChange = (rowId: string, type: DiscountType) => {
    setItems((prev) => prev.map((it) => (it.id === rowId ? { ...it, discountType: type } : it)));
  };

  const handleItemDiscountValueChange = (rowId: string, val: string) => {
    setItems((prev) => prev.map((it) => (it.id === rowId ? { ...it, rawDiscountValue: val } : it)));
  };

  const showGeneralError = (message: string) => {
    setErrors((prev) => ({ ...prev, general: message }));
    scheduleFocus(() => {
      modalRef.current?.querySelector<HTMLElement>(`.${styles.errorBanner}`)?.focus();
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Ref guard: a double click in the same tick can never create a second receipt
    if (isSubmittingRef.current) return;

    const result = runValidation(effectiveItems, isRetrySubmission());

    if (!result.isValid || !result.data) {
      setErrors(result.errors);
      // Stock / availability errors may come from a stale catalog: reload it, the rows update in place
      if (Object.keys(result.errors).some((key) => /^item-.+-(qty|product)$/.test(key))) {
        onRefreshCatalog?.();
      }
      scheduleFocus(() => {
        modalRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    const prepared = prepareSubmission(result.data);
    if (!prepared.ok) {
      showGeneralError(prepared.message);
      return;
    }

    // Commit the exact rows being sent (incl. confirmed catalog prices) into form state, so an
    // indeterminate outcome keeps showing — and can only re-send — this very payload
    setItems(effectiveItems);
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    let res: SaleSubmitResult;
    try {
      res = await onSubmit({ ...result.data, id: prepared.key });
    } catch {
      // Unexpected failure: the request may have been sent, keep the key and payload locked
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      completeSubmission('indeterminate');
      showGeneralError(
        'Произошла непредвиденная ошибка при проведении продажи. Результат не подтверждён — повторите отправку с теми же данными.'
      );
      return;
    }

    if (res.success) {
      // Form data is discarded only after the server confirmed the receipt
      completeSubmission('success');
      onClose();
      return;
    }

    isSubmittingRef.current = false;
    setIsSubmitting(false);
    completeSubmission(isIndeterminateSaleError(res.error) ? 'indeterminate' : 'deterministic');
    showGeneralError(res.error.message || 'Ошибка при проведении продажи');
  };

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sale-modal-title"
    >
      <div className={styles.modalDialog} ref={modalRef}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerTitleWrapper}>
            <div className={styles.headerIcon} aria-hidden="true">
              <ShoppingCart size={22} />
            </div>
            <div>
              <h2 id="sale-modal-title" className={styles.modalTitle}>
                Оформление продажи
              </h2>
              <p className={styles.modalSubtitle}>
                Кассовый чек, списание остатков и фиксация оплаты
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Закрыть окно оформления продажи"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.modalBody}>
            {/* General errors banner */}
            {errors.general && (
              <div className={styles.errorBanner} role="alert" tabIndex={-1}>
                <AlertCircle size={16} />
                <span>{errors.general}</span>
              </div>
            )}
            {errors.itemsGeneral && (
              <div className={styles.errorBanner} role="alert">
                <AlertCircle size={16} />
                <span>{errors.itemsGeneral}</span>
              </div>
            )}

            {/* Top row: Date, Responsible employee, Comment */}
            <SaleFormFields
              soldAt={soldAt}
              responsiblePerson={responsiblePerson}
              comment={comment}
              errors={errors}
              disabled={isSubmitting}
              onSoldAtChange={setSoldAt}
              onCommentChange={setComment}
            />

            {/* Payment Method and Cash */}
            <SalePaymentSection
              paymentMethod={paymentMethod}
              rawReceivedAmount={rawReceivedAmount}
              totalAmount={liveTotals.totalAmount}
              changeAmount={liveTotals.changeAmount}
              errors={errors}
              disabled={isSubmitting}
              onPaymentMethodChange={setPaymentMethod}
              onReceivedAmountChange={setRawReceivedAmount}
            />

            {/* Barcode Scanner Section */}
            <BarcodeScannerField
              value={scanner.barcode}
              onChange={scanner.handleBarcodeChange}
              onScan={scanner.handleBarcodeScan}
              error={scanner.barcodeError}
              successMessage={scanner.barcodeSuccess}
              inputRef={scanner.barcodeInputRef}
              disabled={isSubmitting}
            />

            {/* Items Table Section */}
            <div>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Товары в чеке ({items.length})</h3>
              </div>

              <div className={styles.itemsContainer}>
                {effectiveItems.map((item, index) => (
                  <SaleFormItemRow
                    key={item.id}
                    index={index}
                    item={item}
                    activeProducts={activeProducts}
                    selectedProduct={activeProducts.find((p) => p.id === item.productId)}
                    allItems={effectiveItems}
                    errors={errors}
                    isOnlyRow={items.length === 1}
                    disabled={isSubmitting}
                    onProductChange={handleItemProductChange}
                    onQuantityChange={handleItemQuantityChange}
                    onDiscountTypeChange={handleItemDiscountTypeChange}
                    onDiscountValueChange={handleItemDiscountValueChange}
                    onRemove={handleRemoveItem}
                  />
                ))}
              </div>

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

            {/* Receipt Discount Section */}
            <SaleReceiptDiscountSection
              discountType={receiptDiscountType}
              rawDiscountValue={rawReceiptDiscountValue}
              error={errors.receiptDiscount}
              disabled={isSubmitting}
              onDiscountTypeChange={setReceiptDiscountType}
              onDiscountValueChange={setRawReceiptDiscountValue}
            />

            {/* Summary Box */}
            <SaleSummary itemsCount={items.length} totals={liveTotals} totalError={errors.totalAmount} />
          </div>

          {/* Footer */}
          <div className={styles.modalFooter}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={isSubmitting}
            >
              Отмена
            </button>
            <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>
              {isSubmitting
                ? 'Проведение...'
                : isIndeterminate
                  ? 'Повторить отправку'
                  : 'Провести продажу'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
