import { useState, useEffect, useRef, type FormEvent } from 'react';
import { X, Plus, AlertCircle, ShoppingCart } from 'lucide-react';
import type {
  Product,
  SaleFormData,
  SaleFormItemState,
  PaymentMethod,
  DiscountType,
} from '../../../types';
import { PAYMENT_METHODS } from '../../../types';
import { getCurrentLocalDatetime } from '../../../utils/dateUtils';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';
import {
  calculateSaleTotals,
  validateSaleForm,
  processBarcodeScan,
} from '../../../utils/saleCalculations';
import { SaleFormItemRow } from './SaleFormItemRow';
import { BarcodeScannerField } from './BarcodeScannerField';
import styles from './SaleFormModal.module.scss';

export interface SaleFormModalProps {
  isOpen: boolean;
  activeProducts: Product[];
  allProducts?: Product[];
  onClose: () => void;
  onSubmit: (data: SaleFormData) => { success: boolean; error?: string };
}

export const SaleFormModal = ({
  isOpen,
  activeProducts,
  allProducts,
  onClose,
  onSubmit,
}: SaleFormModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  const [barcode, setBarcode] = useState('');
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [barcodeSuccess, setBarcodeSuccess] = useState<string | null>(null);

  const [soldAt, setSoldAt] = useState(() => getCurrentLocalDatetime());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [rawReceivedAmount, setRawReceivedAmount] = useState('');
  const [responsiblePerson, setResponsiblePerson] = useState('Кассир-продавец');
  const [comment, setComment] = useState('');
  const [receiptDiscountType, setReceiptDiscountType] = useState<DiscountType>('fixed');
  const [rawReceiptDiscountValue, setRawReceiptDiscountValue] = useState('');

  // Initial single empty item
  const [items, setItems] = useState<SaleFormItemState[]>([
    {
      id: 'row-1',
      productId: '',
      rawQuantity: '1',
      rawUnitPrice: '0',
      discountType: 'fixed',
      rawDiscountValue: '',
    },
  ]);

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

    // Focus barcode scanner input initially if focus is not already inside the modal
    const isFocusInside = modalRef.current?.contains(document.activeElement);
    if (!isFocusInside) {
      const barcodeInput = modalRef.current?.querySelector<HTMLInputElement>(
        '#sale-barcode-scanner'
      );
      if (barcodeInput) {
        barcodeInput.focus();
      } else {
        const soldAtInput = modalRef.current?.querySelector<HTMLInputElement>(
          '#sale-sold-at'
        );
        soldAtInput?.focus();
      }
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
      document.body.classList.remove('drawer-open');
      window.removeEventListener('keydown', handleKeyDown);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      restoreFocusWithFallback(
        previousFocusRef.current,
        '[data-add-sale-btn]'
      );
    };
  }, [isOpen, onClose]);

  // Computed live totals
  const liveTotals = calculateSaleTotals(
    items,
    activeProducts,
    receiptDiscountType,
    rawReceiptDiscountValue,
    paymentMethod,
    rawReceivedAmount,
    soldAt
  );

  // Barcode scanner handling
  const handleBarcodeChange = (val: string) => {
    setBarcode(val);
    if (barcodeError) {
      setBarcodeError(null);
    }
  };

  const handleBarcodeScan = (scannedValue: string) => {
    const trimmed = scannedValue.trim();
    if (!trimmed) {
      return;
    }

    const catalog = allProducts ?? activeProducts;
    const res = processBarcodeScan(trimmed, catalog, items);

    if (res.success && res.updatedItems) {
      const newItems = res.updatedItems;
      setItems(newItems);
      setBarcode('');
      setBarcodeError(null);
      setBarcodeSuccess(res.message ?? 'Товар добавлен в чек');

      // Re-validate and update form errors if errors were previously active
      setErrors((prevErrors) => {
        if (Object.keys(prevErrors).length === 0) return prevErrors;
        const valResult = validateSaleForm(
          soldAt,
          paymentMethod,
          rawReceivedAmount,
          responsiblePerson,
          comment,
          receiptDiscountType,
          rawReceiptDiscountValue,
          newItems,
          activeProducts
        );
        return valResult.errors;
      });

      // Retain focus in barcode scanner input
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        barcodeInputRef.current?.focus();
      });
    } else if (!res.success && res.error) {
      setBarcodeError(res.error);
      setBarcodeSuccess(null);

      // Retain focus and select input text for quick rescan
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (barcodeInputRef.current && document.contains(barcodeInputRef.current)) {
          barcodeInputRef.current.focus();
          barcodeInputRef.current.select();
        }
      });
    }
  };

  // Add line item
  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        productId: '',
        rawQuantity: '1',
        rawUnitPrice: '0',
        discountType: 'fixed',
        rawDiscountValue: '',
      },
    ]);
  };

  // Remove line item and retain accessible focus
  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((it) => it.id !== id));

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!modalRef.current) return;
      const addItemBtn = modalRef.current.querySelector<HTMLElement>(
        `.${styles.addItemBtn}`
      );
      if (addItemBtn && document.contains(addItemBtn)) {
        addItemBtn.focus();
      }
    });
  };

  // Update item fields
  const handleItemProductChange = (rowId: string, newProductId: string) => {
    const targetProd = activeProducts.find((p) => p.id === newProductId);
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== rowId) return it;
        return {
          ...it,
          productId: newProductId,
          rawUnitPrice: targetProd ? String(targetProd.sellingPrice) : it.rawUnitPrice,
        };
      })
    );
  };

  const handleItemQuantityChange = (rowId: string, val: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === rowId ? { ...it, rawQuantity: val } : it))
    );
  };

  const handleItemUnitPriceChange = (rowId: string, val: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === rowId ? { ...it, rawUnitPrice: val } : it))
    );
  };

  const handleItemDiscountTypeChange = (rowId: string, type: DiscountType) => {
    setItems((prev) =>
      prev.map((it) => (it.id === rowId ? { ...it, discountType: type } : it))
    );
  };

  const handleItemDiscountValueChange = (rowId: string, val: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === rowId ? { ...it, rawDiscountValue: val } : it))
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const result = validateSaleForm(
      soldAt,
      paymentMethod,
      rawReceivedAmount,
      responsiblePerson,
      comment,
      receiptDiscountType,
      rawReceiptDiscountValue,
      items,
      activeProducts
    );

    if (result.isValid && result.data) {
      setIsSubmitting(true);
      const res = onSubmit(result.data);
      if (res.success) {
        onClose();
      } else {
        setErrors({ general: res.error || 'Ошибка при сохранении продажи' });
        setIsSubmitting(false);
      }
    } else {
      setErrors(result.errors);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (!modalRef.current) return;
        const firstInvalid = modalRef.current.querySelector<HTMLElement>(
          '[aria-invalid="true"]'
        );
        firstInvalid?.focus();
      });
    }
  };

  if (!isOpen) return null;

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
              <div className={styles.errorBanner} role="alert">
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

            {/* Top row: Date, Responsible employee */}
            <div className={styles.fieldGrid}>
              <div className={styles.formGroup}>
                <label htmlFor="sale-sold-at" className={styles.label}>
                  Дата и время продажи <span className={styles.requiredStar}>*</span>
                </label>
                <input
                  id="sale-sold-at"
                  type="datetime-local"
                  step="1"
                  className={styles.input}
                  value={soldAt}
                  onChange={(e) => setSoldAt(e.target.value)}
                  aria-invalid={errors.soldAt ? 'true' : undefined}
                  aria-describedby={errors.soldAt ? 'sale-sold-at-err' : undefined}
                />
                {errors.soldAt && (
                  <span id="sale-sold-at-err" className={styles.errorText} role="alert">
                    {errors.soldAt}
                  </span>
                )}
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="sale-responsible" className={styles.label}>
                  Ответственный <span className={styles.requiredStar}>*</span>
                </label>
                <input
                  id="sale-responsible"
                  type="text"
                  className={styles.input}
                  placeholder="Имя сотрудника"
                  value={responsiblePerson}
                  onChange={(e) => setResponsiblePerson(e.target.value)}
                  aria-invalid={errors.responsiblePerson ? 'true' : undefined}
                  aria-describedby={errors.responsiblePerson ? 'sale-resp-err' : undefined}
                />
                {errors.responsiblePerson && (
                  <span id="sale-resp-err" className={styles.errorText} role="alert">
                    {errors.responsiblePerson}
                  </span>
                )}
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="sale-comment" className={styles.label}>
                  Комментарий к чеку
                </label>
                <input
                  id="sale-comment"
                  type="text"
                  className={styles.input}
                  placeholder="Примечание (необязательно)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className={styles.formGroup}>
              <label htmlFor="sale-payment-method" className={styles.label}>
                Способ оплаты <span className={styles.requiredStar}>*</span>
              </label>
              <select
                id="sale-payment-method"
                className={styles.select}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              >
                {(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((pm) => (
                  <option key={pm} value={pm}>
                    {PAYMENT_METHODS[pm]}
                  </option>
                ))}
              </select>
            </div>

            {/* Cash Payment Specific Fields */}
            {paymentMethod === 'cash' && (
              <div className={styles.cashPaymentBox}>
                <div className={styles.cashInputGroup}>
                  <div className={styles.formGroup}>
                    <label htmlFor="sale-cash-received" className={styles.label}>
                      Получено от покупателя (сом) <span className={styles.requiredStar}>*</span>
                    </label>
                    <input
                      id="sale-cash-received"
                      type="text"
                      inputMode="decimal"
                      className={styles.input}
                      placeholder={String(liveTotals.totalAmount)}
                      value={rawReceivedAmount}
                      onChange={(e) => setRawReceivedAmount(e.target.value)}
                      aria-invalid={errors.receivedAmount ? 'true' : undefined}
                      aria-describedby={errors.receivedAmount ? 'sale-received-err' : undefined}
                    />
                    {errors.receivedAmount && (
                      <span id="sale-received-err" className={styles.errorText} role="alert">
                        {errors.receivedAmount}
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.cashChangeDisplay}>
                  <span className={styles.changeLabel}>Сдача к выдаче</span>
                  <span className={styles.changeValue}>
                    {formatCurrency(liveTotals.changeAmount)}
                  </span>
                </div>
              </div>
            )}

            {/* Barcode Scanner Section */}
            <BarcodeScannerField
              value={barcode}
              onChange={handleBarcodeChange}
              onScan={handleBarcodeScan}
              error={barcodeError}
              successMessage={barcodeSuccess}
              inputRef={barcodeInputRef}
            />

            {/* Items Table Section */}
            <div>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  Товары в чеке ({items.length})
                </h3>
              </div>

              <div className={styles.itemsContainer}>
                {items.map((item, index) => {
                  const selProd = activeProducts.find((p) => p.id === item.productId);
                  return (
                    <SaleFormItemRow
                      key={item.id}
                      index={index}
                      item={item}
                      soldAt={soldAt}
                      activeProducts={activeProducts}
                      selectedProduct={selProd}
                      allItems={items}
                      errors={errors}
                      isOnlyRow={items.length === 1}
                      onProductChange={handleItemProductChange}
                      onQuantityChange={handleItemQuantityChange}
                      onUnitPriceChange={handleItemUnitPriceChange}
                      onDiscountTypeChange={handleItemDiscountTypeChange}
                      onDiscountValueChange={handleItemDiscountValueChange}
                      onRemove={handleRemoveItem}
                    />
                  );
                })}
              </div>

              <button
                type="button"
                className={styles.addItemBtn}
                onClick={handleAddItem}
              >
                <Plus size={14} />
                <span>Добавить товар</span>
              </button>
            </div>

            {/* Receipt Discount Section */}
            <div className={styles.discountSection}>
              <div className={styles.sectionTitle}>Скидка на чек (общая)</div>
              <div className={styles.fieldGrid}>
                <div className={styles.formGroup}>
                  <label htmlFor="sale-receipt-discount-type" className={styles.label}>
                    Тип скидки
                  </label>
                  <select
                    id="sale-receipt-discount-type"
                    className={styles.select}
                    value={receiptDiscountType}
                    onChange={(e) =>
                      setReceiptDiscountType(e.target.value as DiscountType)
                    }
                  >
                    <option value="fixed">Фиксированная (сом)</option>
                    <option value="percent">Процентная (%)</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="sale-receipt-discount-val" className={styles.label}>
                    Размер скидки на чек
                  </label>
                  <input
                    id="sale-receipt-discount-val"
                    type="text"
                    inputMode="decimal"
                    className={styles.input}
                    placeholder="0"
                    value={rawReceiptDiscountValue}
                    onChange={(e) => setRawReceiptDiscountValue(e.target.value)}
                    aria-invalid={errors.receiptDiscount ? 'true' : undefined}
                    aria-describedby={
                      errors.receiptDiscount ? 'sale-receipt-discount-err' : undefined
                    }
                  />
                  {errors.receiptDiscount && (
                    <span
                      id="sale-receipt-discount-err"
                      className={styles.errorText}
                      role="alert"
                    >
                      {errors.receiptDiscount}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Summary Box */}
            <div className={styles.summaryBox}>
              <div className={styles.summaryRow}>
                <span>Всего позиций / единиц:</span>
                <span>
                  {items.length} поз. / {formatNumber(liveTotals.totalUnits)} шт.
                </span>
              </div>
              <div className={styles.summaryRow}>
                <span>Сумма без скидок:</span>
                <span>{formatCurrency(liveTotals.subtotal)}</span>
              </div>
              {liveTotals.itemDiscountTotal > 0 && (
                <div className={styles.summaryRow}>
                  <span>Скидки по позициям:</span>
                  <span style={{ color: '#dc2626' }}>
                    -{formatCurrency(liveTotals.itemDiscountTotal)}
                  </span>
                </div>
              )}
              {liveTotals.receiptDiscountAmount > 0 && (
                <div className={styles.summaryRow}>
                  <span>Скидка на чек:</span>
                  <span style={{ color: '#dc2626' }}>
                    -{formatCurrency(liveTotals.receiptDiscountAmount)}
                  </span>
                </div>
              )}
              <div className={styles.summaryTotalRow}>
                <span>Итого к оплате:</span>
                <span className={styles.totalHighlight}>
                  {liveTotals.isOverflow
                    ? 'Превышен предел сумм'
                    : formatCurrency(liveTotals.totalAmount)}
                </span>
              </div>
              {liveTotals.isOverflow && !errors.totalAmount && (
                <span className={styles.errorText} role="alert">
                  Сумма чека или себестоимости превышает допустимый математический предел
                </span>
              )}
              {errors.totalAmount && (
                <span className={styles.errorText} role="alert">
                  {errors.totalAmount}
                </span>
              )}
            </div>
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
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Проведение...' : 'Провести продажу'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
